/**
 * Machine Detail: one machine's configuration (a record) next to what it is doing right now (live
 * tags), compared: output rate against its hourly target, temperature against its limit. The
 * machine is picked at run time, so tags are read as live.machines[state.code].speed.
 */
import { SOURCE_LABELS } from '../../catalog.js';
import { fieldId } from '../entities.js';
import { card, column, grid, header, liveBadge, shown, stack, statusColor, statusText, tag, text } from './blocks.js';
import type { PageContext, PageSpec } from './context.js';
import { machineModals } from './machine-forms.js';

const CODE = 'state.code';
const REC = 'ds.ds_machine[0]';

export function machineDetailPage(ctx: PageContext): PageSpec {
  const M = (n: string) => fieldId(ctx.machine, n);
  const D = (n: string) => fieldId(ctx.downtime, n);
  const speed = tag(CODE, 'speed');
  const temp = tag(CODE, 'temperature');
  const rate = `${speed} * 60`;

  return {
    name: 'Machine Detail',
    route: '/machine-monitoring/machine',
    icon: 'Cog',
    draft: {
      schemaVersion: 2,
      id: 'pg_machine_detail',
      version: 1,
      route: '/machine-monitoring/machine',
      state: { code: ctx.machines[0].code, createOpen: false, editOpen: false, editId: '' },
      dataSources: [
        { id: 'ds_machine', entityId: ctx.machine.id, filter: { code: '{{ state.code }}' }, limit: 1 },
        { id: 'ds_down', entityId: ctx.downtime.id, filter: { machine_code: '{{ state.code }}' }, sort: { fieldId: D('started_at'), order: 'desc' }, limit: 10 },
      ],
      root: stack('root', { direction: 'vertical', gap: 24, padding: 24 }, [
        header('md', "{{ ds.ds_machine[0] ? ds.ds_machine[0].name : 'Machine' }}", 'Its configuration from the machine register, and what it is doing right now.', [
          liveBadge('md_live'),
          {
            id: 'md_pick',
            type: 'select',
            props: { valueKey: 'code', clearable: false, width: '260px', options: ctx.machines.map((m) => ({ label: `${m.name} (${SOURCE_LABELS[m.source]})`, value: m.code })) },
          },
          {
            id: 'md_edit',
            type: 'button',
            props: {
              label: 'Edit configuration',
              icon: 'Settings',
              variant: 'secondary',
              onClick: [
                { type: 'setState', params: { key: 'editId', value: `{{ ${REC} ? ${REC}.id : '' }}` } },
                { type: 'openModal', params: { modalKey: 'editOpen' } },
              ],
            },
          },
        ]),

        grid('md_live_grid', 4, [
          card('md_status', 'Status', [text('md_status_v', statusText(CODE), 'h2', { color: statusColor(CODE), weight: 'bold' })], { headerIcon: 'Activity' }),
          card('md_rate', 'Output rate', [
            text('md_rate_v', `{{ ${speed} == null ? '—' : round(${rate}) + ' parts/h' }}`, 'h2'),
            // speed × 60 = parts/h; × 100 for a percentage (kept flat: expressions can nest 10 deep)
            text('md_rate_t', `{{ ${REC} && ${REC}.hourly_target && ${speed} != null ? concat(round(${speed} * 6000 / ${REC}.hourly_target), ' % of the ', ${REC}.hourly_target, ' parts/h target') : 'No hourly target set' }}`, 'caption', {
              color: `{{ ${REC} && ${speed} != null && ${rate} >= ${REC}.hourly_target * 0.9 ? 'success' : 'warning' }}`,
            }),
          ], { headerIcon: 'Gauge' }),
          card('md_temp', 'Temperature', [
            text('md_temp_v', shown(temp, '°C'), 'h2'),
            text('md_temp_t', `{{ ${REC} && ${REC}.max_temperature ? 'Limit ' + ${REC}.max_temperature + ' °C' : 'No limit set' }}`, 'caption', {
              color: `{{ ${REC} && ${temp} > ${REC}.max_temperature ? 'danger' : 'muted' }}`,
            }),
          ], { headerIcon: 'Thermometer' }),
          card('md_parts', 'Parts made', [
            text('md_parts_v', shown(tag(CODE, 'count')), 'h2'),
            text('md_power', `{{ ${tag(CODE, 'power')} == null ? '' : 'Drawing ' + ${tag(CODE, 'power')} + ' kW' }}`, 'caption', { color: 'muted' }),
          ], { headerIcon: 'Package' }),
        ]),

        grid('md_lower', 2, [
          card('md_view', 'Live view', [
            { id: 'md_visual', type: 'visual', props: { visualId: ctx.visuals.machineView, height: 380 } },
          ], { headerIcon: 'Map', subtitle: 'The same Machine symbol as on the plant floor, following the machine picked above' }),
          card('md_config', 'Configuration', [
            {
              id: 'md_details',
              type: 'details',
              props: { source: 'ds_machine', columns: 2, fields: ['code', 'machine_type', 'line', 'work_center', 'data_source', 'hourly_target', 'shift_hours', 'shifts_per_day', 'daily_target', 'max_temperature', 'manufacturer', 'model', 'installed_on', 'status_since'].map((n) => ({ fieldId: M(n) })) },
            },
          ], { headerIcon: 'Settings' }),
        ]),

        grid('md_history_row', 1, [
          card('md_history', 'Downtime history', [
            {
              id: 'md_down_table',
              type: 'table',
              props: { source: 'ds_down', columns: ['reason', 'started_at', 'ended_at'].map((n) => ({ fieldId: D(n) })), pageSize: 10, compact: true, emptyMessage: 'No downtime logged for this machine.' },
            },
          ], { headerIcon: 'History' }),
        ]),

        column('md_tags', [
          text('md_tags_t', 'Live tags of this machine', 'caption', { color: 'muted', weight: 'semibold' }),
          text('md_tags_v', '{{ "machines." + state.code + ".status · .speed · .temperature · .count · .power" }}', 'caption', { color: 'muted' }),
        ], 4),

        ...machineModals('md', ctx),
      ]),
    },
  };
}

