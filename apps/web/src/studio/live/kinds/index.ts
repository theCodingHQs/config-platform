/** Every connection kind's screen pieces. A new kind = its file + one line here. */
import type { LiveConnectionKind } from "@config-platform/schema";
import type { KindUi } from "./kind-types";
import { websocketKind } from "./websocket";
import { mqttKind } from "./mqtt";
import { opcuaKind } from "./opcua";
import { modbusKind } from "./modbus";
import { httpPushKind } from "./http-push";
import { httpPollKind } from "./http-poll";
import { simulatorKind } from "./simulator";

export const KIND_UI: Record<LiveConnectionKind, KindUi<any>> = {
  websocket: websocketKind,
  mqtt: mqttKind,
  opcua: opcuaKind,
  modbus: modbusKind,
  "http-push": httpPushKind,
  "http-poll": httpPollKind,
  simulator: simulatorKind,
};

export type { KindUi, KindFieldsProps } from "./kind-types";
