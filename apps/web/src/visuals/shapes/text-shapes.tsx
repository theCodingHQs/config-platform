/** Shapes that are words and numbers: a label, and a panel showing a value */
import React from "react";
import { textWidth } from "./floating-label";
import type { ShapeDef } from "./shape-types";

const TEXT_SIZES = { sm: 11, md: 14, lg: 20 } as const;

export const label: ShapeDef = {
  type: "label",
  label: "Label",
  category: "Signals & text",
  description: "Text on the drawing; bind it to show live words or numbers",
  noTurn: true,
  props: [
    { name: "text", label: "Text", kind: "text", default: "Label", hint: 'e.g. concat("Line 1: ", live.line1.status)' },
    {
      name: "size",
      label: "Size",
      kind: "select",
      default: "md",
      options: [
        { value: "sm", label: "Small" },
        { value: "md", label: "Medium" },
        { value: "lg", label: "Large" },
      ],
    },
    { name: "plate", label: "Background", kind: "boolean", default: true },
  ],
  footprint: () => ({ a: 1, b: 0.5, h: 0.5 }),
  Render: ({ p }) => {
    const size = TEXT_SIZES[String(p.size) as keyof typeof TEXT_SIZES] ?? TEXT_SIZES.md;
    const text = String(p.text);
    const w = textWidth(text, size) + 14;
    const h = size + 10;
    return (
      <g>
        {p.plate && <rect className="vis-plate" x={0} y={-h} width={w} height={h} rx={5} />}
        <text className="vis-text-strong" x={7} y={-h / 2} dominantBaseline="central" fontSize={size}>
          {text}
        </text>
      </g>
    );
  },
};

const TONES = { default: "var(--vis-steel)", good: "var(--vis-on)", warning: "var(--vis-idle)", alarm: "var(--vis-alarm)" } as const;

export const valueDisplay: ShapeDef = {
  type: "value",
  label: "Value panel",
  category: "Signals & text",
  description: "A panel showing a live number with its name and unit",
  noTurn: true,
  props: [
    { name: "title", label: "Name", kind: "text", default: "Speed" },
    { name: "value", label: "Value", kind: "text", default: "—", hint: "e.g. live.line1.speed" },
    { name: "unit", label: "Unit", kind: "text", default: "" },
    { name: "decimals", label: "Decimals", kind: "number", default: 1, min: 0, max: 4, step: 1, bindable: false },
    {
      name: "tone",
      label: "Colour",
      kind: "select",
      default: "default",
      options: [
        { value: "default", label: "Neutral" },
        { value: "good", label: "Good (green)" },
        { value: "warning", label: "Warning (amber)" },
        { value: "alarm", label: "Alarm (red)" },
      ],
      hint: 'e.g. live.line1.speed < 20 ? "alarm" : "good"',
    },
  ],
  footprint: () => ({ a: 1, b: 0.5, h: 0.5 }),
  Render: ({ p }) => {
    const raw = p.value;
    const num = typeof raw === "number" ? raw : raw !== "" && !Number.isNaN(Number(raw)) ? Number(raw) : null;
    const shown = num !== null ? num.toLocaleString(undefined, { minimumFractionDigits: Number(p.decimals), maximumFractionDigits: Number(p.decimals) }) : String(raw);
    const valueText = `${shown}${p.unit ? ` ${p.unit}` : ""}`;
    const w = Math.max(textWidth(String(p.title), 11), textWidth(valueText, 20)) + 24;
    return (
      <g>
        <rect className="vis-plate" x={0} y={-52} width={w} height={52} rx={6} />
        <rect x={0} y={-52} width={5} height={52} rx={2} style={{ fill: TONES[String(p.tone) as keyof typeof TONES] ?? TONES.default }} />
        <text className="vis-text" x={14} y={-36} dominantBaseline="central" fontSize={11} style={{ opacity: 0.75 }}>
          {String(p.title)}
        </text>
        <text className="vis-text-strong" x={14} y={-16} dominantBaseline="central" fontSize={20}>
          {valueText}
        </text>
      </g>
    );
  },
};
