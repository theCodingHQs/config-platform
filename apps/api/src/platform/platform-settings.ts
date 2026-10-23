/**
 * Server-wide settings from the Platform setup screen: the email service every workspace uses
 * by default, who may sign up, and the website address used in emailed links.
 *
 * Precedence for each setting: environment variable (hosted servers, shown locked on screen)
 * → value saved on the screen → default. Values are kept in memory so the many synchronous
 * callers (link building, sign-up checks) stay synchronous; the cache is loaded at start-up,
 * after every save, and every minute so several servers pick up each other's changes.
 */
import nodemailer from 'nodemailer';
import {
  PlatformSettingsInputSchema,
  type PlatformEmailProvider,
  type PlatformSettingsInput,
  type PlatformSettingsView,
  type SignupMode,
} from '@config-platform/schema';
import { pool } from '../db/pool.js';
import { decryptSecret, encryptSecret, encryptionKeySource } from '../utils/secret-box.js';

interface StoredPlatformSettings {
  email?: {
    provider: PlatformEmailProvider;
    resendApiKeyEncrypted?: string;
    smtp?: { host: string; port: number; security: 'tls' | 'starttls' | 'none'; username: string; passwordEncrypted?: string };
    fromAddress?: string;
    fromName?: string;
  };
  signupMode?: SignupMode;
  publicUrl?: string;
}

export interface PlatformMail {
  to: string[];
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
}

const DEFAULT_FROM = 'noreply@configplatform.com';

function formatFrom(name: string, address: string): string {
  const clean = name.replace(/["\\\r\n]/g, '').trim();
  return clean ? `"${clean}" <${address}>` : address;
}

/** The readable part of an email service's error reply ({"message": …}), else the reply itself */
export function resendErrorMessage(status: number, body: string): string {
  try {
    const message = JSON.parse(body)?.message;
    if (typeof message === 'string' && message.trim()) return message.trim();
  } catch {
    /* not JSON */
  }
  return body.trim() || `error ${status}`;
}

class PlatformSettingsService {
  private stored: StoredPlatformSettings = {};
  private storageKey = 'settings';

  /** Tests only: keep this process's settings in their own row, apart from the real ones. */
  useStorageKeyForTests(key: string): void {
    this.storageKey = key;
    this.stored = {};
  }
  private refreshTimer: NodeJS.Timeout | null = null;

  /** Reads the saved settings into memory (safe before the table exists: then nothing is saved). */
  async load(): Promise<void> {
    try {
      const res = await pool.query<{ value: StoredPlatformSettings }>('SELECT value FROM public.platform_setting WHERE key = $1', [this.storageKey]);
      this.stored = res.rows[0]?.value || {};
    } catch (err: any) {
      if (err?.code !== '42P01') throw err; // undefined_table: catalog not migrated yet
      this.stored = {};
    }
  }

  startAutoRefresh(intervalMs = 60_000): void {
    if (this.refreshTimer) return;
    this.refreshTimer = setInterval(() => void this.load().catch(() => undefined), intervalMs);
    this.refreshTimer.unref();
  }

  // ─── Effective values ─────────────────────────────────────────────────────

  private envEmail(): boolean {
    return Boolean(process.env.RESEND_API_KEY || process.env.SMTP_URL);
  }

  /** Whether any email service is set up for the platform (environment or Platform setup). */
  emailConfigured(): boolean {
    return this.envEmail() || (this.stored.email?.provider ?? 'none') !== 'none';
  }

  fromAddress(): string | null {
    if (this.envEmail()) return process.env.EMAIL_FROM || null;
    return this.stored.email?.provider && this.stored.email.provider !== 'none' ? this.stored.email.fromAddress || null : null;
  }

  signupMode(): SignupMode {
    const env = process.env.SIGNUP_MODE;
    if (env === 'open' || env === 'invite_only') return env;
    if (this.stored.signupMode) return this.stored.signupMode;
    return process.env.NODE_ENV === 'production' ? 'invite_only' : 'open';
  }

  publicUrl(): string {
    return (process.env.PUBLIC_URL || process.env.APP_URL || this.stored.publicUrl || 'http://localhost:3000').replace(/\/$/, '');
  }

  // ─── Sending ──────────────────────────────────────────────────────────────

  /**
   * Sends through the platform's email service. `senderName` labels the From address
   * (e.g. the workspace name). Returns null when no email service is set up.
   */
  async send(mail: PlatformMail, senderName?: string): Promise<{ from: string; via: 'platform-resend' | 'platform-smtp' } | null> {
    const attachments = (mail.attachments || []).map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType }));

    if (this.envEmail()) {
      const from = formatFrom(senderName || '', process.env.EMAIL_FROM || DEFAULT_FROM);
      if (process.env.RESEND_API_KEY) {
        await this.sendResend(process.env.RESEND_API_KEY, from, mail);
        return { from, via: 'platform-resend' };
      }
      await nodemailer.createTransport(process.env.SMTP_URL!).sendMail({ from, to: mail.to, replyTo: mail.replyTo, subject: mail.subject, text: mail.text, html: mail.html, attachments });
      return { from, via: 'platform-smtp' };
    }

    const email = this.stored.email;
    if (!email || email.provider === 'none') return null;
    const from = formatFrom(senderName || email.fromName || '', email.fromAddress || DEFAULT_FROM);
    if (email.provider === 'resend') {
      if (!email.resendApiKeyEncrypted) throw new Error('The email service key is missing. A platform owner needs to enter it under Platform setup.');
      await this.sendResend(decryptSecret(email.resendApiKeyEncrypted), from, mail);
      return { from, via: 'platform-resend' };
    }
    const s = email.smtp!;
    await nodemailer
      .createTransport({
        host: s.host,
        port: s.port,
        secure: s.security === 'tls',
        requireTLS: s.security === 'starttls',
        ignoreTLS: s.security === 'none',
        auth: s.username ? { user: s.username, pass: s.passwordEncrypted ? decryptSecret(s.passwordEncrypted) : '' } : undefined,
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 60000,
      })
      .sendMail({ from, to: mail.to, replyTo: mail.replyTo, subject: mail.subject, text: mail.text, html: mail.html, attachments });
    return { from, via: 'platform-smtp' };
  }

  private async sendResend(apiKey: string, from: string, mail: PlatformMail) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: mail.to,
        reply_to: mail.replyTo,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        attachments: (mail.attachments || []).map((a) => ({ filename: a.filename, content: a.content.toString('base64') })),
      }),
    });
    if (!res.ok) throw new Error(`The email service refused the message: ${resendErrorMessage(res.status, await res.text())}`);
  }

  // ─── Platform setup screen ────────────────────────────────────────────────

  async view(): Promise<PlatformSettingsView> {
    await this.load();
    const s = this.stored;
    const admins = await pool.query<{ id: string; email: string }>(
      'SELECT id, email FROM public.app_user WHERE is_platform_admin ORDER BY created_at, id'
    );
    const email: PlatformSettingsView['email'] = this.envEmail()
      ? {
          source: 'env',
          provider: process.env.RESEND_API_KEY ? 'resend' : 'smtp',
          hasResendApiKey: Boolean(process.env.RESEND_API_KEY),
          fromAddress: process.env.EMAIL_FROM || '',
          fromName: '',
        }
      : {
          source: s.email ? 'saved' : 'default',
          provider: s.email?.provider ?? 'none',
          hasResendApiKey: Boolean(s.email?.resendApiKeyEncrypted),
          ...(s.email?.smtp
            ? { smtp: { host: s.email.smtp.host, port: s.email.smtp.port, security: s.email.smtp.security, username: s.email.smtp.username, hasPassword: Boolean(s.email.smtp.passwordEncrypted) } }
            : {}),
          fromAddress: s.email?.fromAddress || '',
          fromName: s.email?.fromName || '',
        };
    const envSignup = process.env.SIGNUP_MODE === 'open' || process.env.SIGNUP_MODE === 'invite_only';
    const envUrl = Boolean(process.env.PUBLIC_URL || process.env.APP_URL);
    return {
      email,
      signupMode: { value: this.signupMode(), source: envSignup ? 'env' : s.signupMode ? 'saved' : 'default' },
      publicUrl: { value: this.publicUrl(), source: envUrl ? 'env' : s.publicUrl ? 'saved' : 'default' },
      encryptionKey: encryptionKeySource(),
      platformAdmins: admins.rows,
    };
  }

  /** Saves what the screen sent; secrets left out keep their stored value. */
  async save(input: PlatformSettingsInput, userId: string): Promise<PlatformSettingsView> {
    const parsed = PlatformSettingsInputSchema.parse(input);
    await this.load();
    const next: StoredPlatformSettings = { ...this.stored };

    if (parsed.email) {
      const current = this.stored.email;
      const e = parsed.email;
      const resendApiKeyEncrypted = e.resendApiKey ? encryptSecret(e.resendApiKey) : current?.resendApiKeyEncrypted;
      if (e.provider === 'resend' && !resendApiKeyEncrypted) throw new PlatformSettingsError('Enter the Resend API key');
      let smtp: NonNullable<StoredPlatformSettings['email']>['smtp'] = current?.smtp;
      if (e.smtp) {
        const { password, ...rest } = e.smtp;
        const passwordEncrypted = password ? encryptSecret(password) : current?.smtp?.passwordEncrypted;
        smtp = { ...rest, username: rest.username ?? '', ...(passwordEncrypted ? { passwordEncrypted } : {}) };
      }
      next.email = {
        provider: e.provider,
        ...(resendApiKeyEncrypted ? { resendApiKeyEncrypted } : {}),
        ...(smtp ? { smtp } : {}),
        fromAddress: e.fromAddress || '',
        fromName: e.fromName || '',
      };
    }
    if (parsed.signupMode) next.signupMode = parsed.signupMode;
    if (parsed.publicUrl !== undefined) {
      if (parsed.publicUrl) next.publicUrl = parsed.publicUrl.replace(/\/$/, '');
      else delete next.publicUrl;
    }

    await pool.query(
      `INSERT INTO public.platform_setting (key, value, updated_by, updated_at) VALUES ($1, $2, $3, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [this.storageKey, JSON.stringify(next), userId]
    );
    this.stored = next;
    return this.view();
  }

  async isPlatformAdmin(userId: string): Promise<boolean> {
    const res = await pool.query<{ is_platform_admin: boolean }>('SELECT is_platform_admin FROM public.app_user WHERE id = $1', [userId]);
    return Boolean(res.rows[0]?.is_platform_admin);
  }

  async addAdmin(email: string): Promise<void> {
    const res = await pool.query('UPDATE public.app_user SET is_platform_admin = TRUE WHERE email = $1', [email.trim().toLowerCase()]);
    if (!res.rowCount) throw new PlatformSettingsError(`No account uses ${email}. They need to sign up or be invited to a workspace first.`, 404);
  }

  async removeAdmin(userId: string): Promise<void> {
    const res = await pool.query(
      `UPDATE public.app_user SET is_platform_admin = FALSE
       WHERE id = $1 AND (SELECT COUNT(*) FROM public.app_user WHERE is_platform_admin) > 1`,
      [userId]
    );
    if (!res.rowCount) throw new PlatformSettingsError('The server needs at least one platform owner.', 409);
  }
}

export class PlatformSettingsError extends Error {
  constructor(message: string, public statusCode = 422) {
    super(message);
  }
}

export const platformSettings = new PlatformSettingsService();
