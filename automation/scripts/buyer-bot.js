const puppeteer = require('puppeteer');
const { generateUserData } = require('../utils/data-generator');

/**
 * BOT DE COMPRA (Simula um comprador real).
 */
async function run(config, log) {
    const { count = 1 } = config;
    const userData = await generateUserData();

    log(`[Comprador] 🌐 Abrindo navegador em modo visível (Mobile Mode)...`);
    const browser = await puppeteer.launch({ 
        headless: false,
        defaultViewport: null,
        args: [
            '--window-size=400,850',
            '--no-sandbox',
            '--disable-setuid-sandbox'
        ]
    });
    
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 375, height: 750, isMobile: true });

        // Auto-accept alerts
        page.on('dialog', async dialog => {
            log(`[Comprador] 🔔 Diálogo detectado: "${dialog.message()}". Aceitando...`);
            await dialog.accept();
        });

        // 1. SIGN-UP FLOW
        log(`[Comprador] 👤 Criando nova conta de comprador: ${userData.name}`);
        await page.goto('http://localhost:8100/sign-in', { waitUntil: 'networkidle2' });
        
        // Aguarda a aplicação estabilizar antes de digitar (Previne erros de input não montado)
        log(`[Comprador] ⏳ Aguardando 5s para estabilização da página...`);
        await new Promise(r => setTimeout(r, 5000));

        const safeType = async (selector, value, delay = 10) => {
            await page.waitForSelector(selector, { visible: true });
            await page.click(selector, { clickCount: 3 });
            await page.keyboard.press('Backspace');
            await page.type(selector, value, { delay });
        };

        await safeType('ion-input[formcontrolname="name"]', userData.name);
        await safeType('ion-input[formcontrolname="email"]', userData.email);
        await safeType('ion-input[formcontrolname="cpf"]', userData.cpf);
        await safeType('ion-input[formcontrolname="phone"]', userData.phone);
        
        await page.waitForSelector('ion-button.submitButton:not([disabled])', { visible: true });
        await page.click('ion-button.submitButton:not([disabled])');

        await page.waitForSelector('ion-input[formcontrolname="password"]', { visible: true });
        await safeType('ion-input[formcontrolname="password"]', userData.password);
        await safeType('ion-input[formcontrolname="repeatPassword"]', userData.password);
        
        await page.waitForSelector('ion-button.submitButton:not([disabled])', { visible: true });
        await page.click('ion-button.submitButton:not([disabled])');

        // Etapa 3: Endereço Detalhado (Para garantir validação total)
        await page.waitForSelector('ion-input[formcontrolname="cep"]', { visible: true });
        await safeType('ion-input[formcontrolname="cep"]', userData.cep);
        
        log(`[Comprador] ⏳ Aguardando 2s para processamento do CEP...`);
        await new Promise(r => setTimeout(r, 2000));

        if (userData.street) await safeType('ion-input[formcontrolname="street"]', userData.street);
        if (userData.neighborhood) await safeType('ion-input[formcontrolname="neighborhood"]', userData.neighborhood);
        if (userData.city) await safeType('ion-input[formcontrolname="city"]', userData.city);
        if (userData.state) await safeType('ion-input[formcontrolname="state"]', userData.state);
        
        await safeType('ion-input[formcontrolname="number"]', '123');
        
        log(`[Comprador] 🔍 Aguardando validação final da Etapa 3...`);
        await new Promise(r => setTimeout(r, 1500));

        await page.waitForSelector('ion-button.submitButton:not([disabled])', { visible: true, timeout: 5000 });
        await page.click('ion-button.submitButton:not([disabled])');
        await page.waitForNavigation();

        // 2. SHOPPING LOOP (Aleatório: 1 a 3 itens)
        const itemsToBuy = Math.floor(Math.random() * 3) + 1;
        log(`[Comprador] 🎲 Decidi comprar ${itemsToBuy} item(ns) nesta sessão.`);
        
        const purchasedIds = new Set();
        
        for (let i = 0; i < itemsToBuy; i++) {
            log(`[Comprador] 🛒 Analisando marketplace (Rodada ${i+1}/${itemsToBuy})...`);
            await page.goto('http://localhost:8100/tabs/tab2', { waitUntil: 'networkidle2' });
            
            // Aguarda os cards carregarem e extrai IDs aleatórios
            await page.waitForSelector('.marketplace-card', { visible: true, timeout: 15000 });
            
            const productIds = await page.evaluate(() => {
                const cards = Array.from(document.querySelectorAll('.marketplace-card'));
                return cards.map(c => c.getAttribute('data-id')).filter(id => !!id);
            });

            // Filtra IDs que já foram comprados nesta sessão para não repetir
            const availableIds = productIds.filter(id => !purchasedIds.has(id));

            if (availableIds.length === 0) {
                log(`[Aviso] Nenhum produto novo encontrado para comprar. Encerrando loop.`);
                break;
            }

            const randomId = availableIds[Math.floor(Math.random() * availableIds.length)];
            purchasedIds.add(randomId);
            
            log(`[Comprador] 🔗 Navegando diretamente para o produto ID: ${randomId}`);
            
            await page.goto(`http://localhost:8100/product-details/${randomId}`, { waitUntil: 'networkidle2' });
            
            await page.waitForSelector('.btn-buy-cart', { visible: true });
            log(`[Comprador] ➕ Adicionando ao carrinho via URL direta...`);
            await page.click('.btn-buy-cart');
            
            // Aguarda o redirecionamento para o carrinho (confirmação de sucesso)
            await page.waitForNavigation({ waitUntil: 'networkidle2' });
            log(`[Comprador] ✅ Item confirmado no carrinho.`);
            
            await new Promise(r => setTimeout(r, 2000));
        }

        // 3. CHECKOUT FLOW
        log(`[Comprador] 💳 Iniciando finalização de compra (Checkout)...`);
        await page.goto('http://localhost:8100/checkout', { waitUntil: 'networkidle2' });

        // Checkout Step 1: Comprador (já deve estar preenchido)
        await page.waitForSelector('.btn-next', { visible: true });
        await page.click('.btn-next');

        // Checkout Step 2: Entrega
        await page.waitForSelector('app-checkout-address', { visible: true });
        await page.click('.btn-next');

        // Checkout Step 3: Pagamento (Seleciona PIX por padrão)
        await page.waitForSelector('app-checkout-payment', { visible: true });
        await page.click('.btn-next');

        // Checkout Step 4: Resumo e Finalizar
        log(`[Comprador] 🏁 Confirmando pedido final...`);
        await page.waitForSelector('.btn-finish', { visible: true });
        await page.click('.btn-finish');

        log(`[Comprador] ✅ Pedido finalizado com sucesso por ${userData.name}!`);

    } catch (err) {
        log(`[Erro] Ocorreu uma falha no Comprador: ${err.message}`);
        throw err;
    } finally {
        await new Promise(r => setTimeout(r, 6000));
        await browser.close();
    }
}

module.exports = { run };
