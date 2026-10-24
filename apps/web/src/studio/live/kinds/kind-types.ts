/**
 * What each connection kind provides to the Live screen. A new kind = one file exporting a KindUi
 * and one line in ./index.ts; the editor, list and picker use it without changes.
 */
import type React from "react";
import type { LiveConnection } from "@config-platform/schema";

export interface KindFieldsProps<S> {
  value: S;
  onChange: (next: S) => void;
  disabled?: boolean;
  /** The saved connection, once there is one (e.g. HTTP push shows its address) */
  connection?: LiveConnection;
  /** A secret the server returned just now and will never return again (HTTP push token) */
  shownOnce?: string;
}

export interface KindUi<S> {
  label: string;
  hint: string;
  icon: React.ReactNode;
  /** Tag rules can be limited to a topic (MQTT topics, HTTP push ?topic=) */
  topics?: boolean;
  empty: () => S;
  /** From saved settings (secrets come back only as "is one saved") */
  fromSaved: (settings: Record<string, any>) => S;
  /** To what the server expects; an empty secret is left out so the saved one is kept */
  toInput: (draft: S) => Record<string, unknown>;
  Fields: React.ComponentType<KindFieldsProps<S>>;
}
