import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Info } from "lucide-react";
import { EmailDeliverySettingsInputSchema, type EmailDeliverySettingsInput, type SmtpSettings } from "@config-platform/schema";
import { fetchEmailSettings, sendTestEmail, updateEmailSettings } from "../api/client";
import { useStatusNotify } from "../context/app-bar-context";
import { TestEmailControl } from "../components/test-email-control";

const EMAIL_SETTINGS_KEY = ["email-settings"];

/** Common providers: picking one fills the server details */
const PROVIDERS: Array<{ id: string; label: string; host: string; port: number; security: SmtpSettings["security"]; note: string }> = [
  { id: "m365", label: "Microsoft 365 / Outlook", host: "smtp.office365.com", port: 587, security: "starttls", note: "Use a mailbox's address and password. Your IT admin may need to allow \"Authenticated SMTP\" for it." },
  { id: "google", label: "Google Workspace / Gmail", host: "smtp.gmail.com", port: 465, security: "tls", note: "Use the address and an App Password (Google Account → Security → App passwords), not the normal password." },
  { id: "other", label: "Other mail server", host: "", port: 587, security: "starttls", note: "Ask your IT team or email provider for these details." },
];

type SmtpDraft = Omit<SmtpSettings, "password"> & { password: string };

const EMPTY_SMTP: SmtpDraft = { host: "", port: 587, security: "starttls", username: "", password: "", fromAddress: "", fromName: "" };

/** Settings → Email: how this workspace sends report emails (admins and owners change it). */
export function EmailSettingsPanel({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient();
  const notify = useStatusNotify();
  const { data: saved, isLoading } = useQuery({ queryKey: EMAIL_SETTINGS_KEY, queryFn: fetchEmailSettings });
  const [mode, setMode] = useState<"platform" | "smtp">("platform");
  const [smtp, setSmtp] = useState<SmtpDraft>(EMPTY_SMTP);
  const [provider, setProvider] = useState("other");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!saved) return;
    setMode(saved.mode);
    if (saved.smtp) {
      const { hasPassword: _h, ...rest } = saved.smtp;
      setSmtp({ ...EMPTY_SMTP, ...rest, password: "" });
      setProvider(PROVIDERS.find((p) => p.host && p.host === saved.smtp!.host)?.id ?? "other");
    }
  }, [saved]);

  const save = useMutation({
    mutationFn: () => {
      const { password, ...rest } = smtp;
      const input: EmailDeliverySettingsInput =
        mode === "platform" ? { mode } : { mode, smtp: { ...rest, username: rest.username || rest.fromAddress, ...(password ? { password } : {}) } };
      const parsed = EmailDeliverySettingsInputSchema.safeParse(input);
      if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join("; "));
      return updateEmailSettings(parsed.data);
    },
    onSuccess: (next) => {
      queryClient.setQueryData(EMAIL_SETTINGS_KEY, next);
      setError(null);
      notify("success", "Email settings saved. Send a test email to check them.");
    },
    onError: (err: Error) => setError(err.message),
  });

  const test = useMutation({
    mutationFn: (to: string) => sendTestEmail(to),
    onSuccess: (r) =>
      notify(
        r.via === "log" ? "info" : "success",
        r.via === "log"
          ? "Not actually sent: email sending isn't set up on this server, so the message was only written to the server log."
          : `Test email sent to ${r.sentTo}. Check the inbox (and the spam folder).`,
      ),
    onError: (err: Error) => notify("error", err.message),
  });

  if (isLoading || !saved) return <p style={{ color: "var(--text-muted)" }}>Loading email settings…</p>;

  const changed =
    mode !== saved.mode ||
    (mode === "smtp" &&
      (smtp.password !== "" ||
        JSON.stringify({ ...smtp, password: undefined }) !== JSON.stringify({ ...EMPTY_SMTP, ...(saved.smtp ? (({ hasPassword: _h, ...r }) => r)(saved.smtp) : {}), password: undefined })));
  const providerInfo = PROVIDERS.find((p) => p.id === provider)!;
  const label: React.CSSProperties = { display: "block", fontSize: "var(--font-size-sm)", fontWeight: 600, marginBottom: "var(--space-1)" };
  const hint: React.CSSProperties = { margin: "var(--space-1) 0 0", fontSize: "var(--font-size-xs)", color: "var(--text-muted)" };
  const set = (patch: Partial<SmtpDraft>) => setSmtp((s) => ({ ...s, ...patch }));

  const option = (value: "platform" | "smtp", title: string, body: React.ReactNode) => (
    <label
      style={{
        display: "flex",
        gap: "var(--space-3)",
        alignItems: "flex-start",
        padding: "var(--space-3) var(--space-4)",
        border: `var(--border-width) solid ${mode === value ? "var(--accent)" : "var(--border)"}`,
        borderRadius: "var(--radius-surface)",
        cursor: canEdit ? "pointer" : "default",
        background: mode === value ? "var(--accent-subtle)" : "var(--surface)",
      }}
    >
      <input type="radio" name="email-mode" checked={mode === value} disabled={!canEdit} onChange={() => setMode(value)} style={{ marginTop: "0.2em" }} />
      <span>
        <span style={{ display: "block", fontWeight: 600 }}>{title}</span>
        <span style={{ display: "block", fontSize: "var(--font-size-sm)", color: "var(--text-muted)", marginTop: "var(--space-1)" }}>{body}</span>
      </span>
    </label>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", maxWidth: "48rem" }}>
      <div>
        <h3 style={{ margin: 0, fontSize: "var(--font-size-base)", fontWeight: 600 }}>Report emails</h3>
        <p style={{ margin: "var(--space-1) 0 0", fontSize: "var(--font-size-sm)", color: "var(--text-muted)" }}>
          How scheduled reports (Studio → Export Templates → Report emails) are sent from this workspace.
        </p>
      </div>

      <div role="radiogroup" aria-label="How emails are sent" style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        {option(
          "platform",
          "Built-in sending (recommended)",
          <>
            Nothing to set up. Emails come from {saved.platformFromAddress ? <strong>{saved.platformFromAddress}</strong> : "the platform's address"} with
            your workspace name as the sender, and replies go to the person who scheduled the report.
            {!saved.platformConfigured && (
              <span style={{ display: "flex", gap: "var(--space-1)", marginTop: "var(--space-1)", color: "var(--warning)" }}>
                <Info size="1.1em" style={{ flexShrink: 0 }} /> Not set up on this server yet: emails are only written to the server log.
              </span>
            )}
          </>,
        )}
        {option(
          "smtp",
          "Your own email account",
          "Emails come from your company's own address, for example reports@yourcompany.com, through Microsoft 365, Google Workspace or your company's mail server.",
        )}
      </div>

      {mode === "smtp" && (
        <fieldset disabled={!canEdit} style={{ border: "var(--border-width) solid var(--border)", borderRadius: "var(--radius-surface)", padding: "var(--space-4)", margin: 0, display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <legend style={{ fontSize: "var(--font-size-sm)", fontWeight: 600, padding: "0 var(--space-1)" }}>Email account</legend>
          <div>
            <label style={label} htmlFor="smtp-provider">Provider</label>
            <select
              id="smtp-provider"
              className="form-select"
              value={provider}
              onChange={(e) => {
                const p = PROVIDERS.find((x) => x.id === e.target.value)!;
                setProvider(p.id);
                if (p.host) set({ host: p.host, port: p.port, security: p.security });
              }}
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
            <p style={hint}>{providerInfo.note}</p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(14rem, 1fr))", gap: "var(--space-3)" }}>
            <div>
              <label style={label} htmlFor="smtp-from">Send from (email address)</label>
              <input id="smtp-from" type="email" className="form-input" value={smtp.fromAddress} placeholder="reports@yourcompany.com" onChange={(e) => set({ fromAddress: e.target.value })} />
            </div>
            <div>
              <label style={label} htmlFor="smtp-from-name">Sender name</label>
              <input id="smtp-from-name" className="form-input" value={smtp.fromName} placeholder="Acme Plant Reports" onChange={(e) => set({ fromName: e.target.value })} />
            </div>
            <div>
              <label style={label} htmlFor="smtp-user">Sign-in name</label>
              <input id="smtp-user" className="form-input" value={smtp.username} placeholder={smtp.fromAddress || "Usually the email address"} autoComplete="off" onChange={(e) => set({ username: e.target.value })} />
            </div>
            <div>
              <label style={label} htmlFor="smtp-password">Password</label>
              <input
                id="smtp-password"
                type="password"
                className="form-input"
                value={smtp.password}
                autoComplete="new-password"
                placeholder={saved.smtp?.hasPassword ? "Saved (type to replace)" : ""}
                onChange={(e) => set({ password: e.target.value })}
              />
              <p style={hint}>Stored encrypted and never shown again.</p>
            </div>
          </div>
          <details open={provider === "other"}>
            <summary style={{ cursor: "pointer", fontSize: "var(--font-size-sm)", fontWeight: 600 }}>Server details</summary>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(10rem, 1fr))", gap: "var(--space-3)", marginTop: "var(--space-3)" }}>
              <div>
                <label style={label} htmlFor="smtp-host">Server (SMTP host)</label>
                <input id="smtp-host" className="form-input" value={smtp.host} placeholder="smtp.yourcompany.com" onChange={(e) => set({ host: e.target.value })} />
              </div>
              <div>
                <label style={label} htmlFor="smtp-port">Port</label>
                <input id="smtp-port" type="number" className="form-input" value={smtp.port} onChange={(e) => set({ port: Number(e.target.value) })} />
              </div>
              <div>
                <label style={label} htmlFor="smtp-security">Encryption</label>
                <select id="smtp-security" className="form-select" value={smtp.security} onChange={(e) => set({ security: e.target.value as SmtpSettings["security"] })}>
                  <option value="starttls">STARTTLS (usually port 587)</option>
                  <option value="tls">SSL/TLS (usually port 465)</option>
                  <option value="none">None (not recommended)</option>
                </select>
              </div>
            </div>
          </details>
        </fieldset>
      )}

      {error && (
        <p role="alert" style={{ margin: 0, color: "var(--danger)", fontSize: "var(--font-size-sm)" }}>{error}</p>
      )}

      {canEdit ? (
        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-primary" disabled={!changed || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save email settings"}
          </button>
          <TestEmailControl disabled={changed} pending={test.isPending} onSend={(to) => test.mutate(to)} />
          {!changed && saved.mode === "smtp" && saved.smtp && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-1)", fontSize: "var(--font-size-sm)", color: "var(--text-muted)" }}>
              <CheckCircle2 size="1em" /> Using {saved.smtp.fromAddress}
            </span>
          )}
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: "var(--font-size-xs)", color: "var(--text-muted)" }}>Only admins and owners can change how emails are sent.</p>
      )}
    </div>
  );
}
