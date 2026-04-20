const { scrapeMercadoLivre } = require('../automation/utils/scrapers');

async function test() {
    console.log('--- TESTANDO SCRAPER MERCADO LIVRE ---');
    const keyword = 'Playstation 4'; // O termo que falhou antes
    try {
        const results = await scrapeMercadoLivre(keyword);
        console.log(`\nEncontrados ${results.length} produtos:`);
        results.forEach((p, i) => {
            console.log(`\n[${i+1}] ${p.name}`);
            console.log(`    Preço: R$ ${p.price}`);
            console.log(`    Fotos: ${p.photos.length}`);
            console.log(`    Link da primeira foto: ${p.photos[0]}`);
        });
        
        if (results.length > 0) {
            console.log('\n✅ TESTE CONCLUÍDO COM SUCESSO!');
        } else {
            console.log('\n❌ TESTE FALHOU: Nenhum produto encontrado.');
        }
    } catch (err) {
        console.error('\n💥 ERRO DURANTE O TESTE:', err.message);
    }
}

test();
