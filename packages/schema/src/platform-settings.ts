/**
 * Platform setup: settings for the whole server (every workspace), changed by platform owners
 * on the Platform setup screen. A value set in the server's environment wins and is shown locked.
 */
import { z } from 'zod';

export const SIGNUP_MODES = ['open', 'invite_only'] as const;
export type SignupMode = (typeof SIGNUP_MODES)[number];

export const PlatformEmailProviderSchema = z.enum(['none', 'resend', 'smtp']);
export type PlatformEmailProvider = z.infer<typeof PlatformEmailProviderSchema>;

export const PlatformSmtpSchema = z.object({
  host: z.string().trim().min(1, 'Server address is required').max(255),
  port: z.number().int().min(1).max(65535),
  security: z.enum(['tls', 'starttls', 'none']),
  username: z.string().trim().max(255).optional().default(''),
  /** Write-only: left out keeps the stored password */
  password: z.string().max(1024).optional(),
});

export const PlatformSettingsInputSchema = z
  .object({
    email: z
      .object({
        provider: PlatformEmailProviderSchema,
        /** Write-only: left out keeps the stored key */
        resendApiKey: z.string().trim().max(512).optional(),
        smtp: PlatformSmtpSchema.optional(),
        fromAddress: z.string().trim().email('Sender address must be an email address').optional().or(z.literal('')),
        fromName: z.string().trim().max(120).optional().default(''),
      })
      .superRefine((e, ctx) => {
        if (e.provider === 'smtp' && !e.smtp) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['smtp'], message: 'Fill in the mail server details' });
        if (e.provider !== 'none' && !e.fromAddress) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fromAddress'], message: 'Enter the address emails are sent from' });
      })
      .optional(),
    signupMode: z.enum(SIGNUP_MODES).optional(),
    publicUrl: z
      .string()
      .trim()
      .max(255)
      .refine((v) => v === '' || /^https?:\/\/[^\s/]+(\/[^\s]*)?$/.test(v), 'Website address must start with http:// or https://')
      .optional(),
  });
export type PlatformSettingsInput = z.infer<typeof PlatformSettingsInputSchema>;

/** A setting's value and where it comes from: the screen ('saved'), the environment, or the default */
export interface PlatformSettingSource<T> {
  value: T;
  source: 'saved' | 'env' | 'default';
}

/** What the Platform setup screen sees: secrets only as "is one stored" */
export interface PlatformSettingsView {
  email: {
    source: 'saved' | 'env' | 'default';
    provider: PlatformEmailProvider;
    hasResendApiKey: boolean;
    smtp?: { host: string; port: number; security: 'tls' | 'starttls' | 'none'; username: string; hasPassword: boolean };
    fromAddress: string;
    fromName: string;
  };
  signupMode: PlatformSettingSource<SignupMode>;
  publicUrl: PlatformSettingSource<string>;
  /** Where the key that encrypts stored passwords comes from */
  encryptionKey: 'env' | 'file';
  platformAdmins: Array<{ id: string; email: string }>;
}
