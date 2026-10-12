import crypto from 'node:crypto';

/**
 * Generates stable identifiers according to core platform principles:
 * Tables: t_<hex> (e.g. t_8f2a9c1d)
 * Columns: c_<hex> (e.g. c_91bd3e4f)
 * Relations: r_<hex> (e.g. r_7a1b4c2e)
 * Pages: p_<hex> (e.g. p_0f3b8a1c)
 */

export function generateStableId(prefix: 't' | 'c' | 'r' | 'p' | 'et'): string {
  const hex = crypto.randomBytes(4).toString('hex');
  return `${prefix}_${hex}`;
}

export function generateTableId(): string {
  return generateStableId('t');
}

export function generateColumnId(): string {
  return generateStableId('c');
}

export function generateRelationId(): string {
  return generateStableId('r');
}

export function generatePageId(): string {
  return generateStableId('p');
}

export function generateExportTemplateId(): string {
  return generateStableId('et');
}

export function isValidStableId(id: string, prefix?: 't' | 'c' | 'r' | 'p' | 'et'): boolean {
  if (prefix) {
    const re = new RegExp(`^${prefix}_[a-f0-9]{8}$`);
    return re.test(id);
  }
  return /^(?:[tcrp]|et)_[a-f0-9]{8}$/.test(id);
}
