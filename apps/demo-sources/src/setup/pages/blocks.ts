/**
 * Page building blocks (the page definition's JSON) and the live expressions the monitoring
 * pages repeat for every machine.
 */
export type Node = { id: string; type: string; props: Record<string, any>; children?: Node[]; visibleIf?: string };

export const text = (id: string, value: string, variant = 'body', extra: Record<string, any> = {}): Node => ({ id, type: 'text', props: { value, variant, ...extra } });
export const stack = (id: string, props: Record<string, any>, children: Node[]): Node => ({ id, type: 'stack', props, children });
export const row = (id: string, children: Node[], extra: Record<string, any> = {}) => stack(id, { direction: 'horizontal', gap: 12, align: 'center', wrap: true, ...extra }, children);
export const column = (id: string, children: Node[], gap = 8) => stack(id, { direction: 'vertical', gap }, children);
export const grid = (id: string, columns: number, children: Node[], extra: Record<string, any> = {}): Node => ({ id, type: 'grid', props: { columns, gap: 16, responsiveCollapse: true, ...extra }, children });
export const card = (id: string, title: string, children: Node[], extra: Record<string, any> = {}): Node => ({ id, type: 'card', props: { title, variant: 'bordered', padding: 'md', ...extra }, children });
export const stat = (id: string, label: string, entityId: string, extra: Record<string, any> = {}): Node => ({ id, type: 'stat', props: { label, entityId, op: 'count', ...extra } });

export const header = (id: string, title: string, subtitle: string, actions: Node[] = []) =>
  stack(`${id}_header`, { direction: 'horizontal', justify: 'space-between', align: 'end', gap: 16, wrap: true }, [
    column(`${id}_titles`, [text(`${id}_title`, title, 'h1'), text(`${id}_subtitle`, subtitle, 'muted')], 4),
    row(`${id}_actions`, actions),
  ]);

/** A small "label: value" pair */
export const metric = (id: string, label: string, value: string, extra: Record<string, any> = {}) =>
  column(id, [text(`${id}_l`, label, 'caption', { color: 'muted' }), text(`${id}_v`, value, 'h3', extra)], 2);

/** The live socket's own state, for a page header */
export const liveBadge = (id: string) =>
  text(id, "{{ liveInfo.connected ? '● Live' : '○ Connecting…' }}", 'body', { weight: 'semibold', color: "{{ liveInfo.connected ? 'success' : 'muted' }}" });

// ─── Live expressions ──────────────────────────────────────────────────────────

/** live.machines.m01.speed, or a machine picked at run time: live.machines[state.code].speed */
export const tag = (code: string, key: string) => (code.startsWith('state.') ? `live.machines[${code}].${key}` : `live.machines.${code}.${key}`);

/** A value as text (text props must be text, so numbers get + ''), or — while it hasn't arrived */
export const shown = (expr: string, suffix = '') => `{{ ${expr} == null ? '—' : ${expr} + '${suffix ? ` ${suffix}` : ''}' }}`;

export const statusText = (code: string) => `{{ ${tag(code, 'status')} == null ? 'NO DATA' : upper(${tag(code, 'status')}) }}`;

export const statusColor = (code: string) => {
  const s = tag(code, 'status');
  return `{{ ${s} == 'running' ? 'success' : ${s} == 'alarm' ? 'danger' : ${s} == 'stopped' ? 'warning' : 'muted' }}`;
};

/** Totals over machines, e.g. sum(live.machines.m01.count, …); sum() skips machines with no value yet */
export const sumOver = (codes: string[], key: string) => `sum(${codes.map((c) => tag(c, key)).join(', ')})`;
export const countWhere = (codes: string[], key: string, value: string) => `sum(${codes.map((c) => `${tag(c, key)} == '${value}' ? 1 : 0`).join(', ')})`;
