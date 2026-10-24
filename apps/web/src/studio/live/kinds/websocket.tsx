import React from "react";
import { Activity } from "lucide-react";
import { Field, FieldRow } from "../Field";
import type { KindUi } from "./kind-types";
import { FormatSelect, HeadersField, fieldset, headersFromSaved, headersToInput, optional, type HeaderDraft, type MessageFormat } from "./shared";

interface Draft {
  url: string;
  headers: HeaderDraft[];
  subscribeMessage: string;
  format: MessageFormat;
}

export const websocketKind: KindUi<Draft> = {
  label: "WebSocket",
  hint: "A machine gateway, Node-RED, or a SCADA/MES system that streams messages over WebSocket.",
  icon: <Activity size="1.4em" />,
  empty: () => ({ url: "", headers: [], subscribeMessage: "", format: "json" }),
  fromSaved: (s) => ({ url: s.url ?? "", headers: headersFromSaved(s.headers), subscribeMessage: s.subscribeMessage ?? "", format: s.format ?? "json" }),
  toInput: (d) => ({ url: d.url.trim(), headers: headersToInput(d.headers), subscribeMessage: optional(d.subscribeMessage), format: d.format }),
  Fields: ({ value, onChange, disabled }) => {
    const set = (patch: Partial<Draft>) => onChange({ ...value, ...patch });
    return (
      <fieldset disabled={disabled} style={fieldset}>
        <FieldRow>
          <Field label="Address" htmlFor="lc-ws-url" hint="Starts with ws:// or wss:// (secure). Ask whoever runs the gateway.">
            <input id="lc-ws-url" className="form-input" value={value.url} placeholder="wss://gateway.factory.local/stream" onChange={(e) => set({ url: e.target.value })} />
          </Field>
          <FormatSelect id="lc-ws-format" value={value.format} onChange={(format) => set({ format })} />
        </FieldRow>
        <Field label="Message to send after connecting (optional)" htmlFor="lc-ws-sub" hint='Some gateways need a subscription first, e.g. {"subscribe": ["line1/*"]}'>
          <textarea id="lc-ws-sub" className="form-input" rows={2} value={value.subscribeMessage} style={{ fontFamily: "var(--font-mono)", height: "auto" }} onChange={(e) => set({ subscribeMessage: e.target.value })} />
        </Field>
        <HeadersField value={value.headers} onChange={(headers) => set({ headers })} />
      </fieldset>
    );
  },
};
