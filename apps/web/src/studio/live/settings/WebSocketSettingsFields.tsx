import React from "react";
import { Plus, X } from "lucide-react";
import type { ConnectionDraft, HeaderDraft } from "../connection-draft";
import { Field, FieldRow } from "../Field";
import { FormatSelect } from "./FormatSelect";

type Settings = ConnectionDraft["websocket"];

export function WebSocketSettingsFields({ value, onChange, disabled }: { value: Settings; onChange: (next: Settings) => void; disabled?: boolean }) {
  const set = (patch: Partial<Settings>) => onChange({ ...value, ...patch });
  const setHeader = (i: number, patch: Partial<HeaderDraft>) => set({ headers: value.headers.map((h, j) => (j === i ? { ...h, ...patch } : h)) });

  return (
    <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <FieldRow>
        <Field label="Address" htmlFor="lc-ws-url" hint="Starts with ws:// or wss:// (secure). Ask whoever runs the gateway.">
          <input id="lc-ws-url" className="form-input" value={value.url} placeholder="wss://gateway.factory.local/stream" onChange={(e) => set({ url: e.target.value })} />
        </Field>
        <FormatSelect id="lc-ws-format" value={value.format} onChange={(format) => set({ format })} />
      </FieldRow>
      <Field label="Message to send after connecting (optional)" htmlFor="lc-ws-sub" hint='Some gateways need a subscription first, e.g. {"subscribe": ["line1/*"]}'>
        <textarea id="lc-ws-sub" className="form-input" rows={2} value={value.subscribeMessage} style={{ fontFamily: "var(--font-mono)", height: "auto" }} onChange={(e) => set({ subscribeMessage: e.target.value })} />
      </Field>
      <Field label="Headers (optional)" hint="For gateways that need a token, e.g. Authorization: Bearer …. Values are stored encrypted and never shown again.">
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          {value.headers.map((h, i) => (
            <div key={i} style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
              <input className="form-input" aria-label="Header name" placeholder="Authorization" value={h.name} onChange={(e) => setHeader(i, { name: e.target.value })} />
              <input
                className="form-input"
                type="password"
                aria-label="Header value"
                autoComplete="off"
                placeholder={h.saved ? "Saved (type to replace)" : "Value"}
                value={h.value}
                onChange={(e) => setHeader(i, { value: e.target.value })}
              />
              <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Remove header" onClick={() => set({ headers: value.headers.filter((_, j) => j !== i) })}>
                <X size="1em" />
              </button>
            </div>
          ))}
          <div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => set({ headers: [...value.headers, { name: "", value: "", saved: false }] })}>
              <Plus size="1em" /> Add header
            </button>
          </div>
        </div>
      </Field>
    </fieldset>
  );
}
