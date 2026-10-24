import React from "react";
import { Field } from "../Field";

type Format = "json" | "text" | "number";

/** How messages are read before tag rules see them as `message` */
export function FormatSelect({ id, value, onChange }: { id: string; value: Format; onChange: (format: Format) => void }) {
  return (
    <Field label="Messages are" htmlFor={id} hint={value === "json" ? 'Use message.speed for {"speed": 41}' : "Use message for the whole value"}>
      <select id={id} className="form-select" value={value} onChange={(e) => onChange(e.target.value as Format)}>
        <option value="json">JSON</option>
        <option value="number">A single number</option>
        <option value="text">Plain text</option>
      </select>
    </Field>
  );
}
