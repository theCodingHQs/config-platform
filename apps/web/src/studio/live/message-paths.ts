/**
 * The values inside a received message, with the expression that reaches each one, so a builder
 * can turn any of them into a tag with one click: { line: { speed: 41 } } → message.line.speed.
 */
export interface MessagePath {
  expression: string;
  value: string | number | boolean | null;
  type: "number" | "text" | "boolean";
}

const isIdentifier = (key: string) => /^[A-Za-z_]\w*$/.test(key);

export function messagePaths(message: unknown, maxPaths = 50): MessagePath[] {
  const paths: MessagePath[] = [];
  const walk = (value: unknown, expression: string, depth: number) => {
    if (paths.length >= maxPaths || depth > 6) return;
    if (value === null || typeof value !== "object") {
      const type = typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "text";
      paths.push({ expression, value: value as MessagePath["value"], type });
      return;
    }
    if (Array.isArray(value)) {
      value.slice(0, 5).forEach((item, i) => walk(item, `${expression}[${i}]`, depth + 1));
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      walk(child, isIdentifier(key) ? `${expression}.${key}` : `${expression}[${JSON.stringify(key)}]`, depth + 1);
    }
  };
  walk(message, "message", 0);
  return paths;
}

/** A tag name from an expression: message.line1.speed → line1.speed (prefixed with the connection) */
export function suggestTagName(expression: string, prefix: string): string {
  const words = expression
    .replace(/^message\.?/, "")
    .split(/[.[\]"]+/)
    .filter(Boolean)
    .map((w) => w.replace(/\W+/g, "_"))
    .map((w) => (/^\d/.test(w) ? `_${w}` : w));
  return [prefix, ...words].filter(Boolean).join(".") || `${prefix}.value`;
}
