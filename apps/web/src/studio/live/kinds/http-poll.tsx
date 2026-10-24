import React from "react";
import { RefreshCw } from "lucide-react";
import { Field, FieldRow } from "../Field";
import type { KindUi } from "./kind-types";
import { FormatSelect, HeadersField, fieldset, headersFromSaved, headersToInput, type HeaderDraft, type MessageFormat } from "./shared";

interface Draft {
  url: string;
  headers: HeaderDraft[];
  intervalSec: number;
  format: MessageFormat;
}

export const httpPollKind: KindUi<Draft> = {
  label: "HTTP polling",
  hint: "A web API (MES, ERP, a device's web page) read every few seconds.",
  icon: <RefreshCw size="1.4em" />,
  empty: () => ({ url: "", headers: [], intervalSec: 10, format: "json" }),
  fromSaved: (s) => ({ url: s.url ?? "", headers: headersFromSaved(s.headers), intervalSec: s.intervalSec ?? 10, format: s.format ?? "json" }),
  toInput: (d) => ({ url: d.url.trim(), headers: headersToInput(d.headers), intervalSec: d.intervalSec, format: d.format }),
  Fields: ({ value, onChange, disabled }) => {
    const set = (patch: Partial<Draft>) => onChange({ ...value, ...patch });
    return (
      <fieldset disabled={disabled} style={fieldset}>
        <FieldRow>
          <Field label="Address" htmlFor="lc-poll-url" hint="The API address that returns the current values">
            <input id="lc-poll-url" className="form-input" value={value.url} placeholder="https://mes.factory.local/api/line1/status" onChange={(e) => set({ url: e.target.value })} />
          </Field>
          <Field label="Read every (seconds)" htmlFor="lc-poll-interval">
            <input id="lc-poll-interval" type="number" min={1} className="form-input" value={value.intervalSec} onChange={(e) => set({ intervalSec: Math.max(1, Number(e.target.value) || 10) })} />
          </Field>
          <FormatSelect id="lc-poll-format" value={value.format} onChange={(format) => set({ format })} />
        </FieldRow>
        <HeadersField value={value.headers} onChange={(headers) => set({ headers })} hint="For APIs that need a key or token, e.g. Authorization: Bearer … or X-Api-Key. Values are stored encrypted and never shown again." />
      </fieldset>
    );
  },
};
