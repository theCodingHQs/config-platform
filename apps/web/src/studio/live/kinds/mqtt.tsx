import React from "react";
import { Radio } from "lucide-react";
import type { KindUi } from "./kind-types";
import { MqttFields, type MqttDraft } from "./MqttFields";
import { lines, optional } from "./shared";

export const mqttKind: KindUi<MqttDraft> = {
  label: "MQTT broker",
  hint: "A broker your machines and gateways publish to (Mosquitto, HiveMQ, EMQX, AWS IoT…).",
  icon: <Radio size="1.4em" />,
  topics: true,
  empty: () => ({ url: "", username: "", password: "", hasPassword: false, clientId: "", topics: "", qos: 0, format: "json" }),
  fromSaved: (s) => ({
    url: s.url ?? "",
    username: s.username ?? "",
    password: "",
    hasPassword: Boolean(s.hasPassword),
    clientId: s.clientId ?? "",
    topics: (s.topics ?? []).join("\n"),
    qos: s.qos ?? 0,
    format: s.format ?? "json",
  }),
  toInput: (d) => ({
    url: d.url.trim(),
    username: d.username.trim(),
    ...(d.password ? { password: d.password } : {}),
    clientId: optional(d.clientId),
    topics: lines(d.topics),
    qos: d.qos,
    format: d.format,
  }),
  Fields: MqttFields,
};
