#!/usr/bin/env node
/**
 * Ferramentas de linha de comando para a integracao com o Cora.
 * Le as credenciais do functions/.env (o mesmo que vai para as Functions).
 *
 *   node scripts/cora.mjs import-cert <certificate.pem> <private-key.key>
 *       Grava CORA_CERTIFICATE e CORA_PRIVATE_KEY (base64) no functions/.env.
 *   node scripts/cora.mjs token
 *       Testa as credenciais: pede um access token ao Cora.
 *   node scripts/cora.mjs webhooks [list|register|delete <id>]
 *       Lista / cadastra (invoice.paid e invoice.canceled) / remove endpoints.
 *   node scripts/cora.mjs invoice <inv_...>
 *       Mostra o status de uma fatura.
 *   node scripts/cora.mjs pay <inv_...>
 *       SO STAGE: simula o pagamento de uma fatura (dispara o webhook).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { request, Agent } from 'node:https';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(here, '..', '.env');
const FIREBASERC = resolve(here, '..', '..', '.firebaserc');

const BASE_URLS = {
  stage: 'https://matls-clients.api.stage.cora.com.br',
  production: 'https://matls-clients.api.cora.com.br'
};

function readEnvFile() {
  const text = readFileSync(ENV_PATH, 'utf8').replace(/^﻿/, '');
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return { text, env };
}

function setEnvVar(text, key, value) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  return re.test(text) ? text.replace(re, line) : `${text.replace(/\s*$/, '')}\n${line}\n`;
}

function decodePem(raw) {
  const v = (raw || '').trim();
  return v.includes('-----BEGIN') ? v.replace(/\\n/g, '\n') : Buffer.from(v, 'base64').toString('utf8');
}

function config() {
  const { env } = readEnvFile();
  const coraEnv = (env.CORA_ENV || '').toLowerCase() === 'production' ? 'production' : 'stage';
  if (!env.CORA_CLIENT_ID || !env.CORA_CERTIFICATE || !env.CORA_PRIVATE_KEY) {
    fail('Preencha CORA_CLIENT_ID e rode `import-cert` antes (functions/.env).');
  }
  return {
    env,
    coraEnv,
    baseUrl: (env.CORA_API_URL || BASE_URLS[coraEnv]).replace(/\/+$/, ''),
    agent: new Agent({ cert: decodePem(env.CORA_CERTIFICATE), key: decodePem(env.CORA_PRIVATE_KEY) })
  };
}

function fail(message) {
  console.error(`ERRO: ${message}`);
  process.exit(1);
}

function send(cfg, method, path, headers = {}, body) {
  return new Promise((ok, ko) => {
    const req = request(new URL(cfg.baseUrl + path), {
      method,
      agent: cfg.agent,
      headers: {
        Accept: 'application/json',
        ...headers,
        ...(body !== undefined ? { 'Content-Length': Buffer.byteLength(body) } : {})
      },
      timeout: 20000
    }, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        let json;
        try { json = data ? JSON.parse(data) : {}; } catch { json = { raw: data }; }
        ok({ status: res.statusCode, json });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', ko);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

async function token(cfg) {
  const form = new URLSearchParams({ grant_type: 'client_credentials', client_id: cfg.env.CORA_CLIENT_ID }).toString();
  const res = await send(cfg, 'POST', '/token', { 'Content-Type': 'application/x-www-form-urlencoded' }, form);
  if (res.status !== 200 || !res.json.access_token) {
    fail(`token recusado (${res.status}): ${JSON.stringify(res.json)}`);
  }
  return res.json;
}

async function api(cfg, method, path, body) {
  const { access_token } = await token(cfg);
  const headers = { Authorization: `Bearer ${access_token}` };
  if (method !== 'GET') headers['Idempotency-Key'] = randomUUID();
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await send(cfg, method, path, headers, body !== undefined ? JSON.stringify(body) : undefined);
  if (res.status < 200 || res.status >= 300) fail(`${method} ${path} -> ${res.status}: ${JSON.stringify(res.json)}`);
  return res.json;
}

function webhookUrl(env) {
  if (!env.CORA_WEBHOOK_TOKEN) fail('Defina CORA_WEBHOOK_TOKEN no functions/.env.');
  let projectId = 'compraki-mcu';
  try { projectId = JSON.parse(readFileSync(FIREBASERC, 'utf8')).projects.default || projectId; } catch { /* padrao */ }
  return `https://us-central1-${projectId}.cloudfunctions.net/coraWebhook?token=${encodeURIComponent(env.CORA_WEBHOOK_TOKEN)}`;
}

const [cmd, ...args] = process.argv.slice(2);

switch (cmd) {
  case 'import-cert': {
    const [certPath, keyPath] = args;
    if (!certPath || !keyPath) fail('uso: import-cert <certificate.pem> <private-key.key>');
    const cert = readFileSync(certPath, 'utf8');
    const key = readFileSync(keyPath, 'utf8');
    if (!cert.includes('-----BEGIN')) fail(`${certPath} nao parece um PEM.`);
    if (!key.includes('-----BEGIN')) fail(`${keyPath} nao parece uma chave PEM.`);
    let { text } = readEnvFile();
    const bom = readFileSync(ENV_PATH, 'utf8').startsWith('﻿') ? '﻿' : '';
    text = setEnvVar(text, 'CORA_CERTIFICATE', Buffer.from(cert).toString('base64'));
    text = setEnvVar(text, 'CORA_PRIVATE_KEY', Buffer.from(key).toString('base64'));
    writeFileSync(ENV_PATH, bom + text);
    console.log('OK: CORA_CERTIFICATE e CORA_PRIVATE_KEY gravados em functions/.env.');
    console.log('Pode apagar os arquivos originais de onde estiverem (Downloads etc.).');
    break;
  }
  case 'token': {
    const cfg = config();
    const t = await token(cfg);
    console.log(`OK: autenticado no Cora (${cfg.coraEnv}, ${cfg.baseUrl}). Token valido por ${t.expires_in}s.`);
    break;
  }
  case 'webhooks': {
    const cfg = config();
    const sub = args[0] || 'list';
    if (sub === 'list') {
      console.log(JSON.stringify(await api(cfg, 'GET', '/endpoints'), null, 2));
    } else if (sub === 'register') {
      const url = webhookUrl(cfg.env);
      for (const trigger of ['paid', 'canceled']) {
        const created = await api(cfg, 'POST', '/endpoints', { url, resource: 'invoice', trigger });
        console.log(`OK: invoice.${trigger} -> ${created.id}`);
      }
      console.log(`URL cadastrada: ${url.replace(/token=.*/, 'token=***')}`);
    } else if (sub === 'delete') {
      if (!args[1]) fail('uso: webhooks delete <end_...>');
      await api(cfg, 'DELETE', `/endpoints/${encodeURIComponent(args[1])}`);
      console.log(`OK: endpoint ${args[1]} removido.`);
    } else {
      fail('uso: webhooks [list|register|delete <id>]');
    }
    break;
  }
  case 'invoice': {
    if (!args[0]) fail('uso: invoice <inv_...>');
    const inv = await api(config(), 'GET', `/v2/invoices/${encodeURIComponent(args[0])}`);
    console.log(JSON.stringify({ id: inv.id, status: inv.status, total_amount: inv.total_amount, total_paid: inv.total_paid }, null, 2));
    break;
  }
  case 'pay': {
    const cfg = config();
    if (cfg.coraEnv !== 'stage') fail('pay so existe no stage (CORA_ENV=stage).');
    if (!args[0]) fail('uso: pay <inv_...>');
    const res = await api(cfg, 'POST', '/v2/invoices/pay', { id: args[0] });
    console.log('OK: pagamento simulado.', JSON.stringify(res));
    break;
  }
  default:
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\n\/\*\*?/, ''));
}
