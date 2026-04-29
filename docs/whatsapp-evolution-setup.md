# WhatsApp Multi-instancia com Evolution API

Este documento descreve como preparar o servidor de WhatsApp usando Evolution API, Neon Postgres, Upstash Redis, Railway/Render/Fly e Firebase Functions.

## O que foi criado no projeto

- `docker-compose.evolution.yml`: sobe a Evolution API localmente com Docker.
- `evolution/.env.example`: modelo de variaveis para uso local.
- `evolution/railway.example.env`: modelo de variaveis para Railway/Render/Fly.
- `firebase.json`: configuracao inicial das Firebase Functions.
- `functions/src/index.ts`: proxy seguro para a Evolution API e webhook global.
- `src/app/services/whatsapp-instances.service.ts`: servico Angular para gerenciar instancias.

## Checklist das contas

### Neon

1. Criar uma conta em `https://neon.com`.
2. Criar um projeto Postgres.
3. Criar ou selecionar um database para a Evolution API.
4. Copiar a connection string com SSL.
5. Preencher:
   - `DATABASE_CONNECTION_URI=postgresql://USER:PASSWORD@HOST.neon.tech/DBNAME?sslmode=require`

### Upstash

1. Criar uma conta em `https://upstash.com`.
2. Criar um Redis database.
3. Copiar a Redis URL TLS.
4. Preencher:
   - `CACHE_REDIS_URI=rediss://default:PASSWORD@HOST.upstash.io:PORT`

### Railway, Render ou Fly

1. Criar o projeto apontando para este repositorio ou para um deploy Docker.
2. Configurar a imagem `evoapicloud/evolution-api:latest` ou usar o `docker-compose.evolution.yml` como referencia.
3. Definir as variaveis de `evolution/railway.example.env`.
4. Configurar a porta publica como `8080`.
5. Copiar a URL publica do servico.
6. Preencher:
   - `SERVER_URL=https://sua-url-publica`

### Firebase Functions

1. Instalar Firebase CLI se necessario.
2. Fazer login:
   ```bash
   firebase login
   ```
3. Associar o projeto:
   ```bash
   firebase use compraki-mcu
   ```
4. Configurar variaveis/secrets no ambiente das Functions:
   - `EVOLUTION_API_URL`: URL publica da Evolution API.
   - `EVOLUTION_API_KEY`: mesma chave de `AUTHENTICATION_API_KEY`.
   - `EVOLUTION_WEBHOOK_SECRET`: segredo aleatorio para validar webhook.
   - `ALLOWED_ORIGIN`: origem do app, por exemplo `http://localhost:8100` ou dominio de producao.

## Variaveis principais

### Evolution API

Use `evolution/.env.example` localmente e `evolution/railway.example.env` no deploy.

Campos obrigatorios:

- `SERVER_URL`
- `AUTHENTICATION_API_KEY`
- `DATABASE_CONNECTION_URI`
- `CACHE_REDIS_URI`
- `WEBHOOK_GLOBAL_URL`

### Firebase Functions

Use `functions/.env.example` como referencia.

Campos obrigatorios:

- `EVOLUTION_API_URL`
- `EVOLUTION_API_KEY`
- `EVOLUTION_WEBHOOK_SECRET`
- `ALLOWED_ORIGIN`

## Fluxo esperado

1. O admin chama `createWhatsappInstance` pelo app.
2. A Function valida o token Firebase e permissao de admin.
3. A Function chama a Evolution API com `apikey` protegido no backend.
4. A Evolution API cria a instancia e gera QR Code.
5. O admin chama `getWhatsappQrCode` para ler o QR Code.
6. O WhatsApp conecta e a Evolution API dispara eventos para `evolutionWebhook`.
7. A Function salva eventos em `whatsappWebhookEvents` no Firestore.

## Permissao de admin

As Functions aceitam uma destas formas:

- Custom claim `admin: true` no Firebase Auth.
- Documento `users/{uid}` com `isAdmin: true`.
- Documento `users/{uid}` com `super_admin: true`.
- Documento `users/{uid}` com `role: "admin"`.

## Comandos uteis

Instalar dependencias das Functions:

```bash
npm --prefix functions install
```

Build das Functions:

```bash
npm --prefix functions run build
```

Subir Evolution API local:

```bash
copy evolution\.env.example evolution\.env
docker compose -f docker-compose.evolution.yml up -d
```

Deploy das Functions:

```bash
firebase deploy --only functions
```

## Observacoes importantes

- Nao commitar `.env` com credenciais reais.
- Firebase Functions nao hospeda a Evolution API. Ela apenas protege tokens, recebe webhooks e chama o servidor persistente.
- Para multi-instancia, use nomes previsiveis como `store_ID`, `seller_UID` ou `compraki_main`.
- A disponibilidade do QR Code depende da Evolution API estar rodando em um ambiente persistente.
