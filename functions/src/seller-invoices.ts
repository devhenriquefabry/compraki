import { getAuth } from 'firebase-admin/auth';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { logger } from 'firebase-functions';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import * as nodemailer from 'nodemailer';

import { region } from './shared/http';

/**
 * E-mail da nota fiscal mensal que a Vineon emite para a loja.
 *
 * O admin anexa a nota na aba Vendedores (grava `sellerInvoices/{id}`). Esta
 * função manda o arquivo por e-mail para a loja sempre que `emailRequestedAt`
 * muda — no primeiro envio, ao trocar o arquivo e no "Reenviar e-mail". A
 * própria escrita do status (`email`) não mexe em `emailRequestedAt`, então
 * não entra em laço.
 *
 * No emulador nada sai: a função confere que o arquivo existe no Storage e
 * marca o envio como `simulated`.
 */

interface InvoiceDoc {
  sellerId: string;
  period: string;
  file: { name: string; path: string; contentType: string; size: number };
  summary: { grossRevenue: number; platformFee: number; netAmount: number; orderCount: number; commissionRate: number };
  emailRequestedAt?: Timestamp;
}

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export const onSellerInvoiceWritten = onDocumentWritten(
  { document: 'sellerInvoices/{invoiceId}', region, maxInstances: 2, timeoutSeconds: 120, memory: '512MiB' },
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return;

    const invoice = after.data() as InvoiceDoc;
    const before = event.data?.before?.exists ? (event.data.before.data() as InvoiceDoc) : null;
    const requested = invoice.emailRequestedAt;
    if (!requested) return;
    if (before?.emailRequestedAt && before.emailRequestedAt.isEqual(requested)) return;

    const setStatus = (email: Record<string, unknown>) =>
      after.ref.update({ email: { at: FieldValue.serverTimestamp(), error: null, ...email } });

    try {
      const to = await sellerEmail(invoice.sellerId);
      if (!to) {
        await setStatus({ status: 'no_email', to: null });
        return;
      }

      const [content] = await getStorage().bucket().file(invoice.file.path).download();
      const period = periodLabel(invoice.period);

      if (process.env.FUNCTIONS_EMULATOR === 'true') {
        logger.info('[nota fiscal] emulador: e-mail simulado', { to, period, bytes: content.length });
        await setStatus({ status: 'simulated', to });
        return;
      }

      const user = process.env.SMTP_USER;
      const pass = process.env.SMTP_PASS;
      if (!user || !pass) throw new Error('SMTP não configurado');

      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: { user, pass },
      });

      const name = await sellerName(invoice.sellerId);
      await transporter.sendMail({
        from: `"Vineon" <${user}>`,
        to,
        subject: `Sua nota fiscal de ${period} — Vineon`,
        text: invoiceText(name, period, invoice),
        html: invoiceHtml(name, period, invoice),
        attachments: [{ filename: invoice.file.name, content, contentType: invoice.file.contentType }],
      });

      logger.info('[nota fiscal] enviada', { invoice: after.id, to });
      await setStatus({ status: 'sent', to });
    } catch (err) {
      const message = (err as Error).message || 'erro desconhecido';
      logger.error('[nota fiscal] falha no envio', { invoice: after.id, message });
      await setStatus({ status: 'failed', error: message.slice(0, 200) }).catch(() => undefined);
    }
  },
);

async function sellerEmail(uid: string): Promise<string | null> {
  const doc = await getFirestore().doc(`users/${uid}`).get();
  const fromDoc = doc.get('email');
  if (typeof fromDoc === 'string' && fromDoc.includes('@')) return fromDoc;
  const user = await getAuth().getUser(uid).catch(() => null);
  return user?.email ?? null;
}

async function sellerName(uid: string): Promise<string> {
  const doc = await getFirestore().doc(`users/${uid}`).get();
  return (doc.get('shopName') || doc.get('displayName') || '').toString().trim();
}

function periodLabel(period: string): string {
  const [year, month] = period.split('-').map(Number);
  return `${MONTHS[month - 1] ?? period} de ${year}`;
}

function brl(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function appUrl(): string {
  return (process.env.APP_PUBLIC_URL || 'https://www.vineonsite.com.br').replace(/\/$/, '');
}

function invoiceText(name: string, period: string, invoice: InvoiceDoc): string {
  const rate = Math.round((invoice.summary.commissionRate || 0) * 100);
  return [
    `Olá${name ? `, ${name}` : ''}!`,
    '',
    `A nota fiscal da Vineon referente a ${period} está anexada a este e-mail.`,
    '',
    `Vendido no mês: ${brl(invoice.summary.grossRevenue)}`,
    `Taxa Vineon (${rate}%): ${brl(invoice.summary.platformFee)}`,
    `Seu repasse: ${brl(invoice.summary.netAmount)}`,
    '',
    `Ela também fica no app, em Minha conta > Notas fiscais: ${appUrl()}/my-invoices`,
  ].join('\n');
}

export function invoiceHtml(name: string, period: string, invoice: InvoiceDoc): string {
  const rate = Math.round((invoice.summary.commissionRate || 0) * 100);
  const hello = name ? `Olá, ${escapeHtml(name)}!` : 'Olá!';
  const row = (label: string, value: string, strong = false) => `
    <tr>
      <td style="padding:8px 0;color:${strong ? '#0B1623' : '#475569'};font-size:14px;${strong ? 'font-weight:800;border-top:1px solid #E3E8EF;padding-top:12px;' : ''}">${label}</td>
      <td style="padding:8px 0;text-align:right;color:#0B1623;font-size:14px;${strong ? 'font-weight:800;border-top:1px solid #E3E8EF;padding-top:12px;' : ''}">${value}</td>
    </tr>`;

  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#EDF0F3;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EDF0F3;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:18px;overflow:hidden;">
        <tr><td style="background:#0B1623;padding:22px 28px;">
          <div style="width:44px;height:3px;background:#D8F51F;border-radius:3px;margin-bottom:14px;"></div>
          <div style="color:#D8F51F;font-size:22px;font-weight:800;letter-spacing:-0.5px;">Vineon</div>
          <div style="color:#CBD5E1;font-size:13px;margin-top:4px;">Nota fiscal de ${escapeHtml(period)}</div>
        </td></tr>
        <tr><td style="padding:26px 28px 8px;">
          <p style="margin:0 0 10px;color:#0B1623;font-size:16px;font-weight:700;">${hello}</p>
          <p style="margin:0;color:#475569;font-size:14px;line-height:1.6;">
            A nota fiscal que a Vineon emitiu para a sua loja, referente a <b style="color:#0B1623;">${escapeHtml(period)}</b>, está anexada a este e-mail.
          </p>
        </td></tr>
        <tr><td style="padding:14px 28px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F8FA;border-radius:12px;padding:8px 16px;">
            ${row('Vendido no mês', brl(invoice.summary.grossRevenue))}
            ${row(`Taxa Vineon (${rate}%)`, brl(invoice.summary.platformFee))}
            ${row('Seu repasse', brl(invoice.summary.netAmount), true)}
          </table>
        </td></tr>
        <tr><td style="padding:10px 28px 28px;">
          <a href="${appUrl()}/my-invoices" style="display:inline-block;background:#D8F51F;color:#0B1623;text-decoration:none;font-weight:800;font-size:14px;padding:13px 22px;border-radius:12px;">Ver minhas notas no app</a>
          <p style="margin:18px 0 0;color:#94A3B8;font-size:12px;line-height:1.5;">
            A nota também fica guardada no app, em Minha conta › Notas fiscais. Dúvidas? Responda este e-mail.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
