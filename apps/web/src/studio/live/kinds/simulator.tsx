import React from "react";
import { Waves } from "lucide-react";
import type { KindUi } from "./kind-types";
import { SimulatorFields, type SimulatorDraft } from "./SimulatorFields";
import { lines } from "./shared";

export const simulatorKind: KindUi<SimulatorDraft> = {
  label: "Simulator (demo data)",
  hint: "Made-up but believable data, to build and demo pages before machines are connected.",
  icon: <Waves size="1.4em" />,
  empty: () => ({
    intervalMs: 1000,
    signals: [
      { key: "speed", pattern: "wave", min: 30, max: 60, period: 20, values: "" },
      { key: "status", pattern: "cycle", min: 0, max: 0, period: 10, values: "running, running, running, stopped" },
      { key: "count", pattern: "counter", min: 0, max: 0, period: 1, values: "" },
    ],
  }),
  fromSaved: (s) => ({
    intervalMs: s.intervalMs ?? 1000,
    signals: (s.signals ?? []).map((g: any) => ({ ...g, values: (g.values ?? []).join(", ") })),
  }),
  toInput: (d) => ({
    intervalMs: d.intervalMs,
    signals: d.signals.map((g) => ({
      key: g.key.trim(),
      pattern: g.pattern,
      min: g.min,
      max: g.max,
      period: g.period,
      ...(g.pattern === "cycle" ? { values: lines(g.values, /,/) } : {}),
    })),
  }),
  Fields: SimulatorFields,
};
