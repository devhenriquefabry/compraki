// Servidor do site no App Hosting (ver `scripts.runCommand` no apphosting.yaml).
//
// Faz duas coisas:
//
// 1. Proxy de /__/auth/* e /__/firebase/* para compraki-mcu.firebaseapp.com.
//    E o que permite usar `authDomain: www.vineonsite.com.br`: o popup do
//    Google passa a dizer "Prosseguir para www.vineonsite.com.br" em vez do
//    dominio do Firebase. Receita oficial: opcao "proxy" em
//    https://firebase.google.com/docs/auth/web/redirect-best-practices
//
// 2. Serve o build Angular de www/browser, com fallback para index.html em
//    rota desconhecida (deep link sobrevive ao F5) — o que o adaptador do
//    App Hosting fazia antes.
//
// Sem dependencia: so modulos do Node, para nao depender de node_modules no
// container.

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT) || 8080;
const AUTH_ORIGIN = 'https://compraki-mcu.firebaseapp.com';
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), 'www', 'browser');
const INDEX = join(ROOT, 'index.html');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wasm': 'application/wasm',
};

// Cabecalhos que nao podem ser repassados de um salto para o outro.
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'te', 'trailer',
  'proxy-authenticate', 'proxy-authorization', 'host', 'content-length',
  'content-encoding',
]);

async function proxyAuth(req, res) {
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.has(k) && v !== undefined) headers[k] = Array.isArray(v) ? v.join(', ') : v;
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const upstream = await fetch(AUTH_ORIGIN + req.url, {
    method: req.method,
    headers,
    body: hasBody ? req : undefined,
    duplex: hasBody ? 'half' : undefined,
    // Redirect volta para o navegador como esta: quem segue e ele.
    redirect: 'manual',
  });

  const out = {};
  upstream.headers.forEach((v, k) => {
    if (!HOP_BY_HOP.has(k) && k !== 'set-cookie') out[k] = v;
  });
  const cookies = upstream.headers.getSetCookie?.() ?? [];
  if (cookies.length) out['set-cookie'] = cookies;
  res.writeHead(upstream.status, out);

  if (!upstream.body || req.method === 'HEAD') return res.end();
  for await (const chunk of upstream.body) res.write(chunk);
  res.end();
}

async function fileFor(pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const full = normalize(join(ROOT, rel));
  if (full !== ROOT && !full.startsWith(ROOT + sep)) return null;
  try {
    const s = await stat(full);
    if (s.isFile()) return { path: full, size: s.size };
  } catch {}
  return null;
}

async function serveStatic(req, res) {
  const pathname = new URL(req.url, 'http://x').pathname;
  let file = await fileFor(pathname);
  let isIndex = false;

  if (!file) {
    // Arquivo com extensao que nao existe e 404 de verdade; o resto e rota
    // do Angular.
    if (extname(pathname)) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    file = await fileFor('/index.html');
    isIndex = true;
  }
  if (file.path === INDEX) isIndex = true;

  const ext = extname(file.path).toLowerCase();
  // index.html sempre revalida (aponta para os chunks do deploy atual); os
  // chunks tem hash no nome e podem ficar em cache para sempre.
  const hashed = /-[A-Z0-9]{8}\.(js|css)$/.test(file.path);
  const cache = isIndex
    ? 'no-cache'
    : hashed
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=3600';

  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'content-length': file.size,
    'cache-control': cache,
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file.path).pipe(res);
}

createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/__/auth/') || req.url.startsWith('/__/firebase/')) {
      return await proxyAuth(req, res);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' });
      return res.end();
    }
    await serveStatic(req, res);
  } catch (err) {
    console.error(req.method, req.url, err);
    if (!res.headersSent) res.writeHead(502);
    res.end();
  }
}).listen(PORT, () => console.log(`vineon ouvindo na porta ${PORT}`));
