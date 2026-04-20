const puppeteer = require('puppeteer');

/**
 * Busca produtos usados no Mercado Livre baseados em uma palavra-chave.
 * Retorna os dados prontos para serem usados pelo bot de cadastro.
 */
async function scrapeMercadoLivre(keyword, externalBrowser = null) {
    console.log(`[Scraper] Iniciando busca por: ${keyword}`);
    
    let browser = externalBrowser;
    const isExternal = !!externalBrowser;

    if (!isExternal) {
        browser = await puppeteer.launch({ 
            headless: true,
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
            ]
        });
    }
    
    try {
        const page = await browser.newPage();
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
        });

        // Url modernizada para produtos estritamente USADOS
        const searchUrl = `https://lista.mercadolivre.com.br/${keyword.replace(/ /g, '-')}/usado/_ItemCondition_2230581_NoIndex_True`;
        
        await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });

        const productLinks = await page.evaluate(() => {
            const selectors = [
                '.poly-component__title',
                '.poly-component__title a',
                '.ui-search-item__link',
                '.ui-search-link'
            ];
            
            let links = [];
            selectors.forEach(sel => {
                const elements = Array.from(document.querySelectorAll(sel));
                elements.forEach(el => {
                    if (el.href) links.push(el.href);
                    else {
                        const nested = el.querySelector('a');
                        if (nested && nested.href) links.push(nested.href);
                    }
                });
            });

            return [...new Set(links)].filter(href => href && href.includes('mercadolivre.com.br')).slice(0, 5); 
        });

        const scrapedProducts = [];

        for (const link of productLinks) {
            try {
                await page.goto(link, { waitUntil: 'networkidle2', timeout: 30000 });
                
                const data = await page.evaluate(() => {
                    const title = document.querySelector('.ui-pdp-title')?.innerText || 
                                 document.querySelector('.poly-component__title')?.innerText || '';
                                 
                    const fraction = document.querySelector('.andes-money-amount__fraction')?.innerText.replace(/\./g, '') || '0';
                    const cents = document.querySelector('.andes-money-amount__cents')?.innerText || '0';
                    const priceRaw = `${fraction}.${cents}`;
                    
                    const description = document.querySelector('.ui-pdp-description__content')?.innerText || '';
                    
                    // Pegar fotos de alta qualidade (Manipulando sufixos ML: -V ou -I para -O)
                    const imgElements = Array.from(document.querySelectorAll('.ui-pdp-gallery__figure img, .ui-pdp-image, .ui-pdp-thumbnail__picture img'));
                    
                    const imgs = imgElements.map(img => {
                        let src = img.getAttribute('data-zoom') || img.src || img.dataset.src;
                        if (!src || src.includes('pixel')) return null;
                        
                        // Converter para resolução original (-O)
                        // Ex: 123-V.webp -> 123-O.webp ou 123-I.jpg -> 123-O.jpg
                        return src.replace(/-[A-Z]\.(jpg|jpeg|png|webp|gif)/i, '-O.$1');
                    }).filter(src => src && src.startsWith('http'));

                    return {
                        name: title,
                        price: parseFloat(priceRaw),
                        description: description.substring(0, 500),
                        photos: [...new Set(imgs)].slice(0, 3) 
                    };
                });

                if (data.name) {
                    scrapedProducts.push({
                        ...data,
                        condition: 'usado',
                        categoryIds: ['eletrônicos'], // Categoria padrão se não mapeada
                        stock: 1
                    });
                }
            } catch (e) {
                console.error(`[Scraper] Erro ao extrair dados de ${link}:`, e.message);
            }
        }

        return scrapedProducts;
    } finally {
        if (!isExternal) {
            await browser.close();
        }
    }
}

module.exports = { scrapeMercadoLivre };
