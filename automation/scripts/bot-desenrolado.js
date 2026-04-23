const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { generateUserData } = require('../utils/data-generator');

/**
 * BOT DESENROLADO v2.0
 * Simula uma conversa infinita entre Vendedor e Comprador com suporte a mídias e modo headless.
 */
async function run(config, log) {
    const isHeadless = config.headless === true || config.headless === 'true';
    log(`[Desenrolado] 🚀 Iniciando simulação de auditoria (Modo: ${isHeadless ? 'Invisível' : 'Visível'})...`);

    let sellerBrowser, buyerBrowser;
    let sellerPage, buyerPage;
    let sharedState = {
        productName: 'Relógio Luxo ' + Math.floor(Math.random() * 1000),
        sellerName: '',
        productId: null,
        conversationActive: true
    };

    const browserArgs = [
        '--window-size=500,800',
        '--no-sandbox',
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--allow-file-access-from-files'
    ];

    try {
        log(`[Desenrolado] 🌐 Abrindo Janelas do Vendedor e Comprador...`);
        
        // Inicializa browsers com permissões de mídia
        const launchOptions = {
            headless: isHeadless ? 'new' : false,
            args: browserArgs,
            timeout: 60000
        };

        sellerBrowser = await puppeteer.launch(launchOptions);
        buyerBrowser = await puppeteer.launch(launchOptions);

        const contextSeller = sellerBrowser.defaultBrowserContext();
        const contextBuyer = buyerBrowser.defaultBrowserContext();
        await contextSeller.overridePermissions('http://localhost:8100', ['microphone']);
        await contextBuyer.overridePermissions('http://localhost:8100', ['microphone']);

        const sPages = await sellerBrowser.pages();
        const bPages = await buyerBrowser.pages();
        
        sellerPage = sPages[0];
        buyerPage = bPages[0];

        const acceptDialogs = async (dialog) => {
            log(`[Navegador] 🔔 Alerta: "${dialog.message()}". Aceitando...`);
            await dialog.accept();
        };
        sellerPage.on('dialog', acceptDialogs);
        buyerPage.on('dialog', acceptDialogs);

        await sellerPage.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
        await buyerPage.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });

        // 2. CADASTRO DO VENDEDOR
        const sellerData = await generateUserData();
        sharedState.sellerName = sellerData.name;
        log(`[Vendedor] 👤 Iniciando cadastro para: ${sellerData.name}`);
        await signUp(sellerPage, sellerData, log, '[Vendedor]');

        // 3. VENDEDOR CRIA PRODUTO
        log(`[Vendedor] 📦 Criando anúncio...`);
        await sellerPage.goto('http://localhost:8100/tabs/upload-product', { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 2000));
        
        await sellerPage.waitForSelector('input[formcontrolname="name"]', { visible: true });
        await sellerPage.type('input[formcontrolname="name"]', sharedState.productName, { delay: 20 });
        await sellerPage.type('input[formcontrolname="price"]', '150.00', { delay: 10 });
        await sellerPage.type('textarea[formcontrolname="description"]', 'Produto em excelente estado. Envio rápido.', { delay: 5 });
        
        try {
            await sellerPage.waitForSelector('.cat-chip', { visible: true, timeout: 5000 });
            await sellerPage.click('.cat-chip'); 
            await new Promise(r => setTimeout(r, 1000));
        } catch (e) {}

        log(`[Vendedor] 🚀 Publicando: ${sharedState.productName}`);
        await sellerPage.click('.btn-publish');
        await new Promise(r => setTimeout(r, 4000)); 
        
        try {
            await sellerPage.click('app-feedback-modal ion-button');
            await new Promise(r => setTimeout(r, 2000));
        } catch (e) {}
        
        await sellerPage.goto('http://localhost:8100/tabs/chats', { waitUntil: 'networkidle2' });

        // 4. CADASTRO DO COMPRADOR
        const buyerData = await generateUserData();
        sharedState.buyerName = buyerData.name;
        log(`[Comprador] 👥 Iniciando cadastro para: ${buyerData.name}`);
        await signUp(buyerPage, buyerData, log, '[Comprador]');

        // 5. COMPRADOR INICIA CHAT
        log(`[Comprador] 🔍 Buscando produto...`);
        await buyerPage.goto('http://localhost:8100/tabs/tab2', { waitUntil: 'networkidle2' });
        await buyerPage.waitForSelector('.search-bar input', { visible: true });
        await buyerPage.type('.search-bar input', sharedState.productName, { delay: 50 });
        await new Promise(r => setTimeout(r, 3000));
        await buyerPage.click('.marketplace-card');
        await new Promise(r => setTimeout(r, 3000));
        await buyerPage.click('.btn-chat');
        await new Promise(r => setTimeout(r, 5000));

        // 6. LOOP DE CONVERSA
        log(`[Auditoria] 🎧 Monitoramento de chat ativado.`);
        await sendMessage(buyerPage, "Olá! Ainda está disponível?", log, '[Comprador]');

        // VENDEDOR ABRE O CHAT
        try {
            log(`[Vendedor] 📥 Aguardando notificação de chat de ${sharedState.buyerName}...`);
            await sellerPage.waitForFunction((name) => {
                const items = Array.from(document.querySelectorAll('.chat-list ion-item h2, .chat-list ion-item .header-row'));
                return items.some(i => i.innerText.trim().toLowerCase().includes(name.toLowerCase()));
            }, { timeout: 35000 }, sharedState.buyerName.trim());

            await sellerPage.evaluate((name) => {
                const els = Array.from(document.querySelectorAll('.chat-list ion-item'));
                const el = els.find(i => i.innerText.toLowerCase().includes(name.toLowerCase()));
                if (el) el.click();
            }, sharedState.buyerName.trim());
            
            await new Promise(r => setTimeout(r, 4000));
        } catch (e) {
            log(`[Vendedor] ⚠️ Falha ao abrir chat: Não encontrei ${sharedState.buyerName} na lista.`);
        }

        while (sharedState.conversationActive) {
            // TURNO VENDEDOR
            log(`[Vendedor] ⌛ Aguardando...`);
            await waitForResponse(sellerPage);
            await new Promise(r => setTimeout(r, 2000));
            const sContext = await getChatHistory(sellerPage);
            log(`[Vendedor] 🧠 Processando...`);
            const sResp = await getAIResponse(sContext, sharedState.productName, 'seller');
            await handleResponse(sellerPage, sResp, log, '[Vendedor]');

            await new Promise(r => setTimeout(r, 4000));

            // TURNO COMPRADOR
            log(`[Comprador] ⌛ Aguardando...`);
            await waitForResponse(buyerPage);
            await new Promise(r => setTimeout(r, 2000));
            const bContext = await getChatHistory(buyerPage);
            log(`[Comprador] 🧠 Processando...`);
            const bResp = await getAIResponse(bContext, sharedState.productName, 'buyer');
            await handleResponse(buyerPage, bResp, log, '[Comprador]');

            await new Promise(r => setTimeout(r, 4000));
        }

    } catch (err) {
        log(`[Erro Crítico] ❌ ${err.message}`);
    } finally {
        if (sellerBrowser) await sellerBrowser.close();
        if (buyerBrowser) await buyerBrowser.close();
        log(`[Desenrolado] 🔚 Simulação finalizada.`);
    }
}

async function handleResponse(page, rawText, log, prefix) {
    let cleanText = rawText.replace(/\[SEND_PHOTO\]/g, '').replace(/\[SEND_AUDIO\]/g, '').trim();
    
    // Envia o texto primeiro (se houver)
    if (cleanText) {
        await sendMessage(page, cleanText, log, prefix);
    }

    // Executa ações de mídia se detectadas
    if (rawText.includes('[SEND_PHOTO]')) {
        await sendPhoto(page, log, prefix);
    }
    if (rawText.includes('[SEND_AUDIO]')) {
        await sendAudio(page, log, prefix);
    }
}

async function sendPhoto(page, log, prefix) {
    log(`${prefix} 📷 Enviando foto de teste...`);
    try {
        const photoPath = path.join(process.cwd(), 'automation', 'assets', 'test-photo.png');
        if (!fs.existsSync(photoPath)) throw new Error("Foto de teste não encontrada!");
        
        const fileInput = await page.waitForSelector('input[type="file"]', { timeout: 5000 });
        await fileInput.uploadFile(photoPath);
        await new Promise(r => setTimeout(r, 3000)); 
    } catch (e) {
        log(`${prefix} ⚠️ Erro ao enviar foto: ${e.message}`);
    }
}

async function sendAudio(page, log, prefix) {
    log(`${prefix} 🎤 Gravando áudio (3s)...`);
    try {
        const micSelector = '.btn-mic';
        await page.waitForSelector(micSelector, { visible: true });
        
        // Simula touchstart para começar a gravar
        await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            const event = new TouchEvent('touchstart', { bubbles: true, cancelable: true });
            el.dispatchEvent(event);
        }, micSelector);

        await new Promise(r => setTimeout(r, 3500)); // Grava por 3.5s

        // Simula touchend para enviar
        await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            const event = new TouchEvent('touchend', { bubbles: true, cancelable: true });
            el.dispatchEvent(event);
        }, micSelector);
        
        await new Promise(r => setTimeout(r, 2000));
    } catch (e) {
        log(`${prefix} ⚠️ Erro ao gravar áudio: ${e.message}`);
    }
}

async function signUp(page, data, log, prefix) {
    const safeType = async (selector, value) => {
        await page.waitForSelector(selector, { visible: true, timeout: 10000 });
        await page.click(selector, { clickCount: 3 });
        await page.keyboard.press('Backspace');
        await page.type(selector, value, { delay: 20 });
    };

    await page.goto('http://localhost:8100/sign-in', { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 2000));

    await safeType('ion-input[formcontrolname="name"]', data.name);
    await safeType('ion-input[formcontrolname="email"]', data.email);
    await safeType('ion-input[formcontrolname="cpf"]', data.cpf);
    await safeType('ion-input[formcontrolname="phone"]', data.phone);
    await page.click('ion-button.submitButton');
    
    await page.waitForSelector('ion-input[formcontrolname="password"]', { visible: true });
    await safeType('ion-input[formcontrolname="password"]', data.password);
    await safeType('ion-input[formcontrolname="repeatPassword"]', data.password);
    await page.click('ion-button.submitButton');
    
    await page.waitForSelector('ion-input[formcontrolname="cep"]', { visible: true });
    await safeType('ion-input[formcontrolname="cep"]', data.cep);
    await new Promise(r => setTimeout(r, 3000)); 
    await safeType('ion-input[formcontrolname="street"]', data.street || 'Rua Principal');
    await safeType('ion-input[formcontrolname="number"]', '123');
    await safeType('ion-input[formcontrolname="neighborhood"]', data.neighborhood || 'Centro');
    await safeType('ion-input[formcontrolname="city"]', data.city || 'Manhuaçu');
    await safeType('ion-input[formcontrolname="state"]', data.state || 'MG');
    await page.click('ion-button.submitButton');
    
    try {
        await page.waitForFunction(() => window.location.href.includes('/tabs'), { timeout: 30000 });
    } catch (e) {}
}

async function sendMessage(page, text, log, prefix) {
    try {
        const inputSelector = 'ion-input.message-input';
        await page.waitForSelector(inputSelector, { visible: true, timeout: 5000 });
        
        // Foca o input usando a API do Web Component
        await page.evaluate(async (sel) => {
            const el = document.querySelector(sel);
            if (el && el.setFocus) {
                await el.setFocus();
            }
        }, inputSelector);
        
        await new Promise(r => setTimeout(r, 500));
        
        // Limpa e digita
        await page.keyboard.down('Control');
        await page.keyboard.press('A');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');
        
        await page.keyboard.type(text, { delay: 30 });
        await new Promise(r => setTimeout(r, 500));
        await page.keyboard.press('Enter');
        
        // Clica no ícone de enviar como garantia
        const sendBtn = 'ion-button.btn-send-text';
        const exists = await page.$(sendBtn);
        if (exists) {
            await page.click(sendBtn);
        } else {
            // Fallback usando evaluate
            await page.evaluate(() => {
                const btn = document.querySelector('ion-button.btn-send-text');
                if (btn) btn.click();
            });
        }
        
        log(`${prefix} 📤: "${text}"`);
    } catch (e) {
        log(`${prefix} ⚠️ Falha na digitação: ${e.message}`);
    }
}

async function waitForResponse(page) {
    await page.waitForFunction(() => {
        const msgs = Array.from(document.querySelectorAll('.msg-bubble, .message-bubble'));
        if (msgs.length === 0) return false;
        const lastMsg = msgs[msgs.length - 1].closest('.msg-wrapper');
        return lastMsg && !lastMsg.classList.contains('msg-me');
    }, { timeout: 120000 }); 
}

async function getChatHistory(page) {
    return await page.evaluate(() => {
        const bubbles = Array.from(document.querySelectorAll('.msg-bubble, .message-bubble'));
        return bubbles.map(b => {
            const wrapper = b.closest('.msg-wrapper');
            return {
                role: wrapper?.classList.contains('msg-me') ? 'assistant' : 'user',
                content: b.innerText || ""
            };
        });
    });
}

async function getAIResponse(messages, productName, role) {
    try {
        const res = await axios.post('http://localhost:3001/ai/chat', { messages, productName, role });
        return res.data.choices[0].message.content;
    } catch (e) {
        return "Legal! Gostei muito.";
    }
}

module.exports = { run };
