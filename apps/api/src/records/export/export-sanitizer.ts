import { evaluatePropValue } from '@config-platform/schema';

export function isFormulaInjection(val: any): boolean {
  if (typeof val !== 'string') return false;
  return /^\s*[=+\-@]/.test(val);
}

export function sanitizeCsvValue(val: any): string {
  if (val === null || val === undefined) {
    return '';
  }
  if (typeof val === 'boolean') {
    return val ? 'true' : 'false';
  }
  let str = String(val);

  // Injection safety: every data cell starting with =, +, - or @ (also after leading whitespace)
  // is prefixed with a single quote '
  if (isFormulaInjection(str)) {
    str = `'${str}`;
  }

  // Escape CSV quotes and wrap if contains comma, quote, or newline
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function sanitizeFilename(
  rawName: string | undefined | null,
  fallbackBase: string,
  extension: string
): string {
  let name = (rawName || '').trim();

  // Strip control characters, carriage returns, newlines to prevent header injection
  name = name.replace(/[\x00-\x1F\x7F\r\n]/g, '');

  // Strip path traversal attempts and directory separators
  name = name.replace(/[/\\?%*:|"<>]/g, '_');
  name = name.replace(/\.\.+/g, '_');

  // Strip leading/trailing dots, underscores, and spaces
  name = name.trim().replace(/^[\._\s]+|[\._\s]+$/g, '');

  if (!name) {
    name = fallbackBase.replace(/[/\\?%*:|"<>]/g, '_');
  }

  // Cap length to 100 chars (excluding extension)
  if (name.length > 100) {
    name = name.slice(0, 100);
  }

  const cleanExt = extension.replace(/^\./, '');
  if (!name.toLowerCase().endsWith(`.${cleanExt.toLowerCase()}`)) {
    name = `${name}.${cleanExt}`;
  }

  return name;
}

export function evaluateExportFilename(
  expression: string | undefined | null,
  context: {
    templateName?: string;
    entityName: string;
    entityLabel?: string;
    format: string;
  }
): string {
  const fallback = `${context.templateName || context.entityName}_export`;
  if (!expression || !expression.trim()) {
    return sanitizeFilename(fallback, fallback, context.format);
  }

  const scope = {
    template: { name: context.templateName || '' },
    entity: { name: context.entityName, label: context.entityLabel || context.entityName },
    format: context.format,
    date: new Date().toISOString().slice(0, 10),
    timestamp: Date.now(),
  };

  try {
    const exprString = expression.includes('{{') ? expression : `{{ ${expression} }}`;
    const result = evaluatePropValue(exprString, scope);
    const evaluatedName = result.value ? String(result.value) : fallback;
    return sanitizeFilename(evaluatedName, fallback, context.format);
  } catch {
    return sanitizeFilename(fallback, fallback, context.format);
  }
}

export function buildSafeContentDisposition(filename: string): string {
  // ASCII-only fallback for standard filename parameter, RFC 5987 filename* for full UTF-8
  const asciiFallback = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  const encodedUtf8 = encodeURIComponent(filename);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedUtf8}`;
}
