const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(bodyParser.json());

// Fila de execução
let taskQueue = [];
let isProcessing = false;
let currentStatus = { status: 'idle', message: 'Nenhum bot rodando' };
let logs = [];

function addLog(msg) {
    const timestamp = new Date().toLocaleTimeString();
    const logMsg = `[${timestamp}] ${msg}`;
    console.log(logMsg);
    logs.push(logMsg);
    if (logs.length > 50) logs.shift();
    currentStatus.message = msg;
}

async function processQueue() {
    if (isProcessing || taskQueue.length === 0) return;

    isProcessing = true;
    const botTask = taskQueue.shift();

    try {
        addLog(`Iniciando Bot: ${botTask.name}...`);
        currentStatus.status = 'running';

        // Caminho dinâmico para o script do bot
        const scriptPath = path.join(__dirname, 'automation', 'scripts', botTask.script);
        const botScript = require(scriptPath);

        await botScript.run(botTask.config, (msg) => {
            addLog(msg);
        });

        addLog(`✅ Bot: ${botTask.name} finalizado com sucesso!`);
    } catch (err) {
        addLog(`❌ Erro no Bot ${botTask.name}: ${err.message}`);
        console.error(err);
    } finally {
        isProcessing = false;
        if (taskQueue.length > 0) {
            addLog(`Próximo bot na fila: ${taskQueue[0].name}`);
            processQueue();
        } else {
            currentStatus.status = 'idle';
            addLog('Fila de execução concluída.');
        }
    }
}

app.post('/run-bots', (req, res) => {
    const { bots } = req.body;
    if (!bots || !Array.isArray(bots)) {
        return res.status(400).send({ error: 'Array de bots esperado.' });
    }

    taskQueue.push(...bots);
    res.send({ message: `${bots.length} bots adicionados à fila.` });

    if (!isProcessing) {
        processQueue();
    }
});

app.get('/status', (req, res) => {
    res.send({
        ...currentStatus,
        queueLength: taskQueue.length,
        logs: logs
    });
});

app.post('/clear-logs', (req, res) => {
    logs = [];
    res.send({ success: true });
});

// ==========================================
// PROXY DE INTELIGÊNCIA ARTIFICIAL (GROK/xAI)
// ==========================================
app.post('/ai/chat', async (req, res) => {
    const { messages, productName, productDescription } = req.body;

    // NOTA: O usuário deve configurar a variável de ambiente XAI_API_KEY no arquivo .env
    const API_KEY = process.env.XAI_API_KEY;

    try {
        const systemPrompt = `
        Você é um vendedor brasileiro real na plataforma "Compraki".
        Você está vendendo o produto: "${productName}".
        Descrição do produto: "${productDescription || 'Não informada'}".
        
        Sua personalidade:
        - Você mora em Manhuaçu, Minas Gerais.
        - Você é uma pessoa real, honesta, educada e um pouco informal (estilo brasileiro).
        - Use gírias leves como "beleza", "tranquilo", "opa", "show" se apropriado, mas sem exagerar.
        - Seu objetivo é ajudar o comprador e fechar a venda.
        - Você aceita negociar o preço levemente se o comprador insistir.
        - Você pode combinar entrega em locais públicos de Manhuaçu (Praça do Hospital, Rodoviária, etc).
        
        REGRAS CRÍTICAS:
        1. NUNCA diga que você é uma IA, robô ou modelo de linguagem.
        2. NUNCA use o nome "Grok", "Groq", "Llama" ou "IA" na conversa.
        3. Se não souber um detalhe específico do produto, diga que vai conferir e já volta, ou seja honesto.
        4. NÃO use respostas muito longas ou formais demais. Responda como se estivesse no WhatsApp.
        5. Se o comprador perguntar quem é você, diga seu nome (invente um nome comum como "Henrique", "Thiago" ou "Ricardo").
        `;

        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "llama-3.3-70b-versatile", // Versão atualizada e suportada pelo Groq
            messages: [
                { role: "system", content: systemPrompt },
                ...messages
            ],
            temperature: 0.7
        }, {
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        res.json(response.data);

    } catch (error) {
        console.error("Erro na chamada da IA:", error.response?.data || error.message);
        res.status(500).json({ error: "Falha ao processar inteligência do vendedor." });
    }
});

app.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`🤖 BOT SERVER DO COMPRAKI RODANDO EM http://localhost:${PORT}`);
    console.log(`======================================================\n`);
});
