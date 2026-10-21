/**
 * Seed Production Target Tracker Script.
 *
 * Creates, in the workspace of the given user:
 *   - entity `machine`            (name, work_center)
 *   - entity `production_sheet`   (machine → machine, month, planned_days, day_01..day_31 booleans);
 *                                 one record per machine per month, each day = daily target met
 *   - 8 machines and production sheets for the requested months (days after today stay unticked)
 *   - a data-driven "Production Target Tracker" grid export template bound to production_sheet
 *
 * Idempotent: existing entities, machines (by name), sheets (by machine + month) and the template
 * (by name) are reused, never modified or duplicated.
 *
 * Usage:
 *   pnpm --filter api seed:production -- --email admin@example.com --months 2026-09,2026-10
 *   Options: --email <user email> (required), --tenant <tenant id> (when the user has several
 *   workspaces), --months <YYYY-MM,...> (default: previous and current month), --dry-run,
 *   --reset-template (restore an existing template's draft to the original layout; keeps its id)
 */

import { pool } from '../db/pool.js';
import { initializeMetadataCatalog } from '../db/catalog-init.js';
import { migrationService } from '../migrations/migration-service.js';
import { recordsService } from '../records/records-service.js';
import { exportTemplateService } from '../records/export/export-template-service.js';
import { entityCache } from '../records/entity-cache.js';
import { defaultStorageAdapter } from '../db/storage-adapter.js';
import { buildProductionTrackerTemplate, productionDayField } from '@config-platform/schema';

const TEMPLATE_NAME = 'Production Target Tracker';

/** Machines with planned run days per month and how reliably they hit target (0..1). */
const MACHINES: Array<{ name: string; workCenter: string; planned: number; reliability: number }> = [
  { name: 'CNC Mill 01', workCenter: 'Machining', planned: 26, reliability: 0.88 },
  { name: 'CNC Mill 02', workCenter: 'Machining', planned: 26, reliability: 0.8 },
  { name: 'Lathe L-03', workCenter: 'Machining', planned: 24, reliability: 0.84 },
  { name: 'Press P-04', workCenter: 'Stamping', planned: 22, reliability: 0.72 },
  { name: 'Injection Mold M-05', workCenter: 'Molding', planned: 26, reliability: 0.9 },
  { name: 'Welding Cell W-06', workCenter: 'Fabrication', planned: 20, reliability: 0.68 },
  { name: 'Paint Line PL-07', workCenter: 'Finishing', planned: 18, reliability: 0.76 },
  { name: 'Assembly A-08', workCenter: 'Assembly', planned: 26, reliability: 0.92 },
];

interface Options {
  email: string;
  tenantId?: string;
  months: string[];
  dryRun: boolean;
  resetTemplate: boolean;
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const email = get('--email') || process.env.SEED_EMAIL;
  if (!email) throw new Error('Missing --email <user email>');

  const now = new Date();
  const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const defaultMonths = [ym(new Date(now.getFullYear(), now.getMonth() - 1, 1)), ym(now)];
  const months = (get('--months') || defaultMonths.join(','))
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  for (const m of months) {
    if (!/^\d{4}-\d{2}$/.test(m)) throw new Error(`Invalid month '${m}', expected YYYY-MM`);
  }
  return {
    email,
    tenantId: get('--tenant'),
    months,
    dryRun: args.includes('--dry-run'),
    resetTemplate: args.includes('--reset-template'),
  };
}

/** Deterministic pseudo-random in [0,1) so re-runs and reviews see the same data. */
function seededRandom(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

async function resolveTenant(email: string, tenantId?: string): Promise<{ tenantId: string; tenantName: string }> {
  const res = await pool.query(
    `SELECT m.tenant_id, t.name
       FROM public.app_user u
       JOIN public.tenant_member m ON m.user_id = u.id
       JOIN public.tenant t ON t.id = m.tenant_id
      WHERE lower(u.email) = lower($1)`,
    [email]
  );
  const rows = tenantId ? res.rows.filter((r) => r.tenant_id === tenantId) : res.rows;
  if (rows.length === 0) throw new Error(`No workspace found for ${email}${tenantId ? ` with id ${tenantId}` : ''}`);
  if (rows.length > 1) {
    throw new Error(`${email} belongs to several workspaces; pass --tenant (${rows.map((r) => `${r.tenant_id} "${r.name}"`).join(', ')})`);
  }
  return { tenantId: rows[0].tenant_id, tenantName: rows[0].name };
}

async function findEntity(tenantId: string, name: string) {
  const res = await pool.query(`SELECT id FROM public.entity_def WHERE tenant_id = $1 AND name = $2`, [tenantId, name]);
  return res.rows[0] ? entityCache.resolveEntity(tenantId, res.rows[0].id) : null;
}

async function ensureMachineEntity(tenantId: string, dryRun: boolean) {
  const existing = await findEntity(tenantId, 'machine');
  if (existing) {
    console.log(`  = entity 'machine' exists (${existing.entity.id})`);
    return existing;
  }
  if (dryRun) {
    console.log(`  + would create entity 'machine'`);
    return null;
  }
  const res = await migrationService.createEntity(tenantId, {
    name: 'machine',
    label: 'Machine',
    icon: 'Cog',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, unique: true, config: {} },
      { name: 'work_center', label: 'Work Center', type: 'text', required: false, unique: false, config: {} },
    ],
  } as any);
  console.log(`  + created entity 'machine' (${res.entity.id})`);
  entityCache.invalidate(tenantId);
  return entityCache.resolveEntity(tenantId, res.entity.id);
}

async function ensureProductionSheetEntity(tenantId: string, machineEntityId: string | null, dryRun: boolean) {
  const existing = await findEntity(tenantId, 'production_sheet');
  if (existing) {
    console.log(`  = entity 'production_sheet' exists (${existing.entity.id})`);
    return existing;
  }
  if (dryRun || !machineEntityId) {
    console.log(`  + would create entity 'production_sheet' with 34 fields`);
    return null;
  }
  const res = await migrationService.createEntity(tenantId, {
    name: 'production_sheet',
    label: 'Production Sheet',
    icon: 'ClipboardCheck',
    fields: [
      {
        name: 'machine',
        label: 'Machine',
        type: 'reference',
        required: true,
        unique: false,
        config: { targetEntityId: machineEntityId, onDelete: 'RESTRICT' },
      },
      { name: 'month', label: 'Month', type: 'date', required: true, unique: false, config: {} },
      { name: 'planned_days', label: 'Planned Days', type: 'number', required: true, unique: false, config: { precision: 4, scale: 0 } },
      ...Array.from({ length: 31 }, (_, d) => ({
        name: productionDayField(d + 1),
        label: `Day ${d + 1}`,
        type: 'boolean' as const,
        required: false,
        unique: false,
        config: {},
      })),
    ],
  } as any);
  console.log(`  + created entity 'production_sheet' (${res.entity.id})`);
  entityCache.invalidate(tenantId);
  return entityCache.resolveEntity(tenantId, res.entity.id);
}

export interface SeedResult {
  machineEntityId?: string;
  productionEntityId?: string;
  templateId?: string;
  machinesCreated: number;
  sheetsCreated: number;
}

/** Seeds one workspace. `today` decides which days are still in the future (left unticked). */
export async function seedProductionTracker(
  tenantId: string,
  opts: { months: string[]; dryRun?: boolean; today?: Date; resetTemplate?: boolean }
): Promise<SeedResult> {
  const result: SeedResult = { machinesCreated: 0, sheetsCreated: 0 };
  opts.dryRun = Boolean(opts.dryRun);

  const machineEntity = await ensureMachineEntity(tenantId, opts.dryRun);
  const sheetEntity = await ensureProductionSheetEntity(tenantId, machineEntity?.entity.id ?? null, opts.dryRun);
  if (!machineEntity || !sheetEntity) {
    console.log(`  + would insert ${MACHINES.length} machines, ${MACHINES.length * opts.months.length} production sheets, and the "${TEMPLATE_NAME}" template`);
    return result;
  }
  result.machineEntityId = machineEntity.entity.id;
  result.productionEntityId = sheetEntity.entity.id;

  const schema = defaultStorageAdapter.getTenantSchemaName(tenantId);
  const col = (entity: any, fieldName: string) => entity.fields.find((f: any) => f.name === fieldName)!.physicalColumnName;

  // Machines (matched by name)
  const machineIds = new Map<string, string>();
  const existingMachines = await defaultStorageAdapter.query<any>(
    tenantId,
    `SELECT id, "${col(machineEntity, 'name')}" AS name FROM "${schema}"."${machineEntity.entity.physicalTableName}"`
  );
  for (const row of existingMachines) machineIds.set(row.name, row.id);
  let machinesCreated = 0;
  for (const m of MACHINES) {
    if (machineIds.has(m.name)) continue;
    const rec = await recordsService.createRecord(tenantId, machineEntity.entity.id, { name: m.name, work_center: m.workCenter });
    machineIds.set(m.name, rec.id);
    machinesCreated++;
  }
  result.machinesCreated = machinesCreated;
  console.log(`  ${machinesCreated ? '+' : '='} machines: ${machinesCreated} created, ${MACHINES.length - machinesCreated} existing`);

  // Production sheets (matched by machine + month)
  const existingSheets = await defaultStorageAdapter.query<any>(
    tenantId,
    `SELECT "${col(sheetEntity, 'machine')}" AS machine, to_char("${col(sheetEntity, 'month')}", 'YYYY-MM') AS month
       FROM "${schema}"."${sheetEntity.entity.physicalTableName}"`
  );
  const sheetKeys = new Set(existingSheets.map((r) => `${r.machine}|${r.month}`));
  const today = opts.today ?? new Date();
  let sheetsCreated = 0;
  for (const month of opts.months) {
    const [year, mon] = month.split('-').map(Number);
    const daysInMonth = new Date(year, mon, 0).getDate();
    for (const [mIdx, m] of MACHINES.entries()) {
      const machineId = machineIds.get(m.name)!;
      if (sheetKeys.has(`${machineId}|${month}`)) continue;
      const record: Record<string, any> = { machine: machineId, month: `${month}-01`, planned_days: m.planned };
      for (let d = 1; d <= 31; d++) {
        const date = new Date(year, mon - 1, d);
        const isSunday = date.getDay() === 0;
        const isFuture = date > today;
        const met = d <= daysInMonth && !isSunday && !isFuture && seededRandom(year * 1000 + mon * 100 + d + mIdx * 37) < m.reliability;
        record[productionDayField(d)] = met;
      }
      await recordsService.createRecord(tenantId, sheetEntity.entity.id, record);
      sheetsCreated++;
    }
  }
  result.sheetsCreated = sheetsCreated;
  console.log(`  ${sheetsCreated ? '+' : '='} production sheets: ${sheetsCreated} created for ${opts.months.join(', ')}`);

  // Data-driven export template
  const draft = buildProductionTrackerTemplate({
    productionEntityId: sheetEntity.entity.id,
    machineEntityId: machineEntity.entity.id,
    machineRefFieldId: sheetEntity.fields.find((f: any) => f.name === 'machine')!.id,
    defaultMonth: `${opts.months[opts.months.length - 1]}-01`,
  });
  const existingTemplate = await pool.query(`SELECT id FROM public.export_template WHERE tenant_id = $1 AND name = $2`, [tenantId, TEMPLATE_NAME]);
  if (existingTemplate.rows[0] && opts.resetTemplate) {
    // Restores the original layout (e.g. after a draft was saved in an expanded/preview state);
    // the id is kept so pages and export buttons that reference the template keep working.
    result.templateId = existingTemplate.rows[0].id;
    if (opts.dryRun) {
      console.log(`  ~ would reset template "${TEMPLATE_NAME}" draft (${result.templateId})`);
    } else {
      await exportTemplateService.updateTemplate(tenantId, result.templateId!, { draft });
      console.log(`  ~ reset template "${TEMPLATE_NAME}" draft to the original layout (${result.templateId}); publish it to update the live version`);
    }
  } else if (existingTemplate.rows[0]) {
    result.templateId = existingTemplate.rows[0].id;
    console.log(`  = template "${TEMPLATE_NAME}" exists (${result.templateId}); pass --reset-template to restore its original layout`);
  } else {
    const tpl = await exportTemplateService.createTemplate(tenantId, {
      name: TEMPLATE_NAME,
      entityId: sheetEntity.entity.id,
      draft,
    });
    result.templateId = tpl.id;
    console.log(`  + created template "${TEMPLATE_NAME}" (${tpl.id})`);
  }
  return result;
}

async function main() {
  const opts = parseArgs();
  await initializeMetadataCatalog();
  const { tenantId, tenantName } = await resolveTenant(opts.email, opts.tenantId);
  console.log(`Workspace "${tenantName}" (${tenantId})${opts.dryRun ? ' [dry run]' : ''}`);
  await seedProductionTracker(tenantId, { months: opts.months, dryRun: opts.dryRun, resetTemplate: opts.resetTemplate });
}

if (process.argv[1]?.includes('seed-production-tracker')) {
  main()
    .catch((err) => {
      console.error('Seed failed:', err.message || err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
