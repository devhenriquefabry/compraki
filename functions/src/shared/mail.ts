import { logger } from 'firebase-functions';
import * as nodemailer from 'nodemailer';

/**
 * E-mail transacional da Vineon (SMTP do `functions/.env`).
 *
 * - No emulador nada sai: `sendMail` só registra no log e devolve `simulated`.
 * - Sem SMTP configurado ele lança erro; quem chama decide se isso derruba a
 *   operação (nota fiscal) ou é só um aviso a mais (atendimento).
 * - `mailShell` é a casca visual (faixa azul-noite, fio lima, botão lima) usada
 *   pelos e-mails novos. Todo texto vindo de usuário passa por `escapeHtml`.
 */

export type MailResult = 'sent' | 'simulated';

export interface MailInput {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
}

export function escapeHtml(text: string): string {
  return String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/** Endereço público do site, sem barra no final. */
export function appUrl(): string {
  return (process.env.APP_PUBLIC_URL || 'https://www.vineonsite.com.br').replace(/\/$/, '');
}

export function isEmulator(): boolean {
  return process.env.FUNCTIONS_EMULATOR === 'true';
}

export async function sendMail(input: MailInput): Promise<MailResult> {
  if (isEmulator()) {
    logger.info('[e-mail] emulador: envio simulado', { to: input.to, subject: input.subject });
    return 'simulated';
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

  await transporter.sendMail({
    from: `"Vineon" <${user}>`,
    to: input.to,
    replyTo: input.replyTo,
    subject: input.subject,
    text: input.text,
    html: input.html,
  });
  return 'sent';
}

export interface MailShellOptions {
  /** Linha pequena abaixo da marca, ex.: "Atendimento VN-2026-000012". */
  eyebrow: string;
  /** Corpo já em HTML (monte com `mailParagraph`/`mailQuote` e `escapeHtml`). */
  body: string;
  cta?: { label: string; url: string };
  footer?: string;
}

export function mailParagraph(text: string): string {
  return `<p style="margin:0 0 12px;color:#475569;font-size:14px;line-height:1.6;">${text}</p>`;
}

/** Trecho citado (a mensagem do atendimento). `text` é escapado aqui. */
export function mailQuote(text: string): string {
  const safe = escapeHtml(text).replace(/\n/g, '<br>');
  return `<div style="margin:4px 0 14px;padding:12px 16px;background:#F6F8FA;border-left:3px solid #D8F51F;border-radius:0 10px 10px 0;color:#0B1623;font-size:14px;line-height:1.6;">${safe}</div>`;
}

export function mailShell(options: MailShellOptions): string {
  const cta = options.cta
    ? `<tr><td style="padding:6px 28px 8px;">
          <a href="${escapeHtml(options.cta.url)}" style="display:inline-block;background:#D8F51F;color:#0B1623;text-decoration:none;font-weight:800;font-size:14px;padding:13px 22px;border-radius:12px;">${escapeHtml(options.cta.label)}</a>
        </td></tr>`
    : '';
  const footer = options.footer
    ? `<tr><td style="padding:14px 28px 26px;"><p style="margin:0;color:#94A3B8;font-size:12px;line-height:1.5;">${options.footer}</p></td></tr>`
    : '<tr><td style="padding:0 0 18px;"></td></tr>';

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
          <div style="color:#CBD5E1;font-size:13px;margin-top:4px;">${escapeHtml(options.eyebrow)}</div>
        </td></tr>
        <tr><td style="padding:24px 28px 8px;">${options.body}</td></tr>
        ${cta}
        ${footer}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
