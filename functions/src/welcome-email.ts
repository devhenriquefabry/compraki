import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';

import { appUrl, escapeHtml, mailParagraph, mailShell, sendMail } from './shared/mail';
import { region } from './shared/http';

/**
 * E-mail de boas-vindas: sai quando nasce `users/{uid}` — cadastro por e-mail e
 * senha ou primeiro login com o Google (os dois passam por
 * `ensureAppUserDocument` no app).
 *
 * - Só para conta nova de verdade: o Auth precisa ter sido criado há menos de
 *   24 h. Conta antiga que só agora ganhou documento (espelho que falhou, seed,
 *   import) não recebe "sua conta foi criada" semanas depois.
 * - Uma vez por conta: `welcomeEmails/{uid}` é criado ANTES do envio com
 *   `create()`, que falha se já existir — o Firestore pode entregar o mesmo
 *   evento duas vezes. Só guarda status e datas, nenhum dado pessoal.
 * - Falha no SMTP não tenta de novo (ninguém quer duas boas-vindas): fica
 *   `status: 'failed'` com o motivo, para conferir.
 */

const MAX_ACCOUNT_AGE_MS = 24 * 60 * 60 * 1000;
const NAME_SETTLE_MS = 5000;
/** Nome que o app grava enquanto o cadastro ainda não mandou o de verdade. */
const PLACEHOLDER_NAME = 'Novo Usuário';

export interface WelcomeMailInput {
  name: string;
  email: string;
  createdAt: Date;
  /** Conta entrou pelo Google (sem senha na Vineon). */
  viaGoogle: boolean;
}

/** Nome para o "Olá": primeiro nome; sem nome, a parte antes do @. */
function firstName(name: string, email: string): string {
  const clean = String(name || '').trim();
  if (clean && clean !== PLACEHOLDER_NAME) return clean.split(/\s+/)[0];
  return email.split('@')[0];
}

function formatDate(date: Date): string {
  return date.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).replace(', ', ' às ');
}

/** Rótulo em cima, valor embaixo: cabe no celular mesmo com e-mail comprido. */
function accountField(label: string, value: string): string {
  return `<div style="padding:5px 0;">
    <div style="color:#64748B;font-size:12px;line-height:1.4;">${escapeHtml(label)}</div>
    <div style="color:#0B1623;font-size:14px;font-weight:700;line-height:1.4;word-break:break-word;overflow-wrap:anywhere;">${escapeHtml(value)}</div>
  </div>`;
}

/** Linha "título + explicação" com o marcador lima, para a lista do que dá para fazer. */
function featureRow(title: string, text: string): string {
  return `<tr>
    <td valign="top" style="width:22px;padding:2px 0 14px;"><div style="width:10px;height:10px;margin-top:5px;border-radius:3px;background:#D8F51F;border:1px solid #B9D40F;"></div></td>
    <td style="padding:0 0 14px;">
      <div style="color:#0B1623;font-size:14px;font-weight:700;line-height:1.4;">${title}</div>
      <div style="color:#475569;font-size:13.5px;line-height:1.5;margin-top:2px;">${text}</div>
    </td>
  </tr>`;
}

export function renderWelcomeMail(input: WelcomeMailInput): { subject: string; text: string; html: string } {
  const site = appUrl();
  const who = firstName(input.name, input.email);
  const when = formatDate(input.createdAt);
  const access = input.viaGoogle ? 'Entrar com o Google' : 'E-mail e a senha que você criou';

  const subject = `Boas-vindas à Vineon, ${who}! Sua conta foi criada`;

  const body =
    `<h1 style="margin:0 0 6px;color:#0B1623;font-size:24px;line-height:1.25;font-weight:800;letter-spacing:-0.4px;">Sua conta está pronta, ${escapeHtml(who)}!</h1>`
    + `<p style="margin:0 0 18px;color:#64748B;font-size:14px;line-height:1.5;">Que bom ter você por aqui.</p>`
    + mailParagraph('A Vineon é o marketplace que aproxima você das lojas e de quem vende perto da sua cidade. Sua conta já está ativa: pode comprar, conversar com os vendedores e anunciar o que quiser.')
    // Resumo da conta: a prova de que foi criada, e com qual acesso.
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 22px;background:#F6F8FA;border-radius:14px;border:1px solid #E2E8F0;">
        <tr><td style="padding:14px 18px 4px;color:#64748B;font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;">Dados da conta</td></tr>
        <tr><td style="padding:2px 18px 12px;">
          ${accountField('E-mail', input.email)}
          ${accountField('Criada em', when)}
          ${accountField('Como entrar', access)}
        </td></tr>
      </table>`
    + `<div style="margin:0 0 12px;color:#0B1623;font-size:15px;font-weight:800;">Por onde começar</div>`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        ${featureRow('Encontre ofertas perto de você', 'Produtos de lojas da sua região, com frete calculado para o seu endereço — ou entrega grátis da própria loja.')}
        ${featureRow('Compre com segurança', 'Pague por Pix e acompanhe cada pedido em <b style="color:#0B1623;">Minha conta › Seus pedidos</b>.')}
        ${featureRow('Fale direto com quem vende', 'Tire dúvidas nas perguntas do anúncio ou pelas mensagens, antes de comprar.')}
        ${featureRow('Venda também', 'Toda conta pode anunciar. Em poucos passos seu primeiro produto está no ar.')}
      </table>`;

  const html = mailShell({
    eyebrow: 'Conta criada · Boas-vindas',
    body,
    cta: { label: 'Começar a explorar', url: site },
    footer: `Não foi você que criou esta conta? Fale com a gente em <a href="${escapeHtml(`${site}/support`)}" style="color:#64748B;">${escapeHtml(site.replace(/^https?:\/\//, ''))}/support</a> que resolvemos.<br><br>`
      + `Você recebeu este e-mail porque uma conta foi criada na Vineon com ${escapeHtml(input.email)}. `
      + `<a href="${escapeHtml(`${site}/privacy`)}" style="color:#64748B;">Política de Privacidade</a> · <a href="${escapeHtml(`${site}/help`)}" style="color:#64748B;">Central de ajuda</a>`,
  });

  const text = [
    `Sua conta está pronta, ${who}!`,
    '',
    'Que bom ter você na Vineon, o marketplace que aproxima você das lojas e de quem vende perto da sua cidade.',
    '',
    'Dados da conta',
    `- E-mail: ${input.email}`,
    `- Criada em: ${when}`,
    `- Como entrar: ${access}`,
    '',
    'Por onde começar',
    '- Encontre ofertas perto de você',
    '- Compre com segurança (Pix) e acompanhe em Minha conta › Seus pedidos',
    '- Fale direto com quem vende',
    '- Venda também: toda conta pode anunciar',
    '',
    `Começar a explorar: ${site}`,
    '',
    `Não foi você que criou esta conta? Fale com a gente: ${site}/support`,
  ].join('\n');

  return { subject, text, html };
}

export const sendWelcomeEmail = onDocumentCreated(
  { document: 'users/{uid}', region, maxInstances: 3, timeoutSeconds: 60 },
  async (event) => {
    const uid = event.params.uid;
    // O documento nasce do `onAuthStateChanged` com o nome provisório "Novo Usuário";
    // o nome digitado no cadastro (e o `updateProfile` do Auth) chega logo depois.
    await new Promise(resolve => setTimeout(resolve, NAME_SETTLE_MS));

    const user = await getAuth().getUser(uid).catch(() => null);
    if (!user?.email) return;

    const createdAt = new Date(user.metadata.creationTime);
    if (!(Date.now() - createdAt.getTime() < MAX_ACCOUNT_AGE_MS)) {
      logger.info('[boas-vindas] conta antiga, sem e-mail', { uid });
      return;
    }

    const marker = getFirestore().collection('welcomeEmails').doc(uid);
    try {
      await marker.create({ status: 'sending', createdAt: FieldValue.serverTimestamp() });
    } catch {
      return; // Já enviado (ou enviando) por outra entrega do mesmo evento.
    }

    const providers = user.providerData.map(p => p.providerId);
    const fresh = await getFirestore().collection('users').doc(uid).get().catch(() => null);
    const name = [fresh?.get('displayName'), user.displayName, event.data?.get('displayName')]
      .map(value => String(value || '').trim())
      .find(value => value && value !== PLACEHOLDER_NAME) || '';
    const mail = renderWelcomeMail({
      name,
      email: user.email,
      createdAt,
      viaGoogle: providers.includes('google.com') && !providers.includes('password'),
    });

    try {
      const result = await sendMail({ to: user.email, ...mail });
      await marker.update({ status: result, sentAt: FieldValue.serverTimestamp() });
    } catch (error) {
      logger.error('[boas-vindas] e-mail não enviado', { uid, message: (error as Error).message });
      await marker.update({ status: 'failed', error: String((error as Error).message).slice(0, 300) });
    }
  }
);
