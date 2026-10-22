/**
 * Seed Production Pages Script.
 *
 * Builds the app pages for the Production Target Tracker data created by seed-production-tracker:
 *   - Production Dashboard   KPI cards, attainment charts, machines behind plan, export report
 *   - Machines               searchable/filterable CRUD list with status KPIs and CSV export
 *   - Production Sheets      monthly sheets with day-by-day checkbox editing and export report
 *   - Machine Performance    master/detail: machine profile, monthly trend charts and history
 *
 * Also extends the two entities so pages can aggregate without summing 31 columns client-side:
 *   machine:           status (Running/Maintenance/Idle), line, daily_capacity, commissioned_on
 *   production_sheet:  machine_name, work_center, days_met, gap_days, attainment_pct (derived) + notes
 * The derived sheet fields are kept current by a Postgres trigger on the tenant table, so they stay
 * correct whether a sheet is edited in a page form, imported, or written through the API.
 *
 * Idempotent: existing fields are kept, existing pages (matched by route) are updated in place and
 * republished.
 *
 * Usage: pnpm --filter api seed:production-pages -- --email admin@example.com [--tenant <id>]
 */

import { pool } from '../db/pool.js';
import { calculatedFieldsService } from '../records/calculated-fields-service.js';
import { initializeMetadataCatalog } from '../db/catalog-init.js';
import { migrationService } from '../migrations/migration-service.js';
import { recordsService } from '../records/records-service.js';
import { entityCache } from '../records/entity-cache.js';
import { defaultStorageAdapter } from '../db/storage-adapter.js';
import { pagesService } from '../pages/pages-service.js';
import { productionDayField } from '@config-platform/schema';

const TEMPLATE_NAME = 'Production Target Tracker';
const FOLDER_NAME = 'Production';

const MACHINE_DETAILS: Record<string, { status: string; line: string; capacity: number; commissioned: string }> = {
  'CNC Mill 01': { status: 'Running', line: 'Line 1', capacity: 420, commissioned: '2019-03-12' },
  'CNC Mill 02': { status: 'Running', line: 'Line 1', capacity: 400, commissioned: '2021-07-05' },
  'Lathe L-03': { status: 'Running', line: 'Line 1', capacity: 360, commissioned: '2018-11-20' },
  'Press P-04': { status: 'Maintenance', line: 'Line 2', capacity: 1200, commissioned: '2016-02-14' },
  'Injection Mold M-05': { status: 'Running', line: 'Line 2', capacity: 2400, commissioned: '2022-01-10' },
  'Welding Cell W-06': { status: 'Idle', line: 'Line 3', capacity: 180, commissioned: '2017-09-01' },
  'Paint Line PL-07': { status: 'Running', line: 'Line 3', capacity: 650, commissioned: '2020-05-18' },
  'Assembly A-08': { status: 'Running', line: 'Line 3', capacity: 300, commissioned: '2023-04-03' },
};

type FieldSpec = { name: string; label: string; type: string; config?: Record<string, any> };

const MACHINE_EXTRA_FIELDS: FieldSpec[] = [
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    config: {
      options: [
        { label: 'Running', value: 'Running', color: 'success' },
        { label: 'Maintenance', value: 'Maintenance', color: 'warning' },
        { label: 'Idle', value: 'Idle', color: 'neutral' },
      ],
    },
  },
  { name: 'line', label: 'Production Line', type: 'text' },
  { name: 'daily_capacity', label: 'Daily Capacity (units)', type: 'number', config: { precision: 8, scale: 0 } },
  { name: 'commissioned_on', label: 'Commissioned On', type: 'date' },
];

/** Calculated sheet fields: looked up from the machine, or totals of the day checkboxes. */
const SHEET_FORMULAS: Record<string, string> = {
  machine_name: 'machine.name',
  work_center: 'machine.work_center',
  days_met: 'countTrue(range("day_01", "day_31"))',
  gap_days: 'max(planned_days - days_met, 0)',
  attainment_pct: 'if(planned_days > 0, round(days_met * 100 / planned_days, 1), 0)',
};

const SHEET_EXTRA_FIELDS: FieldSpec[] = [
  { name: 'machine_name', label: 'Machine Name', type: 'text', config: { formula: SHEET_FORMULAS.machine_name } },
  { name: 'work_center', label: 'Work Center', type: 'text', config: { formula: SHEET_FORMULAS.work_center } },
  { name: 'days_met', label: 'Days on Target', type: 'number', config: { precision: 4, scale: 0, formula: SHEET_FORMULAS.days_met } },
  { name: 'gap_days', label: 'Gap (days)', type: 'number', config: { precision: 4, scale: 0, formula: SHEET_FORMULAS.gap_days } },
  { name: 'attainment_pct', label: 'Attainment %', type: 'number', config: { precision: 5, scale: 1, formula: SHEET_FORMULAS.attainment_pct } },
  { name: 'notes', label: 'Notes', type: 'text' },
];

async function entityByName(tenantId: string, name: string) {
  const res = await pool.query(`SELECT id FROM public.entity_def WHERE tenant_id = $1 AND name = $2`, [tenantId, name]);
  if (!res.rows[0]) return null;
  entityCache.invalidate(tenantId);
  return entityCache.resolveEntity(tenantId, res.rows[0].id);
}

async function entityVersion(tenantId: string, entityId: string): Promise<number> {
  const res = await pool.query(`SELECT version FROM public.entity_def WHERE tenant_id = $1 AND id = $2`, [tenantId, entityId]);
  return res.rows[0].version;
}

async function ensureFields(tenantId: string, entity: any, specs: FieldSpec[]): Promise<number> {
  let added = 0;
  for (const spec of specs) {
    if (entity.fields.some((f: any) => f.name === spec.name)) continue;
    await migrationService.addField(tenantId, {
      entityId: entity.entity.id,
      expectedVersion: await entityVersion(tenantId, entity.entity.id),
      name: spec.name,
      label: spec.label,
      type: spec.type as any,
      required: false,
      unique: false,
      config: spec.config || {},
    });
    added++;
  }
  return added;
}

async function ensureEntityPresentation(tenantId: string, entity: any, icon: string, displayFieldName?: string) {
  const displayFieldId = displayFieldName ? entity.fields.find((f: any) => f.name === displayFieldName)?.id : undefined;
  const needsIcon = entity.entity.icon !== icon;
  const needsDisplay = displayFieldId && entity.entity.displayFieldId !== displayFieldId;
  if (!needsIcon && !needsDisplay) return;
  await migrationService.updateEntity(tenantId, {
    entityId: entity.entity.id,
    expectedVersion: await entityVersion(tenantId, entity.entity.id),
    icon: icon as any,
    ...(needsDisplay ? { displayFieldId } : {}),
  });
}

/**
 * Production sheet totals and machine details as calculated fields (formulas the platform keeps
 * up to date), and "one sheet per machine per month" as a duplicate rule. Older installs used
 * hand-written database triggers for this; those are removed so values aren't computed twice.
 * Returns how many sheets were recalculated.
 */
async function setupCalculatedSheetFields(tenantId: string, sheet: any): Promise<number> {
  const schema = defaultStorageAdapter.getTenantSchemaName(tenantId);
  await pool.query(`
    DROP TRIGGER IF EXISTS trg_production_sheet_derive ON "${schema}"."${sheet.entity.physicalTableName}";
    DROP FUNCTION IF EXISTS "${schema}".production_sheet_derive();
  `);
  const machineEntity = (sheet.fields.find((f: any) => f.name === 'machine')?.config as any)?.targetEntityId;
  if (machineEntity) {
    const machine = await entityCache.resolveEntity(tenantId, machineEntity);
    await pool.query(`
      DROP TRIGGER IF EXISTS trg_machine_propagate_to_sheets ON "${schema}"."${machine.entity.physicalTableName}";
      DROP FUNCTION IF EXISTS "${schema}".machine_propagate_to_sheets();
    `);
  }

  // Existing installs: turn the derived fields into calculated ones (each change recalculates)
  for (const [name, formula] of Object.entries(SHEET_FORMULAS)) {
    const field = sheet.fields.find((f: any) => f.name === name);
    if (!field || (field.config as any)?.formula === formula) continue;
    await migrationService.updateField(tenantId, {
      entityId: sheet.entity.id,
      fieldId: field.id,
      expectedVersion: await entityVersion(tenantId, sheet.entity.id),
      config: { ...(field.config || {}), formula },
    });
  }
  const recalculated = await calculatedFieldsService.recalculate(tenantId, sheet.entity.id);

  // One sheet per machine per month
  const current = await entityByName(tenantId, 'production_sheet');
  const machineField = current!.fields.find((f: any) => f.name === 'machine');
  const monthField = current!.fields.find((f: any) => f.name === 'month');
  const rules = ((current!.entity as any).uniqueRules || []) as Array<{ id: string; fields: string[] }>;
  const hasRule = rules.some((r) => r.fields.length === 2 && r.fields.includes(machineField!.id) && r.fields.includes(monthField!.id));
  if (machineField && monthField && !hasRule) {
    try {
      await migrationService.setUniqueRules(tenantId, {
        entityId: current!.entity.id,
        expectedVersion: await entityVersion(tenantId, current!.entity.id),
        rules: [...rules, { fields: [machineField.id, monthField.id] }],
      });
    } catch (err: any) {
      // Existing duplicate sheets: report them, keep going (the rule can be added once fixed)
      console.warn(`  ! one-sheet-per-machine-per-month not enforced yet: ${err.message}`);
    }
  }
  return recalculated;
}

function monthOptions(today: Date, count = 12) {
  const opts: Array<{ label: string; value: string }> = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    opts.push({ label: d.toLocaleString('en-US', { month: 'long', year: 'numeric' }), value });
  }
  return opts;
}

interface PageContext {
  machine: any;
  sheet: any;
  templateId: string | null;
  currentMonth: string;
  months: Array<{ label: string; value: string }>;
}

// ─── Page building blocks ─────────────────────────────────────────────────────

const text = (id: string, value: string, variant = 'body', extra: Record<string, any> = {}) => ({
  id,
  type: 'text',
  props: { value, variant, ...extra },
});

const stack = (id: string, props: Record<string, any>, children: any[]) => ({ id, type: 'stack', props, children });
const grid = (id: string, columns: number, children: any[], extra: Record<string, any> = {}) => ({
  id,
  type: 'grid',
  props: { columns, gap: 16, responsiveCollapse: true, ...extra },
  children,
});
const card = (id: string, title: string, children: any[], extra: Record<string, any> = {}) => ({
  id,
  type: 'card',
  props: { title, variant: 'bordered', padding: 'md', ...extra },
  children,
});

const header = (id: string, title: string, subtitle: string, actions: any[]) =>
  stack(`${id}_header`, { direction: 'horizontal', justify: 'space-between', align: 'end', gap: 16, wrap: true }, [
    stack(`${id}_titles`, { direction: 'vertical', gap: 4 }, [
      text(`${id}_title`, title, 'h1'),
      text(`${id}_subtitle`, subtitle, 'muted'),
    ]),
    stack(`${id}_actions`, { direction: 'horizontal', gap: 12, align: 'end', wrap: true }, actions),
  ]);

const monthSelect = (id: string, ctx: PageContext) => ({
  id,
  type: 'select',
  props: { valueKey: 'month', options: ctx.months, placeholder: 'Month', clearable: false, width: '200px' },
});

const exportReport = (id: string, ctx: PageContext, label = 'Export report') =>
  ctx.templateId
    ? {
        id,
        type: 'exportButton',
        props: {
          label,
          template: ctx.templateId,
          format: 'xlsx',
          parameters: { month: '{{ state.month }}' },
          variant: 'primary',
          icon: 'FileSpreadsheet',
        },
      }
    : text(id, 'Export template not found', 'muted');

const csvButton = (id: string, source: string, filename: string) => ({
  id,
  type: 'button',
  props: {
    label: 'Export CSV',
    variant: 'secondary',
    icon: 'Download',
    onClick: [{ type: 'exportCsv', params: { source, filename } }],
  },
});

const toast = (message: string) => ({ type: 'showToast', params: { message, variant: 'success' } });
const closeModal = (modalKey: string) => ({ type: 'closeModal', params: { modalKey } });
const refetch = (source: string) => ({ type: 'refetch', params: { source } });

function sheetFormFields(ctx: PageContext, mode: 'create' | 'edit') {
  const S = (n: string) => ctx.sheet.fields.find((f: any) => f.name === n).id;
  return [
    { fieldId: S('machine') },
    { fieldId: S('month'), helpText: 'Use the first day of the month, e.g. 2026-10-01.' },
    { fieldId: S('planned_days') },
    ...Array.from({ length: 31 }, (_, d) => ({ fieldId: S(productionDayField(d + 1)), label: `Day ${d + 1} on target` })),
    { fieldId: S('notes') },
    ...(mode === 'edit'
      ? [
          { fieldId: S('days_met'), readOnly: true, helpText: 'Calculated from the ticked days.' },
          { fieldId: S('gap_days'), readOnly: true },
          { fieldId: S('attainment_pct'), readOnly: true },
        ]
      : []),
  ];
}

function sheetEditModal(prefix: string, ctx: PageContext, sources: string[]) {
  return {
    id: `${prefix}_edit_modal`,
    type: 'modal',
    props: {
      title: 'Production sheet',
      subtitle: 'Tick each day the machine met its production target. Totals recalculate on save.',
      icon: 'ClipboardCheck',
      entityId: ctx.sheet.entity.id,
      openStateKey: 'editOpen',
      size: 'xl',
    },
    children: [
      {
        id: `${prefix}_edit_form`,
        type: 'form',
        props: {
          mode: 'edit',
          entityId: ctx.sheet.entity.id,
          recordId: '{{ state.editId }}',
          showHeader: false,
          showCancel: true,
          submitLabel: 'Save sheet',
          fields: sheetFormFields(ctx, 'edit'),
          onCancel: [closeModal('editOpen')],
          onSuccess: [closeModal('editOpen'), ...sources.map(refetch), toast('Production sheet saved')],
        },
      },
    ],
  };
}

// ─── Pages ────────────────────────────────────────────────────────────────────

function dashboardPage(ctx: PageContext) {
  const S = (n: string) => ctx.sheet.fields.find((f: any) => f.name === n).id;
  const sheetId = ctx.sheet.entity.id;
  const monthFilter = { month: '{{ state.month }}' };
  const stat = (id: string, label: string, entityId: string, op: string, field: string | undefined, extra: Record<string, any>) => ({
    id,
    type: 'stat',
    props: { label, entityId, op, ...(field ? { fieldId: field } : {}), ...extra },
  });
  return {
    name: 'Production Dashboard',
    route: '/production/dashboard',
    draft: {
      schemaVersion: 2,
      id: 'pg_production_dashboard',
      version: 1,
      route: '/production/dashboard',
      state: { month: ctx.currentMonth, editOpen: false, editId: '' },
      dataSources: [
        { id: 'ds_month', entityId: sheetId, filter: monthFilter, sort: { fieldId: S('attainment_pct'), order: 'asc' }, limit: 100 },
        { id: 'ds_trend', entityId: sheetId, sort: { fieldId: S('month'), order: 'asc' }, limit: 500 },
      ],
      root: stack('root', { direction: 'vertical', gap: 24, padding: 24 }, [
        header('dash', 'Production Dashboard', 'Daily target attainment across the line for the selected month.', [
          monthSelect('dash_month', ctx),
          exportReport('dash_export', ctx),
        ]),
        grid('dash_kpis', 4, [
          stat('kpi_machines', 'Machines', ctx.machine.entity.id, 'count', undefined, { icon: 'Factory' }),
          stat('kpi_planned', 'Planned run days', sheetId, 'sum', S('planned_days'), { filter: monthFilter, icon: 'CalendarDays' }),
          stat('kpi_met', 'Days on target', sheetId, 'sum', S('days_met'), { filter: monthFilter, icon: 'Target', color: 'success' }),
          stat('kpi_attainment', 'Avg attainment', sheetId, 'avg', S('attainment_pct'), { filter: monthFilter, suffix: '%', icon: 'Gauge' }),
        ]),
        grid('dash_charts_1', 2, [
          card('card_met_by_machine', 'Days on target by machine', [
            { id: 'chart_met_by_machine', type: 'chart', props: { source: 'ds_month', type: 'bar', groupByFieldId: S('machine_name'), aggregateOp: 'sum', aggregateFieldId: S('days_met') } },
          ], { headerIcon: 'BarChart3' }),
          card('card_att_by_machine', 'Attainment % by machine', [
            { id: 'chart_att_by_machine', type: 'chart', props: { source: 'ds_month', type: 'bar', groupByFieldId: S('machine_name'), aggregateOp: 'avg', aggregateFieldId: S('attainment_pct') } },
          ], { headerIcon: 'Percent' }),
        ]),
        grid('dash_charts_2', 2, [
          card('card_att_by_wc', 'Attainment % by work center', [
            { id: 'chart_att_by_wc', type: 'chart', props: { source: 'ds_month', type: 'bar', groupByFieldId: S('work_center'), aggregateOp: 'avg', aggregateFieldId: S('attainment_pct') } },
          ], { headerIcon: 'Factory' }),
          card('card_trend', 'Days on target per month (all machines)', [
            { id: 'chart_trend', type: 'chart', props: { source: 'ds_trend', type: 'line', groupByFieldId: S('month'), aggregateOp: 'sum', aggregateFieldId: S('days_met') } },
          ], { headerIcon: 'TrendingUp' }),
        ]),
        card('card_behind', 'Machines furthest behind plan', [
          text('behind_hint', 'Lowest attainment first. Click a row to review or update its production sheet.', 'caption'),
          {
            id: 'behind_table',
            type: 'table',
            props: {
              source: 'ds_month',
              columns: ['machine_name', 'work_center', 'planned_days', 'days_met', 'gap_days', 'attainment_pct'].map((n) => ({ fieldId: S(n) })),
              pageSize: 8,
              striped: true,
              emptyMessage: 'No production sheets for this month yet.',
              onRowClick: [
                { type: 'setState', params: { key: 'editId', value: '{{ row.id }}' } },
                { type: 'openModal', params: { modalKey: 'editOpen' } },
              ],
            },
          },
        ], { headerIcon: 'AlertTriangle' }),
        sheetEditModal('dash', ctx, ['ds_month', 'ds_trend']),
      ]),
    },
  };
}

function machinesPage(ctx: PageContext) {
  const M = (n: string) => ctx.machine.fields.find((f: any) => f.name === n).id;
  const machineId = ctx.machine.entity.id;
  const formFields = ['name', 'work_center', 'line', 'status', 'daily_capacity', 'commissioned_on'].map((n) => ({ fieldId: M(n) }));
  const statusStat = (id: string, label: string, status: string, icon: string, color: string) => ({
    id,
    type: 'stat',
    props: { label, entityId: machineId, op: 'count', filter: { status }, icon, color },
  });
  return {
    name: 'Machines',
    route: '/production/machines',
    draft: {
      schemaVersion: 2,
      id: 'pg_production_machines',
      version: 1,
      route: '/production/machines',
      state: { search: '', status: '', createOpen: false, editOpen: false, editId: '' },
      dataSources: [
        {
          id: 'ds_machines',
          entityId: machineId,
          filter: { name: { contains: '{{ state.search }}' }, status: '{{ state.status ? state.status : null }}' },
          sort: { fieldId: M('name'), order: 'asc' },
          limit: 100,
        },
      ],
      root: stack('root', { direction: 'vertical', gap: 24, padding: 24 }, [
        header('mach', 'Machines', 'Every machine and work center on the shop floor, with its current status.', [
          csvButton('mach_csv', 'ds_machines', 'machines.csv'),
          {
            id: 'mach_new',
            type: 'button',
            props: { label: 'New machine', variant: 'primary', icon: 'Plus', onClick: [{ type: 'openModal', params: { modalKey: 'createOpen' } }] },
          },
        ]),
        grid('mach_kpis', 4, [
          { id: 'kpi_total', type: 'stat', props: { label: 'Total machines', entityId: machineId, op: 'count', icon: 'Factory' } },
          statusStat('kpi_running', 'Running', 'Running', 'Activity', 'success'),
          statusStat('kpi_maint', 'In maintenance', 'Maintenance', 'Wrench', 'warning'),
          statusStat('kpi_idle', 'Idle', 'Idle', 'CirclePause', 'default'),
        ]),
        card('mach_list', 'Machine register', [
          stack('mach_filters', { direction: 'horizontal', gap: 12, wrap: true }, [
            { id: 'mach_search', type: 'input', props: { valueKey: 'search', type: 'search', placeholder: 'Search by machine name', prefixIcon: 'Search', width: '320px' } },
            {
              id: 'mach_status',
              type: 'select',
              props: {
                valueKey: 'status',
                placeholder: 'All statuses',
                clearable: true,
                width: '200px',
                options: [
                  { label: 'Running', value: 'Running' },
                  { label: 'Maintenance', value: 'Maintenance' },
                  { label: 'Idle', value: 'Idle' },
                ],
              },
            },
          ]),
          {
            id: 'mach_table',
            type: 'table',
            props: {
              source: 'ds_machines',
              columns: formFields,
              pageSize: 10,
              striped: true,
              emptyMessage: 'No machines match these filters.',
              onRowClick: [
                { type: 'setState', params: { key: 'editId', value: '{{ row.id }}' } },
                { type: 'openModal', params: { modalKey: 'editOpen' } },
              ],
            },
          },
        ], { headerIcon: 'Cog' }),
        {
          id: 'mach_create_modal',
          type: 'modal',
          props: { title: 'New machine', icon: 'Cog', entityId: machineId, openStateKey: 'createOpen', size: 'lg' },
          children: [
            {
              id: 'mach_create_form',
              type: 'form',
              props: {
                mode: 'create',
                entityId: machineId,
                showHeader: false,
                showCancel: true,
                submitLabel: 'Create machine',
                fields: formFields,
                onCancel: [closeModal('createOpen')],
                onSuccess: [closeModal('createOpen'), refetch('ds_machines'), toast('Machine created')],
              },
            },
          ],
        },
        {
          id: 'mach_edit_modal',
          type: 'modal',
          props: { title: 'Edit machine', icon: 'Cog', entityId: machineId, openStateKey: 'editOpen', size: 'lg' },
          children: [
            {
              id: 'mach_edit_form',
              type: 'form',
              props: {
                mode: 'edit',
                entityId: machineId,
                recordId: '{{ state.editId }}',
                showHeader: false,
                showCancel: true,
                submitLabel: 'Save changes',
                showDelete: true,
                deleteLabel: 'Delete machine',
                fields: formFields,
                onCancel: [closeModal('editOpen')],
                onDelete: [
                  {
                    type: 'confirm',
                    params: {
                      title: 'Delete machine',
                      message: 'Delete this machine? Machines that have production sheets cannot be deleted.',
                      confirmLabel: 'Delete',
                      cancelLabel: 'Cancel',
                    },
                  },
                  {
                    type: 'deleteRecord',
                    params: { entityId: machineId, id: '{{ state.editId }}' },
                    onError: [{ type: 'showToast', params: { message: 'This machine has production sheets, so it cannot be deleted.', variant: 'error' } }],
                  },
                  closeModal('editOpen'),
                  refetch('ds_machines'),
                  toast('Machine deleted'),
                ],
                onSuccess: [closeModal('editOpen'), refetch('ds_machines'), toast('Machine updated')],
              },
            },
          ],
        },
      ]),
    },
  };
}

function sheetsPage(ctx: PageContext) {
  const S = (n: string) => ctx.sheet.fields.find((f: any) => f.name === n).id;
  const sheetId = ctx.sheet.entity.id;
  const monthFilter = { month: '{{ state.month }}' };
  return {
    name: 'Production Sheets',
    route: '/production/sheets',
    draft: {
      schemaVersion: 2,
      id: 'pg_production_sheets',
      version: 1,
      route: '/production/sheets',
      state: { month: ctx.currentMonth, machineSearch: '', createOpen: false, editOpen: false, editId: '' },
      dataSources: [
        {
          id: 'ds_sheets',
          entityId: sheetId,
          filter: { month: '{{ state.month }}', machine_name: { contains: '{{ state.machineSearch }}' } },
          sort: { fieldId: S('machine_name'), order: 'asc' },
          limit: 100,
        },
      ],
      root: stack('root', { direction: 'vertical', gap: 24, padding: 24 }, [
        header('sheets', 'Production Sheets', 'One sheet per machine per month. Open a sheet to tick the days it hit target.', [
          csvButton('sheets_csv', 'ds_sheets', 'production_sheets.csv'),
          {
            id: 'sheets_new',
            type: 'button',
            props: { label: 'New sheet', variant: 'secondary', icon: 'Plus', onClick: [{ type: 'openModal', params: { modalKey: 'createOpen' } }] },
          },
          exportReport('sheets_export', ctx),
        ]),
        grid('sheets_kpis', 4, [
          { id: 'kpi_sheets', type: 'stat', props: { label: 'Sheets this month', entityId: sheetId, op: 'count', filter: monthFilter, icon: 'ClipboardList' } },
          { id: 'kpi_planned', type: 'stat', props: { label: 'Planned run days', entityId: sheetId, op: 'sum', fieldId: S('planned_days'), filter: monthFilter, icon: 'CalendarDays' } },
          { id: 'kpi_met', type: 'stat', props: { label: 'Days on target', entityId: sheetId, op: 'sum', fieldId: S('days_met'), filter: monthFilter, icon: 'CircleCheck', color: 'success' } },
          { id: 'kpi_gap', type: 'stat', props: { label: 'Gap days', entityId: sheetId, op: 'sum', fieldId: S('gap_days'), filter: monthFilter, icon: 'CircleX', color: 'warning' } },
        ]),
        card('sheets_list', 'Sheets', [
          stack('sheets_filters', { direction: 'horizontal', gap: 12, wrap: true }, [
            monthSelect('sheets_month', ctx),
            { id: 'sheets_search', type: 'input', props: { valueKey: 'machineSearch', type: 'search', placeholder: 'Filter by machine', prefixIcon: 'Search', width: '280px' } },
          ]),
          {
            id: 'sheets_table',
            type: 'table',
            props: {
              source: 'ds_sheets',
              columns: ['machine_name', 'work_center', 'month', 'planned_days', 'days_met', 'gap_days', 'attainment_pct', 'notes'].map((n) => ({ fieldId: S(n) })),
              pageSize: 10,
              striped: true,
              emptyMessage: 'No sheets for this month. Use "New sheet" to add one per machine.',
              onRowClick: [
                { type: 'setState', params: { key: 'editId', value: '{{ row.id }}' } },
                { type: 'openModal', params: { modalKey: 'editOpen' } },
              ],
            },
          },
        ], { headerIcon: 'ClipboardCheck' }),
        {
          id: 'sheets_create_modal',
          type: 'modal',
          props: {
            title: 'New production sheet',
            subtitle: 'Create one sheet per machine per month, then tick days as targets are met.',
            icon: 'ClipboardCheck',
            entityId: sheetId,
            openStateKey: 'createOpen',
            size: 'xl',
          },
          children: [
            {
              id: 'sheets_create_form',
              type: 'form',
              props: {
                mode: 'create',
                entityId: sheetId,
                showHeader: false,
                showCancel: true,
                submitLabel: 'Create sheet',
                fields: sheetFormFields(ctx, 'create'),
                onCancel: [closeModal('createOpen')],
                onSuccess: [closeModal('createOpen'), refetch('ds_sheets'), toast('Production sheet created')],
              },
            },
          ],
        },
        sheetEditModal('sheets', ctx, ['ds_sheets']),
      ]),
    },
  };
}

function performancePage(ctx: PageContext) {
  const S = (n: string) => ctx.sheet.fields.find((f: any) => f.name === n).id;
  const M = (n: string) => ctx.machine.fields.find((f: any) => f.name === n).id;
  return {
    name: 'Machine Performance',
    route: '/production/machine-performance',
    draft: {
      schemaVersion: 2,
      id: 'pg_production_machine_performance',
      version: 1,
      route: '/production/machine-performance',
      state: { month: ctx.currentMonth, selectedMachineId: '', editOpen: false, editId: '' },
      dataSources: [
        { id: 'ds_machines', entityId: ctx.machine.entity.id, sort: { fieldId: M('name'), order: 'asc' }, limit: 100 },
        {
          id: 'ds_history',
          entityId: ctx.sheet.entity.id,
          filter: { machine: '{{ state.selectedMachineId }}' },
          sort: { fieldId: S('month'), order: 'asc' },
          limit: 36,
        },
      ],
      root: stack('root', { direction: 'vertical', gap: 24, padding: 24 }, [
        header('perf', 'Machine Performance', 'Pick a machine to see its profile and month-by-month target attainment.', [
          monthSelect('perf_month', ctx),
          exportReport('perf_export', ctx, 'Export monthly report'),
        ]),
        stack('perf_body', { direction: 'horizontal', gap: 24, align: 'start', wrap: true }, [
          card('perf_machines', 'Machines', [
            {
              id: 'perf_machine_table',
              type: 'table',
              props: {
                source: 'ds_machines',
                columns: [{ fieldId: M('name') }, { fieldId: M('status') }],
                pageSize: 10,
                compact: true,
                onRowClick: [{ type: 'setState', params: { key: 'selectedMachineId', value: '{{ row.id }}' } }],
              },
            },
          ], { headerIcon: 'Factory', width: '360px' }),
          stack('perf_detail', { direction: 'vertical', gap: 16, flex: 1, minWidth: '480px' }, [
            {
              id: 'perf_empty',
              type: 'card',
              visibleIf: '!state.selectedMachineId',
              props: { variant: 'flat', padding: 'lg' },
              children: [text('perf_empty_text', 'Select a machine on the left to see its performance history.', 'muted', { align: 'center' })],
            },
            {
              id: 'perf_selected',
              type: 'stack',
              visibleIf: 'state.selectedMachineId',
              props: { direction: 'vertical', gap: 16 },
              children: [
                card('perf_profile', 'Machine profile', [
                  {
                    id: 'perf_details',
                    type: 'details',
                    props: {
                      source: 'ds_machines',
                      recordId: '{{ state.selectedMachineId }}',
                      columns: 3,
                      fields: ['name', 'work_center', 'line', 'status', 'daily_capacity', 'commissioned_on'].map((n) => ({ fieldId: M(n) })),
                    },
                  },
                ], { headerIcon: 'Cog' }),
                grid('perf_charts', 2, [
                  card('perf_chart_met', 'Days on target per month', [
                    { id: 'perf_met_chart', type: 'chart', props: { source: 'ds_history', type: 'line', groupByFieldId: S('month'), aggregateOp: 'sum', aggregateFieldId: S('days_met') } },
                  ], { headerIcon: 'TrendingUp' }),
                  card('perf_chart_att', 'Attainment % per month', [
                    { id: 'perf_att_chart', type: 'chart', props: { source: 'ds_history', type: 'bar', groupByFieldId: S('month'), aggregateOp: 'avg', aggregateFieldId: S('attainment_pct') } },
                  ], { headerIcon: 'Percent' }),
                ]),
                card('perf_history', 'Monthly sheets', [
                  {
                    id: 'perf_history_table',
                    type: 'table',
                    props: {
                      source: 'ds_history',
                      columns: ['month', 'planned_days', 'days_met', 'gap_days', 'attainment_pct', 'notes'].map((n) => ({ fieldId: S(n) })),
                      pageSize: 12,
                      striped: true,
                      emptyMessage: 'No production sheets for this machine yet.',
                      onRowClick: [
                        { type: 'setState', params: { key: 'editId', value: '{{ row.id }}' } },
                        { type: 'openModal', params: { modalKey: 'editOpen' } },
                      ],
                    },
                  },
                ], { headerIcon: 'ClipboardList' }),
              ],
            },
          ]),
        ]),
        sheetEditModal('perf', ctx, ['ds_history']),
      ]),
    },
  };
}

export function buildProductionPages(ctx: PageContext) {
  return [dashboardPage(ctx), machinesPage(ctx), sheetsPage(ctx), performancePage(ctx)];
}

// ─── Seeding ──────────────────────────────────────────────────────────────────

export interface SeedPagesResult {
  fieldsAdded: number;
  sheetsBackfilled: number;
  folderId: string;
  pages: Array<{ id: string; route: string; created: boolean; brokenBindings: string[] }>;
}

export async function seedProductionPages(tenantId: string, opts: { today?: Date } = {}): Promise<SeedPagesResult> {
  const today = opts.today ?? new Date();
  let machine = await entityByName(tenantId, 'machine');
  let sheet = await entityByName(tenantId, 'production_sheet');
  if (!machine || !sheet) throw new Error(`Entities 'machine' and 'production_sheet' not found; run seed:production first`);

  // 1. Extra fields
  const fieldsAdded =
    (await ensureFields(tenantId, machine, MACHINE_EXTRA_FIELDS)) + (await ensureFields(tenantId, sheet, SHEET_EXTRA_FIELDS));
  machine = (await entityByName(tenantId, 'machine'))!;
  sheet = (await entityByName(tenantId, 'production_sheet'))!;
  await ensureEntityPresentation(tenantId, machine, 'Cog', 'name');
  await ensureEntityPresentation(tenantId, sheet, 'ClipboardCheck', 'machine_name');
  machine = (await entityByName(tenantId, 'machine'))!;
  sheet = (await entityByName(tenantId, 'production_sheet'))!;

  // 2. Machine attributes for the seeded machines (only where not set yet)
  const schema = defaultStorageAdapter.getTenantSchemaName(tenantId);
  const mcol = (n: string) => machine!.fields.find((f: any) => f.name === n)!.physicalColumnName;
  const machines = await defaultStorageAdapter.query<any>(
    tenantId,
    `SELECT id, "${mcol('name')}" AS name, "${mcol('status')}" AS status FROM "${schema}"."${machine.entity.physicalTableName}"`
  );
  for (const m of machines) {
    const details = MACHINE_DETAILS[m.name];
    if (!details || m.status) continue;
    await recordsService.updateRecord(tenantId, machine.entity.id, m.id, {
      status: details.status,
      line: details.line,
      daily_capacity: details.capacity,
      commissioned_on: details.commissioned,
    });
  }

  // 3. Derived sheet fields
  const sheetsBackfilled = await setupCalculatedSheetFields(tenantId, sheet);

  // 4. Pages under a "Production" navigation folder
  const tpl = await pool.query(`SELECT id FROM public.export_template WHERE tenant_id = $1 AND name = $2`, [tenantId, TEMPLATE_NAME]);
  const ctx: PageContext = {
    machine,
    sheet,
    templateId: tpl.rows[0]?.id ?? null,
    currentMonth: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`,
    months: monthOptions(today),
  };

  const folderRes = await pool.query(
    `SELECT id FROM public.page_nav_folder WHERE tenant_id = $1 AND parent_id IS NULL AND lower(name) = lower($2)`,
    [tenantId, FOLDER_NAME]
  );
  const folderId = folderRes.rows[0]?.id ?? (await pagesService.createFolder(tenantId, { name: FOLDER_NAME })).id;

  const results: SeedPagesResult['pages'] = [];
  for (const page of buildProductionPages(ctx)) {
    const existing = await pool.query(`SELECT id FROM public.page_def WHERE tenant_id = $1 AND route = $2`, [tenantId, page.route]);
    let pageId: string;
    let brokenBindings: string[] = [];
    if (existing.rows[0]) {
      pageId = existing.rows[0].id;
      const updated: any = await pagesService.updatePage(tenantId, pageId, { name: page.name, draft: page.draft as any });
      brokenBindings = updated.brokenBindings || [];
    } else {
      const created: any = await pagesService.createPage(tenantId, { name: page.name, route: page.route, draft: page.draft as any, folderId });
      pageId = created.id;
      brokenBindings = created.brokenBindings || [];
    }
    await pagesService.publishPage(tenantId, pageId);
    results.push({ id: pageId, route: page.route, created: !existing.rows[0], brokenBindings });
  }

  // Menu order follows buildProductionPages; re-append in order if positions don't match it
  const positions = await pool.query<{ id: string; nav_position: number }>(
    `SELECT id, nav_position FROM public.page_def WHERE tenant_id = $1 AND id = ANY($2)`,
    [tenantId, results.map((p) => p.id)]
  );
  const posById = new Map(positions.rows.map((r) => [r.id, r.nav_position]));
  const ordered = results.every((p, i) => i === 0 || posById.get(p.id)! > posById.get(results[i - 1].id)!);
  if (!ordered) {
    for (const p of results) await pagesService.movePage(tenantId, p.id, folderId);
  }

  return { fieldsAdded, sheetsBackfilled, folderId, pages: results };
}

async function main() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const email = get('--email') || process.env.SEED_EMAIL;
  if (!email) throw new Error('Missing --email <user email>');
  await initializeMetadataCatalog();

  const res = await pool.query(
    `SELECT m.tenant_id, t.name FROM public.app_user u
       JOIN public.tenant_member m ON m.user_id = u.id
       JOIN public.tenant t ON t.id = m.tenant_id
      WHERE lower(u.email) = lower($1)`,
    [email]
  );
  const tenantFlag = get('--tenant');
  const rows = tenantFlag ? res.rows.filter((r) => r.tenant_id === tenantFlag) : res.rows;
  if (rows.length !== 1) throw new Error(rows.length ? 'User has several workspaces; pass --tenant' : `No workspace for ${email}`);

  console.log(`Workspace "${rows[0].name}" (${rows[0].tenant_id})`);
  const result = await seedProductionPages(rows[0].tenant_id);
  console.log(`  fields added: ${result.fieldsAdded}, sheets recalculated: ${result.sheetsBackfilled}`);
  for (const p of result.pages) {
    console.log(`  ${p.created ? '+ created' : '~ updated'} ${p.route} (${p.id})${p.brokenBindings.length ? `  broken bindings: ${p.brokenBindings.join('; ')}` : ''}`);
  }
}

if (process.argv[1]?.includes('seed-production-pages')) {
  main()
    .catch((err) => {
      console.error('Seed failed:', err.message || err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
