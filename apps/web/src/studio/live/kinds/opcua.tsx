import React from "react";
import { Cpu } from "lucide-react";
import { Field, FieldRow } from "../Field";
import type { KindUi } from "./kind-types";
import { RowsEditor, fieldset, mono } from "./shared";

interface Draft {
  endpointUrl: string;
  securityMode: "None" | "Sign" | "SignAndEncrypt";
  securityPolicy: "None" | "Basic256Sha256" | "Aes128_Sha256_RsaOaep" | "Aes256_Sha256_RsaPss";
  username: string;
  password: string;
  hasPassword: boolean;
  nodes: Array<{ key: string; nodeId: string }>;
  samplingMs: number;
}

export const opcuaKind: KindUi<Draft> = {
  label: "OPC UA",
  hint: "Modern PLCs and SCADA systems (Siemens, Beckhoff, Rockwell, KEPServerEX…): values arrive as they change.",
  icon: <Cpu size="1.4em" />,
  empty: () => ({ endpointUrl: "", securityMode: "None", securityPolicy: "None", username: "", password: "", hasPassword: false, nodes: [{ key: "speed", nodeId: "" }], samplingMs: 1000 }),
  fromSaved: (s) => ({
    endpointUrl: s.endpointUrl ?? "",
    securityMode: s.securityMode ?? "None",
    securityPolicy: s.securityPolicy ?? "None",
    username: s.username ?? "",
    password: "",
    hasPassword: Boolean(s.hasPassword),
    nodes: s.nodes ?? [],
    samplingMs: s.samplingMs ?? 1000,
  }),
  toInput: (d) => ({
    endpointUrl: d.endpointUrl.trim(),
    securityMode: d.securityMode,
    securityPolicy: d.securityMode === "None" ? "None" : d.securityPolicy,
    username: d.username.trim(),
    ...(d.password ? { password: d.password } : {}),
    nodes: d.nodes.filter((n) => n.key.trim() || n.nodeId.trim()).map((n) => ({ key: n.key.trim(), nodeId: n.nodeId.trim() })),
    samplingMs: d.samplingMs,
  }),
  Fields: ({ value, onChange, disabled }) => {
    const set = (patch: Partial<Draft>) => onChange({ ...value, ...patch });
    return (
      <fieldset disabled={disabled} style={fieldset}>
        <FieldRow>
          <Field label="Server address" htmlFor="lc-opc-url" hint="opc.tcp://, the host and port (4840 is common), e.g. opc.tcp://plc-line1.local:4840">
            <input id="lc-opc-url" className="form-input" value={value.endpointUrl} placeholder="opc.tcp://plc-line1.local:4840" onChange={(e) => set({ endpointUrl: e.target.value })} />
          </Field>
          <Field label="Check for changes every (ms)" htmlFor="lc-opc-sampling" hint="1000 = once a second">
            <input id="lc-opc-sampling" type="number" min={100} step={100} className="form-input" value={value.samplingMs} onChange={(e) => set({ samplingMs: Number(e.target.value) || 1000 })} />
          </Field>
        </FieldRow>
        <Field label="Values to watch" hint='A name to use in tag rules (message.speed), and the node id from the PLC or SCADA, e.g. ns=2;s=Line1.Speed or ns=3;i=1002'>
          <RowsEditor
            rows={value.nodes}
            onChange={(nodes) => set({ nodes })}
            newRow={() => ({ key: `value_${value.nodes.length + 1}`, nodeId: "" })}
            addLabel="Add value"
            columns={[
              { label: "Name", render: (row, setRow) => <input className="form-input" aria-label="Name" value={row.key} onChange={(e) => setRow({ key: e.target.value })} /> },
              { label: "Node id", render: (row, setRow) => <input className="form-input" style={mono} aria-label="Node id" placeholder="ns=2;s=Line1.Speed" value={row.nodeId} onChange={(e) => setRow({ nodeId: e.target.value })} /> },
            ]}
          />
        </Field>
        <details>
          <summary style={{ cursor: "pointer", fontSize: "var(--font-size-sm)", fontWeight: 600 }}>Security and sign-in</summary>
          <div style={{ ...fieldset, marginTop: "var(--space-3)" }}>
            <FieldRow>
              <Field label="Security" htmlFor="lc-opc-mode" hint="Use what the server requires; ask whoever set it up">
                <select id="lc-opc-mode" className="form-select" value={value.securityMode} onChange={(e) => set({ securityMode: e.target.value as Draft["securityMode"] })}>
                  <option value="None">None</option>
                  <option value="Sign">Sign</option>
                  <option value="SignAndEncrypt">Sign and encrypt</option>
                </select>
              </Field>
              {value.securityMode !== "None" && (
                <Field label="Security policy" htmlFor="lc-opc-policy">
                  <select id="lc-opc-policy" className="form-select" value={value.securityPolicy} onChange={(e) => set({ securityPolicy: e.target.value as Draft["securityPolicy"] })}>
                    <option value="Basic256Sha256">Basic256Sha256</option>
                    <option value="Aes128_Sha256_RsaOaep">Aes128_Sha256_RsaOaep</option>
                    <option value="Aes256_Sha256_RsaPss">Aes256_Sha256_RsaPss</option>
                  </select>
                </Field>
              )}
            </FieldRow>
            <FieldRow>
              <Field label="User name (optional)" htmlFor="lc-opc-user" hint="Leave empty to connect anonymously">
                <input id="lc-opc-user" className="form-input" autoComplete="off" value={value.username} onChange={(e) => set({ username: e.target.value })} />
              </Field>
              <Field label="Password" htmlFor="lc-opc-pass" hint="Stored encrypted and never shown again.">
                <input id="lc-opc-pass" type="password" className="form-input" autoComplete="new-password" placeholder={value.hasPassword ? "Saved (type to replace)" : ""} value={value.password} onChange={(e) => set({ password: e.target.value })} />
              </Field>
            </FieldRow>
          </div>
        </details>
      </fieldset>
    );
  },
};
