/**
 * Plant Overview: the whole plant at a glance. Two kinds of live data side by side:
 *   from machines  status, speed, parts, power of each machine (live tags)
 *   from the app   machine count, how many are running, downtime (records, which reload on every
 *                  open screen the moment anyone, or a live rule, changes them)
 */
import { SOURCE_LABELS } from '../../catalog.js';
import { fieldId } from '../entities.js';
import { card, countWhere, grid, header, liveBadge, metric, row, shown, stack, stat, statusColor, statusText, sumOver, tag, text, type Node } from './blocks.js';
import type { PageContext, PageSpec } from './context.js';
import { machineModals, openEdit } from './machine-forms.js';

function machineCard(code: string, name: string, subtitle: string): Node {
  const id = `mc_${code}`;
  return card(id, name, [
    row(`${id}_top`, [
      text(`${id}_status`, statusText(code), 'h3', { color: statusColor(code), weight: 'bold' }),
      text(`${id}_stale`, '⚠ no recent data', 'caption', { color: 'warning' }),
    ], { justify: 'space-between' }),
    grid(`${id}_metrics`, 2, [
      metric(`${id}_speed`, 'Speed (parts/min)', shown(tag(code, 'speed'))),
      metric(`${id}_count`, 'Parts made', shown(tag(code, 'count'))),
      metric(`${id}_temp`, 'Temperature (°C)', shown(tag(code, 'temperature'))),
      metric(`${id}_power`, 'Power (kW)', shown(tag(code, 'power'))),
    ], { gap: 12, responsiveCollapse: false }),
  ], { subtitle, headerIcon: 'Cog' });
}

export function plantOverviewPage(ctx: PageContext): PageSpec {
  const M = (n: string) => fieldId(ctx.machine, n);
  const D = (n: string) => fieldId(ctx.downtime, n);
  const codes = ctx.machines.map((m) => m.code);

  const cards = ctx.machines.map((m) => {
    const c = machineCard(m.code, m.name, `${m.line} · ${SOURCE_LABELS[m.source]}`);
    // The warning shows when readings stop arriving (speed streams; status may only be sent on change)
    c.children![0].children![1].visibleIf = `{{ liveInfo.tags['machines.${m.code}.speed'] && liveInfo.tags['machines.${m.code}.speed'].quality != 'good' }}`;
    return c;
  });

  return {
    name: 'Plant Overview',
    route: '/machine-monitoring/overview',
    icon: 'Factory',
    draft: {
      schemaVersion: 2,
      id: 'pg_plant_overview',
      version: 1,
      route: '/machine-monitoring/overview',
      state: { createOpen: false, editOpen: false, editId: '' },
      dataSources: [
        { id: 'ds_machines', entityId: ctx.machine.id, sort: { fieldId: M('code'), order: 'asc' }, limit: 10 },
        { id: 'ds_downtime', entityId: ctx.downtime.id, sort: { fieldId: D('started_at'), order: 'desc' }, limit: 10 },
      ],
      root: stack('root', { direction: 'vertical', gap: 24, padding: 24 }, [
        header('ov', 'Plant Overview', 'Machine values arrive live from each machine. Totals come from the machine register and update on every open screen the moment a machine is added or changed.', [
          liveBadge('ov_live'),
          { id: 'ov_add', type: 'button', props: { label: 'Add machine', icon: 'Plus', variant: 'primary', onClick: [{ type: 'openModal', params: { modalKey: 'createOpen' } }] } },
        ]),

        text('kpi_from_app', 'From the machine register', 'caption', { color: 'muted', weight: 'semibold' }),
        grid('kpis_app', 4, [
          stat('kpi_total', 'Total machines', ctx.machine.id, { icon: 'Factory' }),
          stat('kpi_running', 'Running', ctx.machine.id, { filter: { status: 'running' }, icon: 'Activity', color: 'success' }),
          stat('kpi_alarm', 'In alarm', ctx.machine.id, { filter: { status: 'alarm' }, icon: 'AlertTriangle', color: 'danger' }),
          stat('kpi_down', 'Open downtime', ctx.downtime.id, { filter: { ended_at: { isNull: true } }, icon: 'TimerOff', color: 'warning' }),
        ]),

        text('kpi_from_machines', 'From the machines, right now', 'caption', { color: 'muted', weight: 'semibold' }),
        grid('kpis_live', 4, [
          card('lk_parts', 'Parts made', [text('lk_parts_v', `{{ round(${sumOver(codes, 'count')}) + '' }}`, 'h2')], { headerIcon: 'Package' }),
          card('lk_rate', 'Output rate', [text('lk_rate_v', `{{ round((${sumOver(codes, 'speed')}) * 60) + ' parts/h' }}`, 'h2')], { headerIcon: 'Gauge' }),
          card('lk_power', 'Power draw', [text('lk_power_v', `{{ round(${sumOver(codes, 'power')}, 1) + ' kW' }}`, 'h2')], { headerIcon: 'Zap' }),
          card('lk_running', 'Running now', [text('lk_running_v', `{{ (${countWhere(codes, 'status', 'running')}) + ' of ${codes.length}' }}`, 'h2')], { headerIcon: 'Activity' }),
        ]),

        grid('machine_cards', 4, cards, { minColWidth: 240 }),

        grid('charts', 2, [
          card('ch_status', 'Machines by status', [
            { id: 'ch_status_chart', type: 'chart', props: { source: 'ds_machines', type: 'bar', groupByFieldId: M('status'), aggregateOp: 'count' } },
          ], { headerIcon: 'BarChart3', subtitle: 'Kept up to date by live rules' }),
          card('ch_down', 'Downtime events by machine', [
            { id: 'ch_down_chart', type: 'chart', props: { source: 'ds_downtime', type: 'bar', groupByFieldId: D('machine_code'), aggregateOp: 'count' } },
          ], { headerIcon: 'TimerOff', subtitle: 'Logged by live rules when a machine stops or alarms' }),
        ]),

        card('register', 'Machine register', [
          text('register_hint', 'Click a machine to change its configuration (targets, shifts, limits). Other screens see the change at once.', 'caption'),
          {
            id: 'register_table',
            type: 'table',
            props: {
              source: 'ds_machines',
              columns: ['code', 'name', 'line', 'status', 'status_since', 'data_source', 'hourly_target', 'daily_target'].map((n) => ({ fieldId: M(n) })),
              pageSize: 10,
              striped: true,
              emptyMessage: 'No machines yet.',
              onRowClick: openEdit,
            },
          },
        ], { headerIcon: 'ClipboardList' }),

        card('recent_down', 'Recent downtime', [
          {
            id: 'down_table',
            type: 'table',
            props: {
              source: 'ds_downtime',
              columns: ['machine_code', 'reason', 'started_at', 'ended_at'].map((n) => ({ fieldId: D(n) })),
              pageSize: 10,
              compact: true,
              emptyMessage: 'No downtime logged yet. It appears here when a machine alarms or stops.',
            },
          },
        ], { headerIcon: 'History' }),

        ...machineModals('ov', ctx),
      ]),
    },
  };
}

