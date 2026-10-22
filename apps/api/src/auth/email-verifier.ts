/**
 * Production and Development Email Sender.
 * Sends through the platform's email service: RESEND_API_KEY / SMTP_URL in the environment,
 * or the one set up on the Platform setup screen.
 * Without any email service, links are logged (development) or not sent (production, with a warning).
 */

import { platformSettings } from '../platform/platform-settings.js';

export interface EmailSender {
  sendVerificationEmail(email: string, token: string): Promise<void>;
  sendInviteEmail(email: string, token: string, inviterEmail?: string, tenantName?: string): Promise<void>;
}

export type EmailVerifier = EmailSender;

export function getPublicUrl(): string {
  return platformSettings.publicUrl();
}

export function buildVerificationEmailHtml(verificationUrl: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Verify your email</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f8fafc; padding: 40px 20px; color: #1e293b;">
  <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; padding: 32px;">
    <h2 style="margin-top: 0; color: #0f172a; font-size: 20px;">Confirm your email address</h2>
    <p style="font-size: 15px; line-height: 1.6; color: #475569;">
      Thank you for signing up. Please click the button below to verify your email address and activate your account.
    </p>
    <div style="margin: 28px 0;">
      <a href="${verificationUrl}" style="background-color: #0f172a; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500; font-size: 14px; display: inline-block;">
        Verify Email
      </a>
    </div>
    <p style="font-size: 13px; color: #64748b; line-height: 1.5;">
      If the button above does not work, copy and paste this URL into your browser:<br/>
      <a href="${verificationUrl}" style="color: #2563eb; word-break: break-all;">${verificationUrl}</a>
    </p>
    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
    <p style="font-size: 12px; color: #94a3b8; margin-bottom: 0;">
      If you did not create an account, you can safely ignore this email.
    </p>
  </div>
</body>
</html>`;
}

export function buildInviteEmailHtml(inviteUrl: string, inviterEmail?: string, tenantName?: string): string {
  const workspaceTitle = tenantName || 'the workspace';
  const inviterText = inviterEmail ? `<strong>${inviterEmail}</strong> has invited you` : 'You have been invited';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Workspace Invitation</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f8fafc; padding: 40px 20px; color: #1e293b;">
  <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; padding: 32px;">
    <h2 style="margin-top: 0; color: #0f172a; font-size: 20px;">You've been invited!</h2>
    <p style="font-size: 15px; line-height: 1.6; color: #475569;">
      ${inviterText} to collaborate on <strong>${workspaceTitle}</strong>.
    </p>
    <div style="margin: 28px 0;">
      <a href="${inviteUrl}" style="background-color: #0f172a; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500; font-size: 14px; display: inline-block;">
        Accept Invitation
      </a>
    </div>
    <p style="font-size: 13px; color: #64748b; line-height: 1.5;">
      If the button above does not work, copy and paste this URL into your browser:<br/>
      <a href="${inviteUrl}" style="color: #2563eb; word-break: break-all;">${inviteUrl}</a>
    </p>
    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
    <p style="font-size: 12px; color: #94a3b8; margin-bottom: 0;">
      If you were not expecting this invitation, you can safely ignore this email.
    </p>
  </div>
</body>
</html>`;
}

export class ProductionEmailSender implements EmailSender {
  async sendMail(options: { to: string; subject: string; html: string; text: string }): Promise<void> {
    const sent = await platformSettings.send({ to: [options.to], subject: options.subject, html: options.html, text: options.text });
    if (!sent) throw new Error('No email service is set up. A platform owner can set one up under Platform setup.');
  }

  async sendVerificationEmail(email: string, token: string): Promise<void> {
    const publicUrl = getPublicUrl();
    const verificationUrl = `${publicUrl}/verify-email?token=${encodeURIComponent(token)}`;
    const subject = 'Verify your email address';
    const text = `Please verify your email address by visiting: ${verificationUrl}`;
    const html = buildVerificationEmailHtml(verificationUrl);
    await this.sendMail({ to: email, subject, html, text });
  }

  async sendInviteEmail(email: string, token: string, inviterEmail?: string, tenantName?: string): Promise<void> {
    const publicUrl = getPublicUrl();
    const inviteUrl = `${publicUrl}/accept-invite?token=${encodeURIComponent(token)}`;
    const subject = `You've been invited to join ${tenantName || 'the workspace'}`;
    const text = `${inviterEmail ? `${inviterEmail} has invited you` : 'You have been invited'} to collaborate on ${tenantName || 'the workspace'}. Accept invite: ${inviteUrl}`;
    const html = buildInviteEmailHtml(inviteUrl, inviterEmail, tenantName);
    await this.sendMail({ to: email, subject, html, text });
  }
}

export class ConsoleEmailVerifier implements EmailSender {
  public lastSentEmail: {
    email: string;
    token: string;
    link: string;
    type?: 'verification' | 'invite';
    subject?: string;
  } | null = null;

  async sendVerificationEmail(email: string, token: string): Promise<void> {
    const publicUrl = getPublicUrl();
    const link = `${publicUrl}/verify-email?token=${encodeURIComponent(token)}`;
    this.lastSentEmail = {
      email,
      token,
      link,
      type: 'verification',
      subject: 'Verify your email address',
    };
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[EMAIL VERIFICATION] Verification link for ${email}: ${link}`);
    }
  }

  async sendInviteEmail(email: string, token: string, inviterEmail?: string, tenantName?: string): Promise<void> {
    const publicUrl = getPublicUrl();
    const link = `${publicUrl}/accept-invite?token=${encodeURIComponent(token)}`;
    this.lastSentEmail = {
      email,
      token,
      link,
      type: 'invite',
      subject: `You've been invited to join ${tenantName || 'the workspace'}`,
    };
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[EMAIL INVITE] Invite link for ${email}: ${link}`);
    }
  }
}

export function validateEmailConfig(): void {
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) return;
  if (!platformSettings.emailConfigured()) {
    // Not fatal: a platform owner can set up email on the Platform setup screen after start-up
    console.warn('[email] No email service is set up: invites and confirmation emails are not sent. Set one up under Platform setup (or RESEND_API_KEY / SMTP_URL).');
    return;
  }
  if (!platformSettings.fromAddress()) {
    throw new Error('EMAIL_FROM environment variable is required in production when an email provider is configured.');
  }
}

export function createEmailSender(): EmailSender {
  if (platformSettings.emailConfigured()) {
    return new ProductionEmailSender();
  }
  return new ConsoleEmailVerifier();
}

export const consoleEmailVerifier = new ConsoleEmailVerifier();

export const defaultEmailVerifier: EmailSender & { lastSentEmail: any } = {
  async sendVerificationEmail(email: string, token: string) {
    if (platformSettings.emailConfigured()) {
      const sender = new ProductionEmailSender();
      return sender.sendVerificationEmail(email, token);
    }
    return consoleEmailVerifier.sendVerificationEmail(email, token);
  },
  async sendInviteEmail(email: string, token: string, inviterEmail?: string, tenantName?: string) {
    if (platformSettings.emailConfigured()) {
      const sender = new ProductionEmailSender();
      return sender.sendInviteEmail(email, token, inviterEmail, tenantName);
    }
    return consoleEmailVerifier.sendInviteEmail(email, token, inviterEmail, tenantName);
  },
  get lastSentEmail() {
    return consoleEmailVerifier.lastSentEmail;
  },
  set lastSentEmail(val) {
    consoleEmailVerifier.lastSentEmail = val;
  },
};

export const defaultEmailSender = defaultEmailVerifier;
