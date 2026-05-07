# 🛒 Compraki

> Plataforma de marketplace e afiliados com automação de WhatsApp, bot de scraping e integração Firebase.

---

## 📋 Visão Geral

O Compraki é uma aplicação mobile-first construída com **Ionic + Angular**, integrada ao **Firebase** (Auth, Firestore, Storage, Cloud Functions) e à **Evolution API** para envio de mensagens via WhatsApp. Conta também com um sistema de bot de automação para captura de produtos afiliados do Mercado Livre.

### Principais funcionalidades

- 🛍️ Marketplace com anúncios de produtos
- 🤖 Bot de automação de afiliados (Mercado Livre)
- 📱 Integração WhatsApp via Evolution API
- 🔐 Autenticação com Firebase (e-mail/senha + Google)
- 🔑 Recuperação de senha por e-mail e WhatsApp
- 📦 Integração com Melhor Envio para cálculo de frete
- 💬 Chat em tempo real entre comprador e vendedor
- 🧠 IA generativa (Groq/LLaMA) para mensagens automáticas

---

## 🗂️ Estrutura do Projeto

```
compraki/
├── src/                  # Código Angular/Ionic (frontend)
│   ├── app/
│   │   ├── pages/        # Páginas da aplicação
│   │   ├── services/     # Serviços (Firebase, WhatsApp, etc.)
│   │   └── components/   # Componentes reutilizáveis
│   └── environments/     # Configuração Firebase por ambiente
├── functions/            # Firebase Cloud Functions (backend Node.js)
│   ├── src/index.ts      # Todas as Cloud Functions
│   └── .env.example      # Modelo de variáveis de ambiente
├── automation/           # Scripts de automação Puppeteer
│   └── scripts/          # Bots individuais (Mercado Livre, etc.)
├── bot-server.js         # Servidor Express local para gerenciar bots
├── webhook-server.js     # Servidor local para receber webhooks
├── firestore.rules       # Regras de segurança do Firestore
├── storage.rules         # Regras de segurança do Storage
└── .env.example          # Modelo de variáveis de ambiente (raiz)
```

---

## ⚙️ Pré-requisitos

Certifique-se de ter instalado:

| Ferramenta | Versão mínima | Link |
|---|---|---|
| Node.js | 20.x | https://nodejs.org |
| npm | 9.x | (incluso com Node) |
| Firebase CLI | 13.x | `npm install -g firebase-tools` |
| Ionic CLI | 7.x | `npm install -g @ionic/cli` |
| Git | qualquer | https://git-scm.com |

---

## 🚀 Passo a Passo — Como Rodar o Projeto

### 1. Clone o repositório

```bash
git clone https://github.com/devhenriquefabry/compraki.git
cd compraki
```

### 2. Instale as dependências do frontend

```bash
npm install
```

### 3. Instale as dependências das Cloud Functions

```bash
cd functions
npm install
cd ..
```

### 4. Configure as variáveis de ambiente

**Na raiz do projeto** (para o bot-server):
```bash
cp .env.example .env
```

**Na pasta `functions/`** (para as Cloud Functions):
```bash
cp functions/.env.example functions/.env
```

Abra os dois arquivos `.env` criados e preencha com seus valores reais. Veja a seção [Variáveis de Ambiente](#-variáveis-de-ambiente) abaixo.

### 5. Configure o Firebase

Faça login na sua conta Firebase:
```bash
firebase login
```

Selecione o projeto:
```bash
firebase use <seu-project-id>
```

> **Nota:** O arquivo `src/environments/environment.ts` já contém as configurações do projeto Firebase. Se estiver usando seu próprio projeto, atualize o `apiKey`, `projectId` etc. com os valores do seu console Firebase.

### 6. Rode o frontend (Ionic)

```bash
ionic serve
```

A aplicação ficará disponível em `http://localhost:8100`.

### 7. (Opcional) Rode o servidor de bots localmente

O bot-server gerencia a fila de automações Puppeteer:
```bash
node bot-server.js
```

Ficará disponível em `http://localhost:3001`.

### 8. (Opcional) Deploy das Cloud Functions

```bash
firebase deploy --only functions
```

---

## 🔑 Variáveis de Ambiente

### `functions/.env` — Cloud Functions (backend)

| Variável | Descrição | Onde Obter |
|---|---|---|
| `EVOLUTION_API_URL` | URL da sua instância da Evolution API | Painel Railway / VPS |
| `EVOLUTION_API_KEY` | Chave global de auth da Evolution API | Configurações da Evolution API |
| `EVOLUTION_WEBHOOK_SECRET` | Segredo para validar webhooks (opcional) | Defina você mesmo |
| `SMTP_HOST` | Host SMTP para envio de e-mail | Ex: `smtp.gmail.com` |
| `SMTP_PORT` | Porta SMTP | `587` (TLS) ou `465` (SSL) |
| `SMTP_SECURE` | `true` para SSL, `false` para TLS | — |
| `SMTP_USER` | E-mail remetente | Sua conta Gmail |
| `SMTP_PASS` | Senha de app do Gmail | [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) |
| `ADMIN_EMAILS` | E-mails admin separados por vírgula | Defina você mesmo |

### `.env` — Bot Server (raiz)

| Variável | Descrição | Onde Obter |
|---|---|---|
| `GROQ_API_KEY` | Chave da API Groq para IA generativa | [console.groq.com/keys](https://console.groq.com/keys) |
| `XAI_API_KEY` | Alternativa: chave da API xAI (Grok) | [x.ai/api](https://x.ai/api) |

---

## 🏗️ Stack Tecnológica

| Camada | Tecnologia |
|---|---|
| Frontend | Ionic 7 + Angular 17 |
| Backend | Firebase Cloud Functions (Node.js 20) |
| Banco de dados | Cloud Firestore |
| Autenticação | Firebase Auth |
| Armazenamento | Firebase Storage |
| WhatsApp | Evolution API |
| Automação | Puppeteer |
| IA Generativa | Groq (LLaMA 3.3 70B) |
| E-mail | Nodemailer + Gmail SMTP |
| Frete | Melhor Envio API |

---

## 📱 Evolution API — WhatsApp

Este projeto utiliza a [Evolution API](https://github.com/EvolutionAPI/evolution-api) para envio de mensagens via WhatsApp. Você pode hospedar sua própria instância no Railway, VPS, ou usar um serviço gerenciado.

Após subir a Evolution API:
1. Acesse o painel e crie uma instância
2. Conecte o WhatsApp escaneando o QR Code
3. Copie a URL e a API Key para o `functions/.env`

---

## 🔒 Segurança

- **Nunca** commite arquivos `.env` com credenciais reais
- As `apiKey` do Firebase expostas no frontend são **seguras por design** — o Firebase as usa apenas para identificar o projeto; o acesso é controlado pelas **Firestore Security Rules**
- Revise os arquivos `firestore.rules` e `storage.rules` antes de ir para produção

---

## 📄 Licença

Este projeto é de uso educacional/acadêmico. Todos os direitos reservados ao autor.

---

*Desenvolvido por **Henrique Fabry** — [github.com/devhenriquefabry](https://github.com/devhenriquefabry)*
