/**
 * Solution templates: ready-made apps for manufacturing and operations teams, installed from
 * the template gallery. Each describes its entities (with calculated fields and duplicate
 * rules), pages, reports and optional sample data; the server installs them.
 */

export interface SolutionFieldSpec {
  name: string;
  label: string;
  type: 'text' | 'number' | 'boolean' | 'date' | 'select' | 'reference';
  required?: boolean;
  /** Field config (options, formula, granularity, includeTime…). */
  config?: Record<string, unknown>;
  /** Link fields: key of the entity in this template they point to */
  link?: string;
}

export interface SolutionEntitySpec {
  key: string;
  name: string;
  label: string;
  icon: string;
  /** Reuse an existing entity with this name (e.g. Machine) instead of creating one */
  shared?: boolean;
  /** Field shown when a record is linked from elsewhere */
  displayField: string;
  fields: SolutionFieldSpec[];
  /** Field-name combinations no two records may share */
  uniqueRules?: string[][];
  /** Table columns on the entity's page */
  tableColumns: string[];
}

/** A sample value pointing at a record of another entity in the template (by position). */
export interface SampleRef {
  $ref: string;
  index: number;
}

export interface SolutionTemplate {
  id: string;
  name: string;
  /** One line for the gallery card */
  summary: string;
  /** What it's for, in a sentence or two */
  description: string;
  icon: string;
  /** Sidebar group for the template's pages */
  folder: string;
  entities: SolutionEntitySpec[];
  /** One page per entry (table with add/edit), in the folder */
  pages: Array<{ entity: string; title: string; slug: string }>;
  reports: Array<{ entity: string; name: string }>;
  /** Example records per entity key; dates are relative to `today` */
  sampleData?: (today: Date) => Record<string, Array<Record<string, unknown | SampleRef>>>;
  /** Installed by a dedicated routine instead of this description (the Production Tracker) */
  custom?: 'production-tracker';
}

// ─── Shared ─────────────────────────────────────────────────────────────────

/** The Machine entity every template links to (reused when the workspace already has one). */
const MACHINE: SolutionEntitySpec = {
  key: 'machine',
  name: 'machine',
  label: 'Machine',
  icon: 'Cog',
  shared: true,
  displayField: 'name',
  fields: [
    { name: 'name', label: 'Name', type: 'text', required: true },
    { name: 'work_center', label: 'Work Center', type: 'text' },
  ],
  uniqueRules: [['name']],
  tableColumns: ['name', 'work_center'],
};

const MACHINE_SAMPLES = [
  { name: 'CNC Mill 01', work_center: 'Machining' },
  { name: 'Lathe L-03', work_center: 'Machining' },
  { name: 'Press P-04', work_center: 'Stamping' },
  { name: 'Injection Mold M-05', work_center: 'Molding' },
  { name: 'Paint Line PL-07', work_center: 'Finishing' },
];

const ref = (key: string, index: number): SampleRef => ({ $ref: key, index });
const day = (today: Date, offset: number) => {
  const d = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate() + offset));
  return d.toISOString().slice(0, 10);
};
const at = (today: Date, offsetDays: number, hour: number, minute = 0) =>
  new Date(today.getFullYear(), today.getMonth(), today.getDate() + offsetDays, hour, minute).toISOString();
const lookup = (field: string, label: string, from = 'machine'): SolutionFieldSpec => ({
  name: field, label, type: 'text', config: { formula: `${from}.${field === 'machine_name' ? 'name' : field}` },
});
const options = (...values: string[]) => ({ options: values.map((v) => ({ label: v, value: v })) });

// ─── Templates ──────────────────────────────────────────────────────────────

export const SOLUTION_TEMPLATES: SolutionTemplate[] = [
  {
    id: 'production-tracker',
    name: 'Production Tracker',
    summary: 'Tick the days each machine hit its target; monthly attainment and an Excel tracker.',
    description:
      'One sheet per machine per month with a checkbox per day. Days on target, gap and attainment % are calculated; the dashboard and the Excel tracker (with charts) follow every tick.',
    icon: 'ClipboardCheck',
    folder: 'Production',
    entities: [MACHINE],
    pages: [],
    reports: [],
    custom: 'production-tracker',
  },
  {
    id: 'maintenance-log',
    name: 'Maintenance & Breakdown Log',
    summary: 'Breakdowns and planned maintenance per machine, with downtime and who fixed it.',
    description:
      'Log every breakdown, preventive job and inspection against a machine: what happened, status, technician and downtime hours. Spot the machines that cost the most time.',
    icon: 'Wrench',
    folder: 'Maintenance',
    entities: [
      MACHINE,
      {
        key: 'job',
        name: 'maintenance_job',
        label: 'Maintenance Job',
        icon: 'Wrench',
        displayField: 'title',
        fields: [
          { name: 'machine', label: 'Machine', type: 'reference', link: 'machine', required: true },
          { name: 'title', label: 'Problem / Task', type: 'text', required: true },
          { name: 'job_type', label: 'Type', type: 'select', required: true, config: options('Breakdown', 'Preventive', 'Inspection') },
          { name: 'status', label: 'Status', type: 'select', required: true, config: options('Open', 'In progress', 'Done') },
          { name: 'reported_on', label: 'Reported On', type: 'date', required: true },
          { name: 'completed_on', label: 'Completed On', type: 'date' },
          { name: 'technician', label: 'Technician', type: 'text' },
          { name: 'downtime_hours', label: 'Downtime (hours)', type: 'number', config: { precision: 6, scale: 1 } },
          { name: 'notes', label: 'Notes', type: 'text', config: { multiline: true } },
          lookup('machine_name', 'Machine Name'),
          lookup('work_center', 'Work Center'),
        ],
        tableColumns: ['reported_on', 'machine_name', 'title', 'job_type', 'status', 'downtime_hours', 'technician'],
      },
    ],
    pages: [{ entity: 'job', title: 'Maintenance Jobs', slug: 'jobs' }],
    reports: [{ entity: 'job', name: 'Maintenance report' }],
    sampleData: (today) => ({
      machine: MACHINE_SAMPLES,
      job: [
        { machine: ref('machine', 0), title: 'Spindle overheating', job_type: 'Breakdown', status: 'Done', reported_on: day(today, -12), completed_on: day(today, -11), technician: 'R. Singh', downtime_hours: 6.5 },
        { machine: ref('machine', 1), title: 'Monthly lubrication', job_type: 'Preventive', status: 'Done', reported_on: day(today, -9), completed_on: day(today, -9), technician: 'A. Khan', downtime_hours: 1 },
        { machine: ref('machine', 2), title: 'Hydraulic leak', job_type: 'Breakdown', status: 'In progress', reported_on: day(today, -2), technician: 'R. Singh', downtime_hours: 4 },
        { machine: ref('machine', 3), title: 'Mold temperature check', job_type: 'Inspection', status: 'Open', reported_on: day(today, -1) },
        { machine: ref('machine', 0), title: 'Coolant pump noise', job_type: 'Breakdown', status: 'Open', reported_on: day(today, 0), downtime_hours: 1.5 },
      ],
    }),
  },
  {
    id: 'quality-inspections',
    name: 'Quality Inspections',
    summary: 'Inspect batches, count defects; defect rate and pass/reject are calculated.',
    description:
      'Record each inspection: product, batch, sample size and defects found. The defect rate and the result (Pass under 2%, otherwise Reject) are calculated, so nobody does the maths by hand.',
    icon: 'SearchCheck',
    folder: 'Quality',
    entities: [
      MACHINE,
      {
        key: 'inspection',
        name: 'quality_inspection',
        label: 'Quality Inspection',
        icon: 'SearchCheck',
        displayField: 'batch',
        fields: [
          { name: 'inspected_on', label: 'Inspected On', type: 'date', required: true },
          { name: 'product', label: 'Product', type: 'text', required: true },
          { name: 'batch', label: 'Batch / Lot', type: 'text', required: true },
          { name: 'machine', label: 'Machine', type: 'reference', link: 'machine' },
          { name: 'sample_size', label: 'Sample Size', type: 'number', required: true },
          { name: 'defects', label: 'Defects Found', type: 'number', required: true },
          { name: 'inspector', label: 'Inspector', type: 'text' },
          { name: 'notes', label: 'Notes', type: 'text', config: { multiline: true } },
          { name: 'defect_rate', label: 'Defect Rate %', type: 'number', config: { formula: 'if(sample_size > 0, round(defects * 100 / sample_size, 2), 0)' } },
          { name: 'result', label: 'Result', type: 'text', config: { formula: 'if(defect_rate <= 2, "Pass", "Reject")' } },
          lookup('machine_name', 'Machine Name'),
        ],
        uniqueRules: [['product', 'batch']],
        tableColumns: ['inspected_on', 'product', 'batch', 'machine_name', 'sample_size', 'defects', 'defect_rate', 'result'],
      },
    ],
    pages: [{ entity: 'inspection', title: 'Quality Inspections', slug: 'inspections' }],
    reports: [{ entity: 'inspection', name: 'Quality report' }],
    sampleData: (today) => ({
      machine: MACHINE_SAMPLES,
      inspection: [
        { inspected_on: day(today, -6), product: 'Bracket A12', batch: 'B-2401', machine: ref('machine', 2), sample_size: 200, defects: 2, inspector: 'M. Rao' },
        { inspected_on: day(today, -5), product: 'Housing H3', batch: 'H-0915', machine: ref('machine', 3), sample_size: 150, defects: 6, inspector: 'M. Rao' },
        { inspected_on: day(today, -3), product: 'Shaft S7', batch: 'S-0332', machine: ref('machine', 1), sample_size: 80, defects: 0, inspector: 'J. Dsouza' },
        { inspected_on: day(today, -1), product: 'Bracket A12', batch: 'B-2402', machine: ref('machine', 2), sample_size: 200, defects: 3, inspector: 'J. Dsouza' },
      ],
    }),
  },
  {
    id: 'shift-handover',
    name: 'Shift Handover',
    summary: 'One record per shift: output vs target, safety incidents and handover notes.',
    description:
      'Each supervisor fills in their shift: units produced against target, safety incidents and what the next shift needs to know. Achievement % is calculated; a date and shift can only be entered once.',
    icon: 'ArrowRightLeft',
    folder: 'Shifts',
    entities: [
      {
        key: 'handover',
        name: 'shift_handover',
        label: 'Shift Handover',
        icon: 'ArrowRightLeft',
        displayField: 'shift_date',
        fields: [
          { name: 'shift_date', label: 'Date', type: 'date', required: true },
          { name: 'shift', label: 'Shift', type: 'select', required: true, config: options('A (Morning)', 'B (Evening)', 'C (Night)') },
          { name: 'supervisor', label: 'Supervisor', type: 'text', required: true },
          { name: 'units_produced', label: 'Units Produced', type: 'number', required: true },
          { name: 'units_target', label: 'Target Units', type: 'number', required: true },
          { name: 'safety_incidents', label: 'Safety Incidents', type: 'number' },
          { name: 'notes', label: 'Handover Notes', type: 'text', config: { multiline: true } },
          { name: 'achieved_pct', label: 'Achieved %', type: 'number', config: { formula: 'if(units_target > 0, round(units_produced * 100 / units_target, 1), 0)' } },
        ],
        uniqueRules: [['shift_date', 'shift']],
        tableColumns: ['shift_date', 'shift', 'supervisor', 'units_produced', 'units_target', 'achieved_pct', 'safety_incidents'],
      },
    ],
    pages: [{ entity: 'handover', title: 'Shift Handovers', slug: 'handovers' }],
    reports: [{ entity: 'handover', name: 'Shift report' }],
    sampleData: (today) => ({
      handover: [
        { shift_date: day(today, -1), shift: 'A (Morning)', supervisor: 'P. Nair', units_produced: 1180, units_target: 1200, safety_incidents: 0, notes: 'Line 2 changeover done at 11:00.' },
        { shift_date: day(today, -1), shift: 'B (Evening)', supervisor: 'S. Iyer', units_produced: 1015, units_target: 1200, safety_incidents: 1, notes: 'Minor cut, first aid given. Press P-04 slow after 20:00.' },
        { shift_date: day(today, -1), shift: 'C (Night)', supervisor: 'K. Das', units_produced: 960, units_target: 1000, safety_incidents: 0 },
        { shift_date: day(today, 0), shift: 'A (Morning)', supervisor: 'P. Nair', units_produced: 1225, units_target: 1200, safety_incidents: 0 },
      ],
    }),
  },
  {
    id: 'downtime-log',
    name: 'Downtime Log',
    summary: 'Every stoppage per machine with its reason and duration, to find what costs most.',
    description:
      'Operators log each stop: machine, when it started, how long and why (breakdown, changeover, no material…). Hours are calculated so the biggest causes of lost time stand out.',
    icon: 'TimerOff',
    folder: 'Downtime',
    entities: [
      MACHINE,
      {
        key: 'event',
        name: 'downtime_event',
        label: 'Downtime Event',
        icon: 'TimerOff',
        displayField: 'reason',
        fields: [
          { name: 'machine', label: 'Machine', type: 'reference', link: 'machine', required: true },
          { name: 'started_at', label: 'Started', type: 'date', required: true, config: { includeTime: true } },
          { name: 'duration_min', label: 'Duration (min)', type: 'number', required: true },
          {
            name: 'reason',
            label: 'Reason',
            type: 'select',
            required: true,
            config: options('Breakdown', 'Changeover', 'No material', 'No operator', 'Planned maintenance', 'Quality issue'),
          },
          { name: 'notes', label: 'Notes', type: 'text', config: { multiline: true } },
          { name: 'hours', label: 'Hours', type: 'number', config: { formula: 'round(duration_min / 60, 2)' } },
          lookup('machine_name', 'Machine Name'),
          lookup('work_center', 'Work Center'),
        ],
        tableColumns: ['started_at', 'machine_name', 'reason', 'duration_min', 'hours', 'notes'],
      },
    ],
    pages: [{ entity: 'event', title: 'Downtime Events', slug: 'events' }],
    reports: [{ entity: 'event', name: 'Downtime report' }],
    sampleData: (today) => ({
      machine: MACHINE_SAMPLES,
      event: [
        { machine: ref('machine', 0), started_at: at(today, -3, 9, 15), duration_min: 45, reason: 'Changeover' },
        { machine: ref('machine', 2), started_at: at(today, -2, 14, 0), duration_min: 240, reason: 'Breakdown', notes: 'Hydraulic leak' },
        { machine: ref('machine', 4), started_at: at(today, -1, 7, 30), duration_min: 30, reason: 'No material' },
        { machine: ref('machine', 1), started_at: at(today, -1, 16, 45), duration_min: 60, reason: 'Planned maintenance' },
        { machine: ref('machine', 0), started_at: at(today, 0, 10, 0), duration_min: 20, reason: 'Quality issue' },
      ],
    }),
  },
];

export function isSampleRef(value: unknown): value is SampleRef {
  return Boolean(value && typeof value === 'object' && '$ref' in (value as object) && 'index' in (value as object));
}
