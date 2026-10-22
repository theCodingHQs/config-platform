/**
 * Sends a workspace's emails (scheduled reports, test messages) by one of three routes:
 *  1. the workspace's own mail server (Settings → Email), when it chose one
 *  2. the platform's email service (RESEND_API_KEY or SMTP_URL, sender EMAIL_FROM)
 *  3. nowhere: outside production with no service set up, messages are logged and kept in
 *     `devOutbox` so the feature can be tried and tested without sending real email
 */
import nodemailer from 'nodemailer';
import {
  EmailDeliverySettingsInputSchema,
  type EmailDeliverySettings,
  type EmailDeliverySettingsInput,
  type SmtpSettings,
} from '@config-platform/schema';
import { pool } from '../db/pool.js';
import { decryptSecret, encryptSecret } from '../utils/secret-box.js';

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface WorkspaceMail {
  to: string[];
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
  attachments?: MailAttachment[];
}

export interface SentMail extends WorkspaceMail {
  tenantId: string;
  from: string;
  via: 'workspace-smtp' | 'platform-resend' | 'platform-smtp' | 'log';
}

/** Messages "sent" while no email service is configured (development and tests only). */
export const devOutbox: SentMail[] = [];

export class EmailNotConfiguredError extends Error {
  constructor() {
    super('Email is not set up on this server yet. Ask the platform operator to configure an email service, or set up your own mail server under Settings → Email.');
  }
}

type StoredSmtp = Omit<SmtpSettings, 'password'> & { passwordEncrypted?: string };
interface StoredEmailSettings {
  mode?: 'platform' | 'smtp';
  smtp?: StoredSmtp;
}

function platformConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY || process.env.SMTP_URL);
}

function platformFromAddress(): string | null {
  return process.env.EMAIL_FROM || null;
}

/** "Acme Factory" <reports@platform.com>, escaping quotes in the name */
function formatFrom(name: string, address: string): string {
  const clean = name.replace(/["\\\r\n]/g, '').trim();
  return clean ? `"${clean}" <${address}>` : address;
}

class WorkspaceMailer {
  private async loadStored(tenantId: string): Promise<{ settings: StoredEmailSettings; tenantName: string }> {
    const res = await pool.query<{ email_settings: StoredEmailSettings | null; name: string }>(
      'SELECT email_settings, name FROM public.tenant WHERE id = $1',
      [tenantId]
    );
    return { settings: res.rows[0]?.email_settings || {}, tenantName: res.rows[0]?.name || 'Workspace' };
  }

  async getSettings(tenantId: string): Promise<EmailDeliverySettings> {
    const { settings } = await this.loadStored(tenantId);
    const base = { platformConfigured: platformConfigured(), platformFromAddress: platformFromAddress() };
    if (settings.mode === 'smtp' && settings.smtp) {
      const { passwordEncrypted, ...smtp } = settings.smtp;
      return { mode: 'smtp', smtp: { ...smtp, hasPassword: Boolean(passwordEncrypted) }, ...base };
    }
    return { mode: 'platform', ...base };
  }

  /** Saves the settings; a mail server password left out keeps the stored one. */
  async saveSettings(tenantId: string, input: EmailDeliverySettingsInput): Promise<EmailDeliverySettings> {
    const parsed = EmailDeliverySettingsInputSchema.parse(input);
    const { settings: current } = await this.loadStored(tenantId);
    let next: StoredEmailSettings;
    if (parsed.mode === 'smtp') {
      const { password, ...smtp } = parsed.smtp;
      const passwordEncrypted =
        password !== undefined && password !== ''
          ? encryptSecret(password)
          : current.smtp?.passwordEncrypted;
      next = { mode: 'smtp', smtp: { ...smtp, ...(passwordEncrypted ? { passwordEncrypted } : {}) } };
    } else {
      // Keeps the mail server details so switching back doesn't mean typing them again
      next = { mode: 'platform', ...(current.smtp ? { smtp: current.smtp } : {}) };
    }
    await pool.query('UPDATE public.tenant SET email_settings = $1 WHERE id = $2', [JSON.stringify(next), tenantId]);
    return this.getSettings(tenantId);
  }

  async send(tenantId: string, mail: WorkspaceMail, opts: { senderName?: string } = {}): Promise<SentMail> {
    const { settings, tenantName } = await this.loadStored(tenantId);
    const senderName = opts.senderName ?? tenantName;
    const attachments = (mail.attachments || []).map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType }));

    if (settings.mode === 'smtp' && settings.smtp) {
      const s = settings.smtp;
      const transport = nodemailer.createTransport({
        host: s.host,
        port: s.port,
        secure: s.security === 'tls',
        requireTLS: s.security === 'starttls',
        ignoreTLS: s.security === 'none',
        auth: s.username ? { user: s.username, pass: s.passwordEncrypted ? decryptSecret(s.passwordEncrypted) : '' } : undefined,
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 60000,
      });
      const from = formatFrom(s.fromName || senderName, s.fromAddress);
      await transport.sendMail({ from, to: mail.to, replyTo: mail.replyTo, subject: mail.subject, text: mail.text, html: mail.html, attachments });
      return { ...mail, tenantId, from, via: 'workspace-smtp' };
    }

    const platformFrom = platformFromAddress() || 'noreply@configplatform.com';
    const from = formatFrom(senderName, platformFrom);

    if (process.env.RESEND_API_KEY) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from,
          to: mail.to,
          reply_to: mail.replyTo,
          subject: mail.subject,
          text: mail.text,
          html: mail.html,
          attachments: attachments.map((a) => ({ filename: a.filename, content: a.content.toString('base64') })),
        }),
      });
      if (!res.ok) throw new Error(`The email service refused the message (${res.status}): ${await res.text()}`);
      return { ...mail, tenantId, from, via: 'platform-resend' };
    }

    if (process.env.SMTP_URL) {
      const transport = nodemailer.createTransport(process.env.SMTP_URL);
      await transport.sendMail({ from, to: mail.to, replyTo: mail.replyTo, subject: mail.subject, text: mail.text, html: mail.html, attachments });
      return { ...mail, tenantId, from, via: 'platform-smtp' };
    }

    if (process.env.NODE_ENV === 'production') throw new EmailNotConfiguredError();

    const sent: SentMail = { ...mail, tenantId, from, via: 'log' };
    devOutbox.push(sent);
    if (devOutbox.length > 50) devOutbox.shift();
    if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
      console.log(
        `[EMAIL not sent: no email service configured] to=${mail.to.join(', ')} subject="${mail.subject}" attachments=${(mail.attachments || []).map((a) => `${a.filename} (${a.content.length} bytes)`).join(', ') || 'none'}`
      );
    }
    return sent;
  }
}

export const workspaceMailer = new WorkspaceMailer();
