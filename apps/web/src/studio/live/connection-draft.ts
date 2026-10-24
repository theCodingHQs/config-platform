/**
 * The connection form's values, and conversion to and from what the server stores. Pure, so
 * the form components only render and change a draft.
 */
import type { LiveConnection, LiveConnectionKind, PageRole, TagRule } from "@config-platform/schema";

export interface HeaderDraft {
  name: string;
  /** Typed value; empty = keep the saved one */
  value: string;
  saved: boolean;
}

export interface SignalDraft {
  key: string;
  pattern: "wave" | "random" | "counter" | "cycle";
  min: number;
  max: number;
  period: number;
  values: string;
}

export interface ConnectionDraft {
  id?: string;
  name: string;
  kind: LiveConnectionKind;
  enabled: boolean;
  viewRoles: PageRole[];
  tags: TagRule[];
  websocket: { url: string; headers: HeaderDraft[]; subscribeMessage: string; format: "json" | "text" | "number" };
  mqtt: {
    url: string;
    username: string;
    password: string;
    hasPassword: boolean;
    clientId: string;
    topics: string;
    qos: 0 | 1 | 2;
    format: "json" | "text" | "number";
  };
  simulator: { intervalMs: number; signals: SignalDraft[] };
}

export const KIND_LABELS: Record<LiveConnectionKind, string> = {
  websocket: "WebSocket",
  mqtt: "MQTT broker",
  simulator: "Simulator (demo data)",
};

export const KIND_HINTS: Record<LiveConnectionKind, string> = {
  websocket: "A machine gateway, Node-RED, or a SCADA/MES system that streams messages over WebSocket.",
  mqtt: "A broker your machines and gateways publish to (Mosquitto, HiveMQ, EMQX, AWS IoT…).",
  simulator: "Made-up but believable data, to build and demo pages before machines are connected.",
};

export function emptyDraft(kind: LiveConnectionKind): ConnectionDraft {
  return {
    name: "",
    kind,
    enabled: true,
    viewRoles: [],
    tags: [],
    websocket: { url: "", headers: [], subscribeMessage: "", format: "json" },
    mqtt: { url: "", username: "", password: "", hasPassword: false, clientId: "", topics: "", qos: 0, format: "json" },
    simulator: {
      intervalMs: 1000,
      signals: [
        { key: "speed", pattern: "wave", min: 30, max: 60, period: 20, values: "" },
        { key: "status", pattern: "cycle", min: 0, max: 0, period: 10, values: "running, running, running, stopped" },
        { key: "count", pattern: "counter", min: 0, max: 0, period: 1, values: "" },
      ],
    },
  };
}

export function draftFromConnection(c: LiveConnection): ConnectionDraft {
  const draft = emptyDraft(c.kind);
  const s = c.settings;
  draft.id = c.id;
  draft.name = c.name;
  draft.enabled = c.enabled;
  draft.viewRoles = c.viewRoles;
  draft.tags = c.tags;
  if (c.kind === "websocket") {
    draft.websocket = {
      url: s.url ?? "",
      headers: (s.headers ?? []).map((h: any) => ({ name: h.name, value: "", saved: Boolean(h.hasValue) })),
      subscribeMessage: s.subscribeMessage ?? "",
      format: s.format ?? "json",
    };
  } else if (c.kind === "mqtt") {
    draft.mqtt = {
      url: s.url ?? "",
      username: s.username ?? "",
      password: "",
      hasPassword: Boolean(s.hasPassword),
      clientId: s.clientId ?? "",
      topics: (s.topics ?? []).join("\n"),
      qos: s.qos ?? 0,
      format: s.format ?? "json",
    };
  } else {
    draft.simulator = {
      intervalMs: s.intervalMs ?? 1000,
      signals: (s.signals ?? []).map((g: any) => ({ ...g, values: (g.values ?? []).join(", ") })),
    };
  }
  return draft;
}

const optional = (text: string) => (text.trim() ? text.trim() : undefined);
const list = (text: string, separator: RegExp) => text.split(separator).map((t) => t.trim()).filter(Boolean);

/** What the server expects (LiveConnectionInputSchema); empty secrets are left out to keep them */
export function draftToInput(d: ConnectionDraft): Record<string, unknown> {
  const tags = d.tags.map((t) => ({
    ...t,
    when: optional(t.when ?? ""),
    topic: optional(t.topic ?? ""),
    unit: optional(t.unit ?? ""),
    label: optional(t.label ?? ""),
  }));
  const settings =
    d.kind === "websocket"
      ? {
          url: d.websocket.url.trim(),
          headers: d.websocket.headers.filter((h) => h.name.trim()).map((h) => ({ name: h.name.trim(), ...(h.value ? { value: h.value } : {}) })),
          subscribeMessage: optional(d.websocket.subscribeMessage),
          format: d.websocket.format,
        }
      : d.kind === "mqtt"
        ? {
            url: d.mqtt.url.trim(),
            username: d.mqtt.username.trim(),
            ...(d.mqtt.password ? { password: d.mqtt.password } : {}),
            clientId: optional(d.mqtt.clientId),
            topics: list(d.mqtt.topics, /[\n,]+/),
            qos: d.mqtt.qos,
            format: d.mqtt.format,
          }
        : {
            intervalMs: d.simulator.intervalMs,
            signals: d.simulator.signals.map((g) => ({
              key: g.key.trim(),
              pattern: g.pattern,
              min: g.min,
              max: g.max,
              period: g.period,
              ...(g.pattern === "cycle" ? { values: list(g.values, /,/) } : {}),
            })),
          };
  return { name: d.name.trim(), kind: d.kind, enabled: d.enabled, viewRoles: d.viewRoles, tags, settings };
}

/** A new tag rule, guessing a name from the connection's ("Line 1 gateway" → line_1_gateway.value) */
export function newTagRule(d: ConnectionDraft): TagRule {
  const prefix = d.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "tag";
  const safe = /^[a-z_]/.test(prefix) ? prefix : `_${prefix}`;
  return { tag: `${safe}.value_${d.tags.length + 1}`, value: "message.", type: "number" };
}
