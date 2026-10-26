/**
 * Connections Showcase: every way live data can reach the app, each feeding one machine, with
 * what it is typically used for, how this demo wires it, the tag rule trick it needs, and its
 * connection state and values live. Then the two ways live data turns into app data: rules that
 * write records, and records that refresh every open screen.
 */
import { SOURCE_LABELS, type DemoMachine, type SourceKind } from '../../catalog.js';
import { PORTS } from '../../demo-config.js';
import { fieldId } from '../entities.js';
import { card, column, grid, header, liveBadge, metric, row, shown, stack, stat, statusColor, statusText, tag, text, type Node } from './blocks.js';
import type { PageContext, PageSpec } from './context.js';

interface KindStory {
  usedFor: string;
  wiring: (m: DemoMachine) => string;
  rule: (m: DemoMachine) => string;
}

const STORIES: Record<SourceKind, KindStory> = {
  opcua: {
    usedFor: 'Modern PLCs, CNC controls and SCADA servers. Values are pushed to us as they change.',
    wiring: () => `The app connects to opc.tcp://…:${PORTS.opcua}/demo and watches five nodes.`,
    rule: (m) => `machines.${m.code}.speed ← message.speed   (node ns=1;s=${m.code}.Speed)`,
  },
  'agent-modbus': {
    usedFor: 'Machines on a factory network the cloud cannot reach. A small agent inside the network reads them and connects out to the app: no open ports, no VPN.',
    wiring: () => `The edge agent reads the Modbus device on port ${PORTS.modbus} (registers 100–106) and forwards the values.`,
    rule: (m) => `machines.${m.code}.status ← message.status_code == 1 ? "running" : …`,
  },
  modbus: {
    usedFor: 'Older PLCs, power meters and drives. Registers are read on a timer.',
    wiring: () => `The app reads holding registers 0–6 of unit 1 on port ${PORTS.modbus} every second: status code, speed ×10, a 32-bit counter, temperature ×10, power as a float.`,
    rule: (m) => `machines.${m.code}.status ← message.status_code == 1 ? "running" : … (a number becomes a word)`,
  },
  mqtt: {
    usedFor: 'IoT gateways, sensors and Node-RED. Devices publish to topics on a broker; the app subscribes.',
    wiring: (m) => `The app subscribes to plant/+/${m.code}/# on the broker at port ${PORTS.mqtt} (user name and password).`,
    rule: (m) => `machines.${m.code}.status ← message.state   only on topic plant/+/${m.code}/status`,
  },
  websocket: {
    usedFor: 'Machine gateways and systems that stream JSON over a WebSocket.',
    wiring: (m) => `The app opens ws://…:${PORTS.websocket} with a token, sends {"subscribe":["${m.code}"]} and listens.`,
    rule: (m) => `machines.${m.code}.speed ← message.data.speed   when message.machine == "${m.code}"`,
  },
  'http-poll': {
    usedFor: 'MES, ERP and vendor web APIs. The app asks for the latest values every few seconds.',
    wiring: (m) => `The app calls GET http://…:${PORTS.http}/api/machines/${m.code} with an API key every 2 seconds.`,
    rule: (m) => `machines.${m.code}.speed ← message.metrics.speed   (values can be nested anywhere)`,
  },
  'http-push': {
    usedFor: 'Devices, scripts and other systems that can send an HTTP request when something happens.',
    wiring: () => 'The device POSTs JSON to this connection’s own address with its token every 2 seconds. Nothing connects out.',
    rule: (m) => `machines.${m.code}.count ← message.count`,
  },
  simulator: {
    usedFor: 'Trying pages and visuals, or demos before machines are connected. No hardware needed.',
    wiring: () => 'The app makes the values up itself: status in a cycle, speed and power as a random walk, a counter.',
    rule: (m) => `machines.${m.code}.speed ← message.status == "running" ? message.speed : 0`,
  },
};

function kindCard(m: DemoMachine, connectionId: string | undefined): Node {
  const id = `k_${m.code}`;
  const story = STORIES[m.source];
  const conn = `liveInfo.connections['${connectionId ?? 'none'}']`;
  return card(id, SOURCE_LABELS[m.source], [
    text(`${id}_used`, story.usedFor, 'body'),
    text(`${id}_wiring`, story.wiring(m), 'caption', { color: 'muted' }),
    stack(`${id}_rule_box`, { direction: 'vertical', gap: 2, padding: 8, background: 'surface-subtle', borderRadius: 6 }, [
      text(`${id}_rule_l`, 'Tag rule', 'caption', { color: 'muted', weight: 'semibold' }),
      text(`${id}_rule`, story.rule(m), 'caption'),
    ]),
    row(`${id}_conn`, [
      text(`${id}_state`, `{{ ${conn} ? 'Connection: ' + ${conn}.state : 'Connection: unknown' }}`, 'caption', {
        weight: 'semibold',
        color: `{{ ${conn} && ${conn}.state == 'connected' ? 'success' : ${conn} && ${conn}.state == 'error' ? 'danger' : 'muted' }}`,
      }),
      text(`${id}_msgs`, `{{ ${conn} ? ${conn}.messagesReceived + ' messages' : '' }}`, 'caption', { color: 'muted' }),
      text(`${id}_err`, `{{ ${conn} && ${conn}.error ? ${conn}.error : '' }}`, 'caption', { color: 'danger' }),
    ]),
    grid(`${id}_vals`, 3, [
      metric(`${id}_status`, 'Status', statusText(m.code), { color: statusColor(m.code) }),
      metric(`${id}_speed`, 'Speed', shown(tag(m.code, 'speed'))),
      metric(`${id}_count`, 'Parts', shown(tag(m.code, 'count'))),
    ], { gap: 12, responsiveCollapse: false }),
  ], { subtitle: `${m.name} · machines.${m.code}.*`, headerIcon: 'Plug' });
}

export function connectionsShowcasePage(ctx: PageContext): PageSpec {
  const D = (n: string) => fieldId(ctx.downtime, n);
  return {
    name: 'Connections Showcase',
    route: '/machine-monitoring/connections',
    icon: 'Network',
    draft: {
      schemaVersion: 2,
      id: 'pg_connections_showcase',
      version: 1,
      route: '/machine-monitoring/connections',
      state: {},
      dataSources: [{ id: 'ds_downtime', entityId: ctx.downtime.id, sort: { fieldId: D('started_at'), order: 'desc' }, limit: 5 }],
      root: stack('root', { direction: 'vertical', gap: 24, padding: 24 }, [
        header('cs', 'Every way to bring live data in', 'Each machine below is fed by a different kind of connection. Every one turns its own messages into the same tags (machines.<code>.status, .speed, .temperature, .count, .power), so pages, visuals and rules never care where data comes from.', [liveBadge('cs_live')]),

        grid('cs_kinds', 2, ctx.machines.map((m) => kindCard(m, ctx.connectionIds[m.code])), { minColWidth: 360 }),

        text('cs_into_app', 'Live data and your own records', 'h2'),
        grid('cs_app', 2, [
          card('cs_rules', 'Live rules write records', [
            text('cs_rules_t', 'Three rules per machine watch its status tag: one copies the status into the machine register, one opens a downtime record when the machine alarms or stops, one closes it when it runs again.', 'body'),
            { id: 'cs_down_table', type: 'table', props: { source: 'ds_downtime', columns: ['machine_code', 'reason', 'started_at', 'ended_at'].map((n) => ({ fieldId: D(n) })), pageSize: 5, compact: true, emptyMessage: 'Waiting for the first alarm or stop…' } },
          ], { headerIcon: 'Workflow' }),
          card('cs_records', 'Changes in the app reach every screen', [
            text('cs_records_t', 'When anyone adds a machine, edits its configuration, or a rule updates it, every open page that shows machines reloads that data by itself. Try it: add a machine on Plant Overview in another window and watch these numbers.', 'body'),
            grid('cs_records_stats', 2, [
              stat('cs_total', 'Total machines', ctx.machine.id, { icon: 'Factory' }),
              stat('cs_running', 'Running (from rules)', ctx.machine.id, { filter: { status: 'running' }, icon: 'Activity', color: 'success' }),
            ], { responsiveCollapse: false }),
          ], { headerIcon: 'RefreshCw' }),
        ]),

        column('cs_footer', [
          text('cs_footer_t', 'To run this demo on your computer: pnpm --filter @config-platform/demo-sources start (it plays every machine, broker and server shown above).', 'caption', { color: 'muted' }),
        ]),
      ]),
    },
  };
}
