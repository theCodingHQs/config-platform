import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Lock, Mail, Server, ShieldCheck, Trash2, UserPlus, Users } from "lucide-react";
import {
  PlatformSettingsInputSchema,
  type PlatformEmailProvider,
  type PlatformSettingsInput,
  type PlatformSettingsView,
  type SignupMode,
} from "@config-platform/schema";
import {
  addPlatformAdmin,
  fetchPlatformSettings,
  removePlatformAdmin,
  sendPlatformTestEmail,
  updatePlatformSettings,
} from "../api/client";
import { useStatusNotify } from "../context/app-bar-context";
import { useAuth } from "../context/auth-context";
import { TestEmailControl } from "../components/test-email-control";

const PLATFORM_KEY = ["platform-settings"];

const label: React.CSSProperties = { display: "block", fontSize: "var(--font-size-sm)", fontWeight: 600, marginBottom: "var(--space-1)" };
const hint: React.CSSProperties = { margin: "var(--space-1) 0 0", fontSize: "var(--font-size-xs)", color: "var(--text-muted)" };

function Section({ icon, title, intro, children }: { icon: React.ReactNode; title: string; intro: React.ReactNode; children: React.ReactNode }) {
  return (
    <section
      style={{
        border: "var(--border-width) solid var(--border)",
        borderRadius: "var(--radius-surface)",
        background: "var(--surface)",
        padding: "var(--space-5)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
      }}
    >
      <div>
        <h2 style={{ margin: 0, fontSize: "var(--font-size-lg)", fontWeight: 600, display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          {icon} {title}
        </h2>
        <p style={{ margin: "var(--space-1) 0 0", fontSize: "var(--font-size-sm)", color: "var(--text-muted)" }}>{intro}</p>
      </div>
      {children}
    </section>
  );
}

/** Shown instead of a control when the server's configuration sets the value */
function LockedByServer({ what }: { what: string }) {
  return (
    <p role="note" style={{ margin: 0, display: "flex", gap: "var(--space-2)", alignItems: "flex-start", fontSize: "var(--font-size-sm)", padding: "var(--space-2) var(--space-3)", background: "var(--surface-subtle)", borderRadius: "var(--radius-control)" }}>
      <Lock size="1.1em" style={{ flexShrink: 0, marginTop: "0.1em", color: "var(--text-muted)" }} />
      <span>
        Set by the server's configuration ({what}), which takes priority over this screen. Change it where the server is hosted, or
        remove it there to manage it here.
      </span>
    </p>
  );
}

function RadioCard({ name, checked, disabled, onChange, title, body }: { name: string; checked: boolean; disabled?: boolean; onChange: () => void; title: string; body: React.ReactNode }) {
  return (
    <label
      style={{
        display: "flex",
        gap: "var(--space-3)",
        alignItems: "flex-start",
        padding: "var(--space-3) var(--space-4)",
        border: `var(--border-width) solid ${checked ? "var(--accent)" : "var(--border)"}`,
        borderRadius: "var(--radius-surface)",
        background: checked ? "var(--accent-subtle)" : "var(--surface)",
        cursor: disabled ? "default" : "pointer",
      }}
    >
      <input type="radio" name={name} checked={checked} disabled={disabled} onChange={onChange} style={{ marginTop: "0.2em" }} />
      <span>
        <span style={{ display: "block", fontWeight: 600 }}>{title}</span>
        <span style={{ display: "block", fontSize: "var(--font-size-sm)", color: "var(--text-muted)", marginTop: "var(--space-1)" }}>{body}</span>
      </span>
    </label>
  );
}

/** Studio → Platform: settings for the whole server (every workspace), for platform owners. */
export function PlatformSetup() {
  const { data: view, isLoading, error } = useQuery({ queryKey: PLATFORM_KEY, queryFn: fetchPlatformSettings });

  if (isLoading) return <p style={{ color: "var(--text-muted)" }}>Loading platform setup…</p>;
  if (error || !view) return <p style={{ color: "var(--danger)" }}>{(error as Error)?.message || "Platform setup could not be loaded"}</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)", maxWidth: "52rem" }}>
      <div>
        <h1 style={{ margin: 0, fontSize: "var(--font-size-2xl)", fontWeight: 700, display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <Server size="1em" style={{ color: "var(--accent)" }} /> Platform setup
        </h1>
        <p style={{ margin: "var(--space-1) 0 0", color: "var(--text-muted)", fontSize: "var(--font-size-sm)" }}>
          Settings for this whole server: they apply to every workspace on it. Only platform owners see this page.
        </p>
      </div>
      <EmailServiceSection view={view} />
      <AccessSection view={view} />
      <OwnersSection view={view} />
      <p style={{ ...hint, display: "flex", gap: "var(--space-2)", alignItems: "flex-start" }}>
        <KeyRound size="1.2em" style={{ flexShrink: 0 }} />
        {view.encryptionKey === "env"
          ? "Passwords and keys saved here are encrypted with the key from the server's configuration (SETTINGS_ENCRYPTION_KEY)."
          : "Passwords and keys saved here are encrypted with a key the server created in .secrets/settings-encryption.key. Back that file up together with your database: without it, saved passwords must be entered again."}
      </p>
    </div>
  );
}

function useSave() {
  const queryClient = useQueryClient();
  const notify = useStatusNotify();
  return useMutation({
    mutationFn: (input: PlatformSettingsInput) => {
      const parsed = PlatformSettingsInputSchema.safeParse(input);
      if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join("; "));
      return updatePlatformSettings(parsed.data);
    },
    onSuccess: (next) => {
      queryClient.setQueryData(PLATFORM_KEY, next);
      notify("success", "Platform setup saved.");
    },
    onError: (err: Error) => notify("error", err.message),
  });
}

function EmailServiceSection({ view }: { view: PlatformSettingsView }) {
  const notify = useStatusNotify();
  const save = useSave();
  const e = view.email;
  const locked = e.source === "env";
  const [provider, setProvider] = useState<PlatformEmailProvider>(e.provider);
  const [resendApiKey, setResendApiKey] = useState("");
  const [smtp, setSmtp] = useState({ host: "", port: 587, security: "starttls" as "tls" | "starttls" | "none", username: "", password: "" });
  const [fromAddress, setFromAddress] = useState(e.fromAddress);
  const [fromName, setFromName] = useState(e.fromName);

  useEffect(() => {
    setProvider(e.provider);
    setFromAddress(e.fromAddress);
    setFromName(e.fromName);
    setResendApiKey("");
    if (e.smtp) setSmtp({ host: e.smtp.host, port: e.smtp.port, security: e.smtp.security, username: e.smtp.username, password: "" });
  }, [e]);

  const test = useMutation({
    mutationFn: (to: string) => sendPlatformTestEmail(to),
    onSuccess: (r) => notify("success", `Test email sent to ${r.sentTo}. Check the inbox (and the spam folder).`),
    onError: (err: Error) => notify("error", err.message),
  });

  const changed =
    provider !== e.provider ||
    resendApiKey !== "" ||
    fromAddress !== e.fromAddress ||
    fromName !== e.fromName ||
    (provider === "smtp" &&
      (smtp.password !== "" || smtp.host !== (e.smtp?.host ?? "") || smtp.port !== (e.smtp?.port ?? 587) || smtp.security !== (e.smtp?.security ?? "starttls") || smtp.username !== (e.smtp?.username ?? "")));

  const submit = () =>
    save.mutate({
      email: {
        provider,
        ...(resendApiKey ? { resendApiKey } : {}),
        ...(provider === "smtp"
          ? { smtp: { host: smtp.host, port: smtp.port, security: smtp.security, username: smtp.username, ...(smtp.password ? { password: smtp.password } : {}) } }
          : {}),
        fromAddress,
        fromName,
      },
    });

  return (
    <Section
      icon={<Mail size="1em" />}
      title="Email service"
      intro="Sends invitations, email confirmations and scheduled reports for every workspace. Workspaces can still use their own email account under Settings → Email."
    >
      {locked ? (
        <>
          <LockedByServer what={e.provider === "resend" ? "RESEND_API_KEY" : "SMTP_URL"} />
          <p style={{ margin: 0, fontSize: "var(--font-size-sm)" }}>
            Sending with <strong>{e.provider === "resend" ? "Resend" : "an SMTP mail server"}</strong>
            {e.fromAddress ? <> from <strong>{e.fromAddress}</strong></> : null}.
          </p>
        </>
      ) : (
        <>
          <div role="radiogroup" aria-label="Email service" style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <RadioCard name="provider" checked={provider === "none"} onChange={() => setProvider("none")} title="Not set up" body="No emails are sent. Invitations must be shared as links, and report emails won't be delivered." />
            <RadioCard
              name="provider"
              checked={provider === "resend"}
              onChange={() => setProvider("resend")}
              title="Resend (recommended)"
              body={<>An email-sending service: create an account at resend.com, add your domain there, then paste its API key here.</>}
            />
            <RadioCard name="provider" checked={provider === "smtp"} onChange={() => setProvider("smtp")} title="A mail server (SMTP)" body="Any email account or service that gives SMTP details: Microsoft 365, Google Workspace, Amazon SES, Mailgun, a company mail server." />
          </div>

          {provider !== "none" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(14rem, 1fr))", gap: "var(--space-3)" }}>
              {provider === "resend" && (
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={label} htmlFor="ps-resend-key">Resend API key</label>
                  <input
                    id="ps-resend-key"
                    type="password"
                    className="form-input"
                    value={resendApiKey}
                    autoComplete="off"
                    placeholder={e.hasResendApiKey ? "Saved (type to replace)" : "re_…"}
                    onChange={(ev) => setResendApiKey(ev.target.value)}
                  />
                  <p style={hint}>Stored encrypted and never shown again.</p>
                </div>
              )}
              {provider === "smtp" && (
                <>
                  <div>
                    <label style={label} htmlFor="ps-smtp-host">Server (SMTP host)</label>
                    <input id="ps-smtp-host" className="form-input" value={smtp.host} placeholder="smtp.office365.com" onChange={(ev) => setSmtp({ ...smtp, host: ev.target.value })} />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: "var(--space-2)" }}>
                    <div>
                      <label style={label} htmlFor="ps-smtp-port">Port</label>
                      <input id="ps-smtp-port" type="number" className="form-input" value={smtp.port} onChange={(ev) => setSmtp({ ...smtp, port: Number(ev.target.value) })} />
                    </div>
                    <div>
                      <label style={label} htmlFor="ps-smtp-security">Encryption</label>
                      <select id="ps-smtp-security" className="form-select" value={smtp.security} onChange={(ev) => setSmtp({ ...smtp, security: ev.target.value as typeof smtp.security })}>
                        <option value="starttls">STARTTLS (587)</option>
                        <option value="tls">SSL/TLS (465)</option>
                        <option value="none">None</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label style={label} htmlFor="ps-smtp-user">Sign-in name</label>
                    <input id="ps-smtp-user" className="form-input" value={smtp.username} autoComplete="off" onChange={(ev) => setSmtp({ ...smtp, username: ev.target.value })} />
                  </div>
                  <div>
                    <label style={label} htmlFor="ps-smtp-password">Password</label>
                    <input
                      id="ps-smtp-password"
                      type="password"
                      className="form-input"
                      value={smtp.password}
                      autoComplete="new-password"
                      placeholder={e.smtp?.hasPassword ? "Saved (type to replace)" : ""}
                      onChange={(ev) => setSmtp({ ...smtp, password: ev.target.value })}
                    />
                  </div>
                </>
              )}
              <div>
                <label style={label} htmlFor="ps-from">Send from (email address)</label>
                <input id="ps-from" type="email" className="form-input" value={fromAddress} placeholder="noreply@yourproduct.com" onChange={(ev) => setFromAddress(ev.target.value)} />
                <p style={hint}>Must belong to a domain the service is allowed to send for.</p>
              </div>
              <div>
                <label style={label} htmlFor="ps-from-name">Default sender name</label>
                <input id="ps-from-name" className="form-input" value={fromName} placeholder="Your product name" onChange={(ev) => setFromName(ev.target.value)} />
                <p style={hint}>Report emails show the workspace's name instead.</p>
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
            <button type="button" className="btn btn-primary" disabled={!changed || save.isPending} onClick={submit}>
              {save.isPending ? "Saving…" : "Save email service"}
            </button>
            {e.provider !== "none" && (
              <TestEmailControl disabled={changed} pending={test.isPending} onSend={(to) => test.mutate(to)} />
            )}
          </div>
        </>
      )}
    </Section>
  );
}

function AccessSection({ view }: { view: PlatformSettingsView }) {
  const save = useSave();
  const [signupMode, setSignupMode] = useState<SignupMode>(view.signupMode.value);
  const [publicUrl, setPublicUrl] = useState(view.publicUrl.source === "saved" ? view.publicUrl.value : "");
  useEffect(() => {
    setSignupMode(view.signupMode.value);
    setPublicUrl(view.publicUrl.source === "saved" ? view.publicUrl.value : "");
  }, [view]);

  const signupLocked = view.signupMode.source === "env";
  const urlLocked = view.publicUrl.source === "env";
  const savedUrl = view.publicUrl.source === "saved" ? view.publicUrl.value : "";
  const changed = (!signupLocked && signupMode !== view.signupMode.value) || (!urlLocked && publicUrl.trim().replace(/\/$/, "") !== savedUrl);

  return (
    <Section icon={<ShieldCheck size="1em" />} title="Sign-ups and website address" intro="Who can create a new workspace on this server, and the address used in links inside emails.">
      <div>
        <span style={label}>Who can sign up</span>
        {signupLocked ? (
          <LockedByServer what="SIGNUP_MODE" />
        ) : (
          <div role="radiogroup" aria-label="Who can sign up" style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <RadioCard name="signup" checked={signupMode === "invite_only"} onChange={() => setSignupMode("invite_only")} title="Invited people only" body="New people join a workspace when someone invites them. Best for one company's own server." />
            <RadioCard name="signup" checked={signupMode === "open"} onChange={() => setSignupMode("open")} title="Anyone" body="Anyone can create an account and their own workspace from the login page. Use this when selling the platform online." />
          </div>
        )}
      </div>
      <div>
        <label style={label} htmlFor="ps-url">Website address</label>
        {urlLocked ? (
          <LockedByServer what="PUBLIC_URL" />
        ) : (
          <>
            <input id="ps-url" className="form-input" value={publicUrl} placeholder={view.publicUrl.value} onChange={(ev) => setPublicUrl(ev.target.value)} />
            <p style={hint}>The address people open the app at, for example https://apps.yourcompany.com. Invitation and confirmation links point here.</p>
          </>
        )}
      </div>
      {!(signupLocked && urlLocked) && (
        <div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!changed || save.isPending}
            onClick={() => save.mutate({ ...(signupLocked ? {} : { signupMode }), ...(urlLocked ? {} : { publicUrl: publicUrl.trim() }) })}
          >
            {save.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      )}
    </Section>
  );
}

function OwnersSection({ view }: { view: PlatformSettingsView }) {
  const queryClient = useQueryClient();
  const notify = useStatusNotify();
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const setAdmins = (admins: PlatformSettingsView["platformAdmins"]) =>
    queryClient.setQueryData<PlatformSettingsView>(PLATFORM_KEY, (v) => (v ? { ...v, platformAdmins: admins } : v));
  const add = useMutation({
    mutationFn: () => addPlatformAdmin(email.trim()),
    onSuccess: (admins) => {
      setAdmins(admins);
      notify("success", `${email.trim()} is now a platform owner.`);
      setEmail("");
    },
    onError: (err: Error) => notify("error", err.message),
  });
  const remove = useMutation({
    mutationFn: (userId: string) => removePlatformAdmin(userId),
    onSuccess: (admins) => {
      setAdmins(admins);
      notify("success", "Platform owner removed.");
    },
    onError: (err: Error) => notify("error", err.message),
  });

  return (
    <Section icon={<Users size="1em" />} title="Platform owners" intro="People who can open this page. Being a platform owner doesn't give access to any workspace's data.">
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
        {view.platformAdmins.map((a) => (
          <li key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-2)", padding: "var(--space-2) var(--space-3)", border: "var(--border-width) solid var(--border)", borderRadius: "var(--radius-control)" }}>
            <span style={{ overflowWrap: "anywhere" }}>
              {a.email}
              {a.id === user?.id && <span style={{ color: "var(--text-muted)" }}> (you)</span>}
            </span>
            {view.platformAdmins.length > 1 && (
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-icon"
                style={{ color: "var(--danger)" }}
                aria-label={`Remove ${a.email}`}
                title="Remove as platform owner"
                onClick={() => confirm(`Remove ${a.email} as a platform owner?`) && remove.mutate(a.id)}
              >
                <Trash2 size="1em" />
              </button>
            )}
          </li>
        ))}
      </ul>
      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          if (email.trim()) add.mutate();
        }}
        style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}
      >
        <input
          type="email"
          className="form-input"
          style={{ flex: "1 1 16rem", width: "auto" }}
          value={email}
          placeholder="Email of an existing account"
          aria-label="Email of the new platform owner"
          onChange={(ev) => setEmail(ev.target.value)}
        />
        <button type="submit" className="btn btn-secondary" disabled={!email.trim() || add.isPending}>
          <UserPlus size="1em" /> Add owner
        </button>
      </form>
    </Section>
  );
}
