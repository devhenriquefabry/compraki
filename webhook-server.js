const http = require('http');

const PORT = 3000;

const server = http.createServer((req, res) => {
  // Ignora favicon e outros métodos que não sejam POST
  if (req.url === '/favicon.ico') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Lida com preflight/CORS básico
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, asaas-access-token');
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method === 'POST') {
    // Autenticação de Segurança Opcional, mas altamente recomendada:
    const asaasToken = req.headers['asaas-access-token'];
    const meuToken = 'whsec_RS2WNLw9r2sJr6H80ctPiF0nosAdDXZNpTcdp80WsdM';

    if (asaasToken !== meuToken) {
      console.log('⛔ BLOQUEADO: Tentativa de Webhook com token inválido ou ausente!');
      res.writeHead(401, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        
        console.log('\n======================================================');
        console.log(`🚀 NOVO EVENTO DO ASAAS DETECTADO: [ ${payload.event} ]`);
        console.log('======================================================');
        
        // Loga informações importantes da cobrança caso existam
        if (payload.payment) {
          console.log(`• Status: ${payload.payment.status}`);
          console.log(`• Valor: R$ ${payload.payment.value}`);
          console.log(`• ID: ${payload.payment.id}`);
          console.log(`• Forma de Pagamento: ${payload.payment.billingType}`);
        }

        // Mostra o JSON completo
        console.log('\n--- DATALHES COMPLETOS (JSON) ---');
        console.log(JSON.stringify(payload, null, 2));
        console.log('------------------------------------------------------\n');
        
        // Responde ao Asaas com 200 OK informando sucesso
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ received: true }));
      } catch (err) {
        console.error('❌ Erro recebendo webhook: formato inválido!', err);
        res.writeHead(400);
        res.end();
      }
    });
  } else {
    res.writeHead(404);
    res.end('Use requisições POST para enviar webhook.');
  }
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`✅ Servidor Webhook do Compraki rodando em http://localhost:${PORT}`);
  console.log(`======================================================`);
  console.log(`\nPara conectar o Asaas neste servidor local, abra um NOVO terminal`);
  console.log(`do VSCode (clique no +, ao lado de 'node'/'powershell') e rode:`);
  console.log(`\n👉  npx localtunnel --port ${PORT}\n`);
  console.log(`Copie a URL "your url is: https://..." que aparecer`);
  console.log(`e cole no painel do Asaas. Marque "Fila de sincronização" como SIM.`);
});
