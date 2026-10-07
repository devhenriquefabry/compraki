// Melhor Envio e Evolution API (WhatsApp) FALSOS, para testar no emulador as
// telas que dependem deles sem tocar nos serviços reais.
//
//   node functions/scripts/fake-integrations.mjs
//
// e em functions/.env.local (só o emulador lê; está no .gitignore):
//   MELHOR_ENVIO_API_URL=http://127.0.0.1:2626
//   EVOLUTION_API_URL=http://127.0.0.1:2727
//   EVOLUTION_API_KEY=chave-falsa-local
//
// Cada chamada recebida vai para FAKE_LOG (padrão: %TEMP%/fake-integrations.jsonl),
// que os testes leem para conferir o que as functions mandaram.

import http from 'node:http';
import fs from 'node:fs';

const LOG = process.env.FAKE_LOG || `${process.env.TEMP || '/tmp'}/fake-integrations.jsonl`;
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY || 'chave-falsa-local';
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function record(service, req, body) {
  fs.appendFileSync(LOG, JSON.stringify({ at: Date.now(), service, method: req.method, path: req.url, auth: req.headers.authorization || req.headers.apikey || null, body }) + '\n');
}

function serve(port, service, route) {
  http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => {
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
      record(service, req, body);
      const send = (status, data, type = 'application/json') => {
        res.writeHead(status, { 'Content-Type': type });
        res.end(type === 'application/json' ? JSON.stringify(data) : data);
      };
      try {
        route(req, body, send);
      } catch (error) {
        send(500, { message: String(error) });
      }
    });
  }).listen(port, '127.0.0.1', () => console.log(`${service} falso em http://127.0.0.1:${port}`));
}

// ---------------------------------------------------------------- Melhor Envio
let shipmentSeq = 0;
const shipments = new Map();

serve(2626, 'melhorenvio', (req, body, send) => {
  const url = req.url.split('?')[0];
  if (url.startsWith('/label/')) return send(200, '%PDF-1.4 etiqueta falsa', 'application/pdf');
  if (!/^Bearer \S+/.test(req.headers.authorization || '')) return send(401, { message: 'Unauthenticated.' });

  if (req.method === 'GET' && url === '/api/v2/me') {
    return send(200, { id: 'fake-user', firstname: 'Vineon', lastname: 'Teste', email: 'envios@vineon.test' });
  }
  if (req.method === 'POST' && url === '/api/v2/me/shipment/calculate') {
    if (!body?.from?.postal_code || !body?.to?.postal_code || !body?.products?.length) {
      return send(422, { message: 'The given data was invalid.', errors: { 'to.postal_code': ['obrigatório'] } });
    }
    return send(200, [
      { id: 1, name: 'PAC', price: '24.90', delivery_time: 6, company: { name: 'Correios', picture: '' } },
      { id: 2, name: 'SEDEX', price: '39.50', delivery_time: 2, company: { name: 'Correios', picture: '' } },
      { id: 17, name: 'Mini Envios', error: 'Dimensões acima do limite' },
    ]);
  }
  if (req.method === 'POST' && url === '/api/v2/me/cart') {
    // Regras de docs.melhorenvio.com.br/reference/inserir-fretes-no-carrinho
    const errors = {};
    const need = (path, ok) => { if (!ok) errors[path] = ['obrigatório ou inválido']; };
    need('service', !!body?.service);
    for (const side of ['from', 'to']) {
      const p = body?.[side] || {};
      for (const f of ['name', 'address', 'number', 'district', 'city', 'postal_code', 'state_abbr']) need(`${side}.${f}`, !!String(p[f] || '').trim());
      need(`${side}.country_id`, p.country_id === 'BR');
      need(`${side}.document`, /^\d{11}$/.test(p.document || '') || /^\d{14}$/.test(p.company_document || ''));
      need(`${side}.postal_code`, /^\d{8}$/.test(p.postal_code || ''));
      need(`${side}.state_abbr`, /^[A-Z]{2}$/.test(p.state_abbr || ''));
      if (p.document && !/^\d{11}$/.test(p.document)) errors[`${side}.document`] = ['CPF inválido (CNPJ vai em company_document)'];
    }
    need('products', Array.isArray(body?.products) && body.products.length > 0 && body.products.every(x => x.name && x.quantity && x.unitary_value));
    need('volumes', Array.isArray(body?.volumes) && body.volumes.length > 0 && body.volumes.every(v => Number.isInteger(v.height) && Number.isInteger(v.width) && Number.isInteger(v.length) && v.weight > 0));
    // Correios (1 = PAC, 2 = SEDEX), J&T e Loggi: um volume por etiqueta.
    if ([1, 2].includes(Number(body?.service)) && body?.volumes?.length > 1) errors.volumes = ['Correios não aceita múltiplos volumes em uma única requisição'];
    if (Object.keys(errors).length) return send(422, { message: 'The given data was invalid.', errors });
    const id = `fake-ord-${++shipmentSeq}`;
    shipments.set(id, { status: 'pending' });
    return send(201, { id, protocol: `ORD-${shipmentSeq}`, service_id: body.service, price: 24.9, status: 'pending' });
  }
  const orders = body?.orders || [];
  if (req.method === 'POST' && url === '/api/v2/me/shipment/checkout') {
    for (const id of orders) shipments.set(id, { status: 'released' });
    return send(200, { purchase: { id: `fake-pur-${Date.now()}`, total: 24.9, status: 'paid', orders: orders.map(id => ({ id })) } });
  }
  if (req.method === 'POST' && url === '/api/v2/me/shipment/generate') {
    return send(200, Object.fromEntries(orders.map(id => [id, { status: true, message: 'Envio gerado' }])));
  }
  if (req.method === 'POST' && url === '/api/v2/me/shipment/print') {
    return send(200, { url: `http://127.0.0.1:2626/label/${orders.join('-')}.pdf` });
  }
  if (req.method === 'POST' && url === '/api/v2/me/shipment/tracking') {
    return send(200, Object.fromEntries(orders.map(id => [id, { id, status: 'posted', tracking: 'BR123456789BR' }])));
  }
  if (req.method === 'GET' && url === '/api/v2/me/shipment/list') {
    return send(200, { data: [...shipments.entries()].map(([id, s]) => ({ id, status: s.status, price: 24.9, service: { company: { name: 'Correios' } } })) });
  }
  return send(404, { message: `rota falsa inexistente: ${req.method} ${url}` });
});

// ------------------------------------------------------------- Evolution API
const instances = new Map([['vineon-teste', 'open']]);

serve(2727, 'evolution', (req, body, send) => {
  if (req.headers.apikey !== EVOLUTION_KEY) return send(401, { message: 'Unauthorized' });
  const [, area, action, rawName] = req.url.split('?')[0].split('/');
  const name = decodeURIComponent(rawName || '');

  if (area === 'instance' && action === 'fetchInstances') {
    return send(200, [...instances.entries()].map(([n, state]) => ({ name: n, connectionStatus: state, ownerJid: '5511999990000@s.whatsapp.net', profileName: 'Vineon Teste' })));
  }
  if (area === 'instance' && action === 'create') {
    const n = body?.instanceName;
    if (!n) return send(400, { message: 'instanceName obrigatório' });
    if (instances.has(n)) return send(403, { message: `This name "${n}" is already in use.` });
    instances.set(n, 'connecting');
    return send(201, { instance: { instanceName: n, status: 'created' }, qrcode: { base64: `data:image/png;base64,${PNG_1PX}` } });
  }
  if (!instances.has(name) && area === 'instance' && action !== 'create') {
    return send(404, { message: `The "${name}" instance does not exist` });
  }
  if (area === 'instance' && action === 'connect') return send(200, { base64: `data:image/png;base64,${PNG_1PX}`, code: '2@fake', pairingCode: null, count: 1 });
  if (area === 'instance' && action === 'connectionState') return send(200, { instance: { instanceName: name, state: instances.get(name) } });
  if (area === 'instance' && action === 'logout') { instances.set(name, 'close'); return send(200, { status: 'SUCCESS', error: false }); }
  if (area === 'instance' && action === 'delete') { instances.delete(name); return send(200, { status: 'SUCCESS', error: false }); }
  if (area === 'message' && (action === 'sendText' || action === 'sendMedia')) {
    if (!body?.number) return send(400, { message: 'number obrigatório' });
    return send(201, { key: { remoteJid: `${body.number}@s.whatsapp.net`, fromMe: true, id: `FAKE${Date.now()}` }, status: 'PENDING' });
  }
  if (area === 'chat' && action === 'findChats') {
    return send(200, [
      { id: 'c1', remoteJid: '5511988887777@s.whatsapp.net', pushName: 'Cliente Teste', updatedAt: new Date().toISOString(), unreadCount: 1, lastMessage: { message: { conversation: 'Oi, meu pedido chegou?' }, messageTimestamp: Math.floor(Date.now() / 1000) } },
    ]);
  }
  if (area === 'chat' && action === 'findMessages') {
    const records = [
      { id: 'm1', key: { id: 'm1', fromMe: false, remoteJid: '5511988887777@s.whatsapp.net' }, pushName: 'Cliente Teste', messageType: 'conversation', message: { conversation: 'Oi, meu pedido chegou?' }, messageTimestamp: Math.floor(Date.now() / 1000) - 60 },
      { id: 'm2', key: { id: 'm2', fromMe: true, remoteJid: '5511988887777@s.whatsapp.net' }, messageType: 'conversation', message: { conversation: 'Chegou sim! Obrigado.' }, messageTimestamp: Math.floor(Date.now() / 1000) },
    ];
    return send(200, { messages: { total: records.length, pages: 1, currentPage: 1, records } });
  }
  if (area === 'chat' && action === 'getBase64FromMediaMessage') return send(200, { base64: PNG_1PX, mimetype: 'image/png' });
  return send(404, { message: `rota falsa inexistente: ${req.method} ${req.url}` });
});
