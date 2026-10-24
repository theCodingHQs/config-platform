import React from "react";
import { Binary } from "lucide-react";
import { MODBUS_AREAS, MODBUS_TYPES } from "@config-platform/schema";
import { Field, FieldRow } from "../Field";
import type { KindUi } from "./kind-types";
import { RowsEditor, fieldset } from "./shared";

interface Point {
  key: string;
  area: (typeof MODBUS_AREAS)[number];
  address: number;
  type: (typeof MODBUS_TYPES)[number];
  wordOrder: "big" | "little";
  scale: number;
}

interface Draft {
  host: string;
  port: number;
  unitId: number;
  intervalMs: number;
  points: Point[];
}

const AREA_LABELS: Record<Point["area"], string> = {
  holding: "Holding register",
  input: "Input register",
  coil: "Coil (on/off)",
  discrete: "Discrete input (on/off)",
};

const TYPE_LABELS: Record<Point["type"], string> = {
  uint16: "Whole number (16-bit)",
  int16: "Signed number (16-bit)",
  uint32: "Whole number (32-bit)",
  int32: "Signed number (32-bit)",
  float32: "Decimal (32-bit float)",
  bool: "On/off",
};

const NEW_POINT: Omit<Point, "key"> = { area: "holding", address: 0, type: "uint16", wordOrder: "big", scale: 1 };

const num = (text: string, fallback = 0) => (text.trim() === "" ? fallback : Number(text));

export const modbusKind: KindUi<Draft> = {
  label: "Modbus TCP",
  hint: "PLCs, power meters and older equipment: registers and coils read on a timer.",
  icon: <Binary size="1.4em" />,
  empty: () => ({ host: "", port: 502, unitId: 1, intervalMs: 1000, points: [{ key: "speed", ...NEW_POINT }] }),
  fromSaved: (s) => ({ host: s.host ?? "", port: s.port ?? 502, unitId: s.unitId ?? 1, intervalMs: s.intervalMs ?? 1000, points: s.points ?? [] }),
  toInput: (d) => ({ host: d.host.trim(), port: d.port, unitId: d.unitId, intervalMs: d.intervalMs, points: d.points.map((p) => ({ ...p, key: p.key.trim() })) }),
  Fields: ({ value, onChange, disabled }) => {
    const set = (patch: Partial<Draft>) => onChange({ ...value, ...patch });
    return (
      <fieldset disabled={disabled} style={fieldset}>
        <FieldRow>
          <Field label="Device address" htmlFor="lc-mb-host" hint="IP address or host name of the PLC or meter">
            <input id="lc-mb-host" className="form-input" value={value.host} placeholder="192.168.1.20" onChange={(e) => set({ host: e.target.value })} />
          </Field>
          <Field label="Port" htmlFor="lc-mb-port" hint="Usually 502">
            <input id="lc-mb-port" type="number" className="form-input" value={value.port} onChange={(e) => set({ port: num(e.target.value, 502) })} />
          </Field>
          <Field label="Unit id" htmlFor="lc-mb-unit" hint="Usually 1 (or 255)">
            <input id="lc-mb-unit" type="number" className="form-input" value={value.unitId} onChange={(e) => set({ unitId: num(e.target.value, 1) })} />
          </Field>
          <Field label="Read every (ms)" htmlFor="lc-mb-interval" hint="1000 = once a second">
            <input id="lc-mb-interval" type="number" min={200} step={100} className="form-input" value={value.intervalMs} onChange={(e) => set({ intervalMs: num(e.target.value, 1000) })} />
          </Field>
        </FieldRow>
        <Field label="Values to read" hint="From the device's register map. Scale turns raw numbers into units, e.g. 0.1 when 215 means 21.5 °C. 32-bit values use two registers; if they look wrong, swap the word order.">
          <RowsEditor
            rows={value.points}
            onChange={(points) => set({ points })}
            newRow={() => ({ key: `value_${value.points.length + 1}`, ...NEW_POINT })}
            addLabel="Add value"
            columns={[
              { label: "Name", render: (p, s) => <input className="form-input" aria-label="Name" value={p.key} onChange={(e) => s({ key: e.target.value })} /> },
              {
                label: "Kind",
                render: (p, s) => (
                  <select className="form-select" aria-label="Kind" value={p.area} onChange={(e) => s({ area: e.target.value as Point["area"], ...(e.target.value === "coil" || e.target.value === "discrete" ? { type: "bool" } : {}) })}>
                    {MODBUS_AREAS.map((a) => <option key={a} value={a}>{AREA_LABELS[a]}</option>)}
                  </select>
                ),
              },
              { label: "Address", render: (p, s) => <input type="number" min={0} className="form-input" aria-label="Address" value={p.address} onChange={(e) => s({ address: num(e.target.value) })} /> },
              {
                label: "Type",
                render: (p, s) => (
                  <select className="form-select" aria-label="Type" value={p.type} disabled={p.area === "coil" || p.area === "discrete"} onChange={(e) => s({ type: e.target.value as Point["type"] })}>
                    {MODBUS_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                  </select>
                ),
              },
              {
                label: "Word order",
                render: (p, s) => (
                  <select className="form-select" aria-label="Word order" value={p.wordOrder} disabled={!["uint32", "int32", "float32"].includes(p.type)} onChange={(e) => s({ wordOrder: e.target.value as Point["wordOrder"] })}>
                    <option value="big">High word first</option>
                    <option value="little">Low word first</option>
                  </select>
                ),
              },
              { label: "Scale", render: (p, s) => <input type="number" step="any" className="form-input" aria-label="Scale" value={p.scale} disabled={p.type === "bool"} onChange={(e) => s({ scale: num(e.target.value, 1) })} /> },
            ]}
          />
        </Field>
      </fieldset>
    );
  },
};
