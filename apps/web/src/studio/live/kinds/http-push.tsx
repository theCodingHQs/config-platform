import React, { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { KeyRound, Send } from "lucide-react";
import { API_BASE_URL } from "../../../config";
import { liveApi } from "../../../live/live-api";
import { Field } from "../Field";
import type { KindUi } from "./kind-types";
import { FormatSelect, fieldset, mono, type MessageFormat } from "./shared";

interface Draft {
  format: MessageFormat;
  hasToken: boolean;
}

/** The address devices send to: the app's own, as this browser reaches it */
const pushAddress = (connectionId: string) => {
  const base = /^https?:\/\//i.test(API_BASE_URL) ? API_BASE_URL : `${window.location.origin}${API_BASE_URL}`;
  return `${base.replace(/\/$/, "")}/live/push/${connectionId}`;
};

export const httpPushKind: KindUi<Draft> = {
  label: "HTTP push",
  hint: "Devices, scripts, Node-RED or an MES send each message to this connection's own web address.",
  icon: <Send size="1.4em" />,
  topics: true,
  empty: () => ({ format: "json", hasToken: false }),
  fromSaved: (s) => ({ format: s.format ?? "json", hasToken: Boolean(s.hasToken) }),
  toInput: (d) => ({ format: d.format }),
  Fields: ({ value, onChange, disabled, connection, shownOnce }) => {
    const [token, setToken] = useState<string | undefined>(shownOnce);
    const regenerate = useMutation({
      mutationFn: () => liveApi.newPushToken(connection!.id),
      onSuccess: (r) => setToken(r.pushToken),
    });
    const shown = token ?? shownOnce;
    return (
      <fieldset disabled={disabled} style={fieldset}>
        <FormatSelect id="lc-push-format" value={value.format} onChange={(format) => onChange({ ...value, format })} />
        {!connection ? (
          <p style={{ margin: 0, fontSize: "var(--font-size-sm)", color: "var(--text-muted)" }}>The address and token to send to appear once the connection is created.</p>
        ) : (
          <>
            <Field label="Send messages to" hint='POST the message (JSON or text) here. Add ?topic=line1/status to use topics in tag rules.'>
              <code style={{ ...mono, padding: "var(--space-2)", background: "var(--surface-subtle)", borderRadius: "var(--radius-control)", overflowWrap: "anywhere" }}>{pushAddress(connection.id)}</code>
            </Field>
            <Field label="Token" hint={<>Send it with each message as <code>Authorization: Bearer &lt;token&gt;</code>. A new token stops the old one working.</>}>
              {shown ? (
                <div role="note" style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", padding: "var(--space-2) var(--space-3)", background: "var(--warning-subtle)", borderRadius: "var(--radius-control)" }}>
                  <code style={{ ...mono, overflowWrap: "anywhere" }}>{shown}</code>
                  <span style={{ fontSize: "var(--font-size-xs)" }}>Copy it now: it won't be shown again.</span>
                </div>
              ) : (
                <span style={{ fontSize: "var(--font-size-sm)", color: "var(--text-muted)" }}>{value.hasToken ? "A token is set (hidden)." : "No token yet."}</span>
              )}
              <div>
                <button type="button" className="btn btn-secondary btn-sm" disabled={regenerate.isPending} onClick={() => confirm("Make a new token? Devices using the old one will be refused until they get the new one.") && regenerate.mutate()}>
                  <KeyRound size="1em" /> {regenerate.isPending ? "Making…" : "New token"}
                </button>
              </div>
              {regenerate.error && <span style={{ color: "var(--danger)", fontSize: "var(--font-size-sm)" }}>{(regenerate.error as Error).message}</span>}
            </Field>
          </>
        )}
      </fieldset>
    );
  },
};
