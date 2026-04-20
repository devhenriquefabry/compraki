const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { generateUserData } = require('../utils/data-generator');
const { scrapeMercadoLivre } = require('../utils/scrapers');

/**
 * Download de imagem para upload subsequente.
 */
async function downloadImage(url, filename) {
    const dir = path.join(__dirname, '..', '..', 'automation', 'assets', 'products');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    
    const filePath = path.join(dir, filename);
    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream'
    });
    return new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);
        writer.on('finish', () => resolve(filePath));
        writer.on('error', reject);
    });
}

const KEYWORD_POOL = [
    'iPhone', 'Nintendo Switch', 'Monitor Gamer', 'Cadeira Office', 'Samsung Galaxy',
    'Fone Bluetooth', 'Teclado Mecânico', 'Playstation 5', 'Smartwatch', 'Notebook',
    'Câmera Canon', 'Violão', 'Drone', 'Tênis Nike', 'Mochila'
];

const llmHelper = require('../utils/llm-helper');

/**
 * BOT DE POPULAMENTO (Autônomo: Cria usuário e anuncia produtos reais).
 */
async function run(config, log) {
    let { keyword, count } = config;
    const userData = await generateUserData();

    // Lógica Autônoma via IA (Groq/Grok)
    if (!keyword || keyword.trim() === '') {
        const aiKeyword = await llmHelper.generateCreativeKeyword();
        keyword = aiKeyword || KEYWORD_POOL[Math.floor(Math.random() * KEYWORD_POOL.length)];
        log(`[IA - Groq] Decidi pesquisar por: "${keyword}"`);
    }

    if (!count || count <= 0) {
        count = Math.floor(Math.random() * 3) + 1; // 1 a 3 produtos
    }

    try {
        log(`[Populador] 🌐 Abrindo browsers de operação (Busca e App)...`);
        
        // 1. Navegador de Pesquisa (Desktop)
        scraperBrowser = await puppeteer.launch({ 
            headless: false,
            args: ['--window-size=1000,800', '--no-sandbox']
        });

        // 2. Navegador do Aplicativo (Mobile)
        appBrowser = await puppeteer.launch({ 
            headless: false,
            args: ['--window-size=400,850', '--no-sandbox']
        });

        let products = [];
        let attempts = 0;
        const maxAttempts = 3;

        while (products.length === 0 && attempts < maxAttempts) {
            if (attempts > 0) {
                log(`[IA - Groq] Tentativa anterior falhou. Buscando nova ideia inusitada...`);
                keyword = await llmHelper.generateCreativeKeyword();
                log(`[IA - Groq] Nova tentativa (${attempts + 1}/${maxAttempts}) com: "${keyword}"`);
            }
            
            log(`[Populador] 🔍 Buscando anúncios reais de "${keyword}" na janela de pesquisa...`);
            products = await scrapeMercadoLivre(keyword, scraperBrowser);
            attempts++;
        }
        
        if (products.length === 0) {
            throw new Error(`[IA] Falha crítica: Nenhuma das ${maxAttempts} tentativas de busca retornou resultados.`);
        }

        // Fecha o browser de pesquisa após sucesso (economia de recursos)
        await scraperBrowser.close();
        scraperBrowser = null;

        // 3. Preparação do App
        const pages = await appBrowser.pages();
        activeAppPage = pages[0] || await appBrowser.newPage();
        await activeAppPage.setViewport({ width: 375, height: 750, isMobile: true });

        // Auto-accept alert/confirm dialogs
        activeAppPage.on('dialog', async dialog => {
            log(`[Navegador] 🔔 Diálogo detectado: "${dialog.message()}". Aceitando automaticamente...`);
            await dialog.accept();
        });

        // 1. SIGN-UP FLOW
        log(`[Populador] 👤 Cadastrando novo usuário na janela Mobile: ${userData.name}`);
        await activeAppPage.goto('http://localhost:8100/sign-in', { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 2000)); // Espera inicial para estabilidade do Angular

        /**
         * Executa um passo de forma autônoma com autocura via IA.
         */
        const performAutonomousStep = async (stepName, actionFn, maxRetries = 2) => {
            let attempt = 0;
            while (attempt <= maxRetries) {
                try {
                    return await actionFn();
                } catch (err) {
                    attempt++;
                    log(`[Autocura] 🤖 Detectei falha na etapa "${stepName}". Consultando a IA...`);
                    const advice = await llmHelper.analyzeError(err.message, stepName);
                    log(`[IA - Groq] Sugestão: ${advice}`);
                    
                    if (attempt > maxRetries) throw err;
                    
                    // Pequeno delay e tentativa de recuperação genérica baseada na IA
                    await new Promise(r => setTimeout(r, 2000));
                    if (advice.toLowerCase().includes('esperar')) await new Promise(r => setTimeout(r, 5000));
                    if (advice.toLowerCase().includes('recarregar')) await activeAppPage.reload({ waitUntil: 'networkidle2' });

                    log(`[Autocura] Tentativa ${attempt}/${maxRetries} após conselho da IA...`);
                }
            }
        };

        // Etapa 1
        await performAutonomousStep('Preenchimento Dados Pessoais', async () => {
            await activeAppPage.waitForSelector('ion-input[formcontrolname="name"]', { visible: true, timeout: 5000 });
            
            const safeType = async (selector, value, delay = 10) => {
                await activeAppPage.click(selector, { clickCount: 3 });
                await activeAppPage.keyboard.press('Backspace');
                await activeAppPage.type(selector, value, { delay });
                // Verifica se o valor foi realmente digitado
                const val = await activeAppPage.$eval(selector, el => el.value);
                if (val !== value) await activeAppPage.type(selector, value, { delay: 20 });
            };

            await safeType('ion-input[formcontrolname="name"]', userData.name, 20);
            await safeType('ion-input[formcontrolname="email"]', userData.email, 10);
            await safeType('ion-input[formcontrolname="cpf"]', userData.cpf, 10);
            await safeType('ion-input[formcontrolname="phone"]', userData.phone, 10);
            
            log(`[Populador] 🔍 Verificando campos da Etapa 1...`);
            await new Promise(r => setTimeout(r, 1000)); // Pequena pausa para o Angular validar
            
            await activeAppPage.waitForSelector('ion-button.submitButton:not([disabled])', { visible: true, timeout: 5000 });
            await activeAppPage.click('ion-button.submitButton:not([disabled])');
        });

        // Etapa 2
        await performAutonomousStep('Configuração de Senha', async () => {
            await activeAppPage.waitForSelector('ion-input[formcontrolname="password"]', { visible: true, timeout: 5000 });
            
            const typePassword = async (selector, value) => {
                await activeAppPage.click(selector, { clickCount: 3 });
                await activeAppPage.keyboard.press('Backspace');
                await activeAppPage.type(selector, value, { delay: 20 });
            };

            await typePassword('ion-input[formcontrolname="password"]', userData.password);
            await typePassword('ion-input[formcontrolname="repeatPassword"]', userData.password);
            
            await new Promise(r => setTimeout(r, 1000)); 
            await activeAppPage.waitForSelector('ion-button.submitButton:not([disabled])', { visible: true, timeout: 5000 });
            await activeAppPage.click('ion-button.submitButton:not([disabled])');
        });

        // Etapa 3
        await performAutonomousStep('Endereço via IA', async () => {
            await activeAppPage.waitForSelector('ion-input[formcontrolname="cep"]', { visible: true, timeout: 5000 });
            
            const safeType = async (selector, value, delay = 10) => {
                await activeAppPage.click(selector, { clickCount: 3 });
                await activeAppPage.keyboard.press('Backspace');
                await activeAppPage.type(selector, value, { delay });
            };

            await safeType('ion-input[formcontrolname="cep"]', userData.cep, 20);
            await new Promise(r => setTimeout(r, 1000)); // Pequena pausa pro Angular processar
            
            if (userData.street) await safeType('ion-input[formcontrolname="street"]', userData.street, 10);
            if (userData.neighborhood) await safeType('ion-input[formcontrolname="neighborhood"]', userData.neighborhood, 10);
            if (userData.city) await safeType('ion-input[formcontrolname="city"]', userData.city, 10);
            if (userData.state) await safeType('ion-input[formcontrolname="state"]', userData.state, 10);
            
            await safeType('ion-input[formcontrolname="number"]', '777', 20);
            
            await new Promise(r => setTimeout(r, 1500));
            await activeAppPage.waitForSelector('ion-button.submitButton:not([disabled])', { visible: true, timeout: 5000 });
            await activeAppPage.click('ion-button.submitButton:not([disabled])');
        });

        // 2. WAIT FOR LOGIN
        log(`[Populador] 🛡️ Validando cadastro e preparando anúncios...`);
        await activeAppPage.waitForNavigation({ timeout: 30000 });
        
        // 3. UPLOAD PRODUCTS LOOP
        for (let i = 0; i < Math.min(count, products.length); i++) {
            const p = products[i];
            log(`[Populador] 📦 Anunciando produto ${i+1}/${count}: ${p.name}`);

            await performAutonomousStep(`Upload de Produto: ${p.name}`, async () => {
                await activeAppPage.goto('http://localhost:8100/tabs/upload-product', { waitUntil: 'networkidle2' });
                
                await activeAppPage.waitForSelector('input[formcontrolname="name"]', { visible: true, timeout: 5000 });
                await activeAppPage.type('input[formcontrolname="name"]', p.name);
                await activeAppPage.type('input[formcontrolname="price"]', p.price.toString());
                await activeAppPage.type('textarea[formcontrolname="description"]', p.description);
                
                try {
                    await activeAppPage.waitForSelector('.cat-chip', { timeout: 3000 });
                    await activeAppPage.click('.cat-chip');
                } catch (e) { log('[Warning] Nenhuma categoria encontrada visualmente.'); }

                log(`[Populador] 🖼️ Processando imagens...`);
                const photoPaths = [];
                for (let j = 0; j < p.photos.length; j++) {
                    try {
                       const localPath = await downloadImage(p.photos[j], `prod_${i}_${j}.jpg`);
                       photoPaths.push(localPath);
                    } catch (err) { /* ignore single image fail */ }
                }

                if (photoPaths.length > 0) {
                    const inputHandle = await activeAppPage.waitForSelector('input[type="file"]');
                    await inputHandle.uploadFile(...photoPaths);
                }
                
                await new Promise(r => setTimeout(r, 2000));
                
                log(`[Populador] 🚀 Publicando anúncio...`);
                await activeAppPage.click('.btn-publish'); 
                await new Promise(r => setTimeout(r, 4000)); // Espera modal de sucesso
            });
        }

        log(`[Populador] ✨ Missão concluída com sucesso para ${userData.name}!`);

    } catch (err) {
        log(`[Erro] Ocorreu uma falha no Populador: ${err.message}`);
        
        // Diagnóstico por screenshot (agora com acesso à variável activeAppPage)
        if (activeAppPage) {
            try {
                const tmpDir = path.join(__dirname, '..', '..', '.gemini', 'tmp');
                if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
                
                const errorPath = path.join(tmpDir, 'bot_error.png');
                log(`[Diagnóstico] 📸 Salvando print do erro em: ${errorPath}`);
                await activeAppPage.screenshot({ path: errorPath, fullPage: true });
            } catch (screenshotErr) {
                log(`[Diagnóstico] ❌ Falha ao tirar print: ${screenshotErr.message}`);
            }
        }
        throw err;
    } finally {
        log(`[Populador] 🔚 Encerrando processos...`);
        if (scraperBrowser) await scraperBrowser.close();
        if (appBrowser) await appBrowser.close();
    }
}

module.exports = { run };
