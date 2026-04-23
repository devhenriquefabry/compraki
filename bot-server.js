require('dotenv').config();
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

        const scriptPath = path.join(__dirname, 'automation', 'scripts', botTask.script);
        const botScript = require(scriptPath);

        // Passamos o headless da tarefa para a execução do bot
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
// PROXY DE INTELIGÊNCIA ARTIFICIAL (GROK/xAI/GROQ)
// ==========================================
app.post('/ai/chat', async (req, res) => {
    const { messages, productName, productDescription, role } = req.body;

    // Fallback Manual para .env caso o process.env esteja vindo vazio
    if (!process.env.GROQ_API_KEY && !process.env.XAI_API_KEY) {
        try {
            const fs = require('fs');
            const envContent = fs.readFileSync('.env', 'utf8');
            envContent.split('\n').forEach(line => {
                const [key, ...valueParts] = line.split('=');
                if (key && valueParts.length > 0) {
                    process.env[key.trim()] = valueParts.join('=').trim();
                }
            });
        } catch (e) {
            console.error("⚠️ Falha ao ler .env manualmente:", e.message);
        }
    }

    const API_KEY = process.env.GROQ_API_KEY || process.env.XAI_API_KEY;

    if (!API_KEY) {
        console.error("❌ ERRO: Nenhuma API KEY encontrada (process.env ou fallback manual)!");
    } else {
        console.log(`📡 [AI Proxy] Usando chave: ${API_KEY.substring(0, 7)}...${API_KEY.substring(API_KEY.length - 4)}`);
    }

    try {
        let systemPrompt = '';
        
        if (role === 'buyer') {
            systemPrompt = `
            Você é um comprador interessado na plataforma "Compraki".
            Você está conversando sobre o produto: "${productName}".
            
            Sua personalidade:
            - Você quer comprar o produto, mas é cauteloso.
            - Você faz perguntas sobre o estado do produto, tempo de uso e se o preço é negociável.
            - Você é educado, mas direto (estilo WhatsApp).
            - Você pergunta se pode retirar em mãos em Manhuaçu.
            - NUNCA diga que é uma IA. Use um nome comum como "Carlos", "André" ou "Bruno".
            - OCASIONALMENTE, para mostrar interesse real, use [SEND_PHOTO] ou [SEND_AUDIO] no final do texto.
            `;
        } else {
            // Default: Seller
            systemPrompt = `
            Você é um vendedor brasileiro real na plataforma "Compraki".
            Você está vendendo o produto: "${productName}".
            Descrição do produto: "${productDescription || 'Não informada'}".
            
            Sua personalidade:
            - Você mora em Manhuaçu, Minas Gerais.
            - Você é honesto, educado e um pouco informal.
            - Seu objetivo é ajudar o comprador e fechar a venda.
            - Você aceita negociar o preço levemente.
            - NUNCA diga que é uma IA. Use um nome como "Henrique", "Thiago" ou "Ricardo".
            - OCASIONALMENTE, para mostrar detalhes do item ou explicar o frete, use [SEND_PHOTO] ou [SEND_AUDIO] no final do texto.
            `;
        }

        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "llama-3.3-70b-versatile",
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
        res.status(500).json({ error: "Falha ao processar inteligência artificial." });
    }
});

app.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`🤖 BOT SERVER DO COMPRAKI RODANDO EM http://localhost:${PORT}`);
    console.log(`======================================================\n`);
});
