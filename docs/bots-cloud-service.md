# Serviço de Gestão de Bots na Nuvem

## Arquitetura operacional

- **Orquestração (API):** Firebase Functions (`createBotJob`, `listBotJobs`, `cancelBotJob`, `retryBotJob`, `getBotOpsSummary`).
- **Fila lógica:** coleção `botJobs` no Firestore com status `queued`, `running`, `success`, `failed`, `cancelled`.
- **Worker cloud:** cliente/worker autenticado por `x-bot-worker-token` consumindo:
  - `claimBotJob`
  - `appendBotJobLog`
  - `updateBotJobState`
- **Logs:** coleção `botJobLogs` por `jobId`.

## Contrato de execução (worker)

1. `POST /claimBotJob` com header `x-bot-worker-token`.
2. Se retornar `job`, iniciar execução do script.
3. Durante execução, publicar logs com `POST /appendBotJobLog`.
4. Ao finalizar, publicar resultado com `POST /updateBotJobState`.

## Governança e limites

- `BOT_MAX_QUEUE_PER_TYPE` limita jobs em `queued` por tipo de bot.
- `BOT_WORKER_TOKEN` obrigatório para endpoints operacionais de worker.
- Endpoints de gestão exigem usuário admin (`requireAdmin`).

## Observabilidade mínima

- Painel `Gestão de Bots` mostra KPIs de fila e status via `getBotOpsSummary`.
- Histórico e terminal de logs por job via `listBotJobLogs`.
- Auditoria de ações de admin registrada em `botJobLogs` (cancelamento, retry, enqueue).

## Variáveis de ambiente (Functions)

- `BOT_WORKER_TOKEN`: segredo para autenticação do worker cloud.
- `BOT_MAX_QUEUE_PER_TYPE` (opcional): limite de fila por bot (padrão 60).

## Rollout recomendado

1. Subir Functions.
2. Configurar `BOT_WORKER_TOKEN`.
3. Deploy de worker cloud.
4. Habilitar execução cloud para um tipo de bot por vez.
5. Monitorar taxa de falha e tempo médio de execução antes de ampliar.
