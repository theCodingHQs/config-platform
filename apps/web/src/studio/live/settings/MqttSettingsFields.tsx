import React from "react";
import type { ConnectionDraft } from "../connection-draft";
import { Field, FieldRow } from "../Field";
import { FormatSelect } from "./FormatSelect";

type Settings = ConnectionDraft["mqtt"];

export function MqttSettingsFields({ value, onChange, disabled }: { value: Settings; onChange: (next: Settings) => void; disabled?: boolean }) {
  const set = (patch: Partial<Settings>) => onChange({ ...value, ...patch });
  return (
    <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <FieldRow>
        <Field label="Broker address" htmlFor="lc-mqtt-url" hint="mqtt:// or mqtts:// (secure), with the port, e.g. mqtts://broker.factory.local:8883">
          <input id="lc-mqtt-url" className="form-input" value={value.url} placeholder="mqtts://broker.factory.local:8883" onChange={(e) => set({ url: e.target.value })} />
        </Field>
        <FormatSelect id="lc-mqtt-format" value={value.format} onChange={(format) => set({ format })} />
      </FieldRow>
      <Field
        label="Topics"
        htmlFor="lc-mqtt-topics"
        hint="One per line. + stands for one level, # for everything below: factory/+/status, factory/line1/#"
      >
        <textarea
          id="lc-mqtt-topics"
          className="form-input"
          rows={3}
          value={value.topics}
          placeholder={"factory/line1/#"}
          style={{ fontFamily: "var(--font-mono)", height: "auto" }}
          onChange={(e) => set({ topics: e.target.value })}
        />
      </Field>
      <FieldRow>
        <Field label="User name (optional)" htmlFor="lc-mqtt-user">
          <input id="lc-mqtt-user" className="form-input" autoComplete="off" value={value.username} onChange={(e) => set({ username: e.target.value })} />
        </Field>
        <Field label="Password (optional)" htmlFor="lc-mqtt-pass" hint="Stored encrypted and never shown again.">
          <input
            id="lc-mqtt-pass"
            type="password"
            className="form-input"
            autoComplete="new-password"
            placeholder={value.hasPassword ? "Saved (type to replace)" : ""}
            value={value.password}
            onChange={(e) => set({ password: e.target.value })}
          />
        </Field>
      </FieldRow>
      <details>
        <summary style={{ cursor: "pointer", fontSize: "var(--font-size-sm)", fontWeight: 600 }}>More settings</summary>
        <div style={{ marginTop: "var(--space-3)" }}>
          <FieldRow>
            <Field label="Client ID (optional)" htmlFor="lc-mqtt-client" hint="Only if the broker allows specific client IDs">
              <input id="lc-mqtt-client" className="form-input" value={value.clientId} onChange={(e) => set({ clientId: e.target.value })} />
            </Field>
            <Field label="Delivery (QoS)" htmlFor="lc-mqtt-qos">
              <select id="lc-mqtt-qos" className="form-select" value={value.qos} onChange={(e) => set({ qos: Number(e.target.value) as 0 | 1 | 2 })}>
                <option value={0}>0: at most once (fastest)</option>
                <option value={1}>1: at least once</option>
                <option value={2}>2: exactly once</option>
              </select>
            </Field>
          </FieldRow>
        </div>
      </details>
    </fieldset>
  );
}
