import type { GridCellDefinition, GridSheetDefinition } from '@config-platform/schema';

/**
 * Converts column letter(s) (e.g. 'A', 'Z', 'AA') to 0-based column index.
 */
export function colLettersToIndex(letters: string): number {
  let col = 0;
  const clean = letters.toUpperCase().trim();
  for (let i = 0; i < clean.length; i++) {
    col = col * 26 + (clean.charCodeAt(i) - 64);
  }
  return col - 1;
}

/**
 * Converts 0-based column index to column letter(s) (e.g. 0 -> 'A', 27 -> 'AB').
 */
export function indexToColLetters(index: number): number | string {
  let temp = index + 1;
  let letter = '';
  while (temp > 0) {
    const mod = (temp - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    temp = Math.floor((temp - mod) / 26);
  }
  return letter;
}

/**
 * Parses single cell reference (e.g. 'D10', '$D$10') into 0-based row and col index.
 */
export function parseCellCoord(ref: string): { row: number; col: number } | null {
  const match = ref.trim().match(/^\$?([A-Za-z]+)\$?(\d+)$/);
  if (!match) return null;
  const col = colLettersToIndex(match[1]);
  const row = parseInt(match[2], 10) - 1;
  return { row, col };
}

/**
 * Parses a cell range (e.g. 'D10:D49', '$A$1:$B$5') into bounding box.
 */
export function parseCellRange(rangeStr: string): {
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
} | null {
  const parts = rangeStr.split(':');
  if (parts.length !== 2) return null;
  const p1 = parseCellCoord(parts[0]);
  const p2 = parseCellCoord(parts[1]);
  if (!p1 || !p2) return null;
  return {
    startRow: Math.min(p1.row, p2.row),
    endRow: Math.max(p1.row, p2.row),
    startCol: Math.min(p1.col, p2.col),
    endCol: Math.max(p1.col, p2.col),
  };
}

/**
 * Sandboxed Formula Evaluator for Allowlisted Functions
 */
export class SandboxedFormulaEvaluator {
  private cells: Record<string, GridCellDefinition>;
  private cache: Map<string, any> = new Map();
  private visiting: Set<string> = new Set();

  constructor(cells: Record<string, GridCellDefinition>) {
    this.cells = cells;
  }

  /**
   * Retrieves the numeric or raw value of a cell at (row, col).
   */
  public getCellValue(row: number, col: number): any {
    const key = `${row}:${col}`;
    if (this.cache.has(key)) {
      return this.cache.get(key);
    }
    const cellDef = this.cells[key];
    if (!cellDef) return null;

    if (cellDef.formula) {
      if (this.visiting.has(key)) {
        // Circular reference detected
        return 0;
      }
      this.visiting.add(key);
      try {
        const res = this.evaluateFormula(cellDef.formula);
        this.cache.set(key, res);
        return res;
      } finally {
        this.visiting.delete(key);
      }
    }

    const val = cellDef.value;
    if (val === null || val === undefined || val === '') return null;
    if (typeof val === 'number') return val;
    if (typeof val === 'boolean') return val;
    const num = Number(val);
    return isNaN(num) ? val : num;
  }

  /**
   * Retrieves flat array of values from a range string (e.g. 'D10:D49').
   */
  public getRangeValues(rangeStr: string): any[] {
    const range = parseCellRange(rangeStr);
    if (!range) return [];
    const vals: any[] = [];
    for (let r = range.startRow; r <= range.endRow; r++) {
      for (let c = range.startCol; c <= range.endCol; c++) {
        const val = this.getCellValue(r, c);
        if (val !== null && val !== undefined && val !== '') {
          vals.push(val);
        }
      }
    }
    return vals;
  }

  /**
   * Evaluates an allowlisted Excel formula string.
   * Returns computed value, or throws if unsupported / invalid.
   */
  public evaluateFormula(formula: string): any {
    let raw = formula.startsWith('=') ? formula.slice(1).trim() : formula.trim();
    if (!raw) return 0;

    return this.parseExpression(raw);
  }

  /**
   * Tokenizes and parses an expression with operator precedence.
   */
  private parseExpression(expr: string): any {
    expr = expr.trim();

    // 1. Comparison operators (<>, !=, <=, >=, <, >, =)
    for (const op of ['<>', '!=', '<=', '>=', '<', '>', '=']) {
      const idx = this.findOperatorIndex(expr, op);
      if (idx !== -1) {
        const left = this.parseExpression(expr.slice(0, idx));
        const right = this.parseExpression(expr.slice(idx + op.length));
        if (op === '=' ) return left == right;
        if (op === '<>' || op === '!=') return left != right;
        if (op === '<') return Number(left) < Number(right);
        if (op === '>') return Number(left) > Number(right);
        if (op === '<=') return Number(left) <= Number(right);
        if (op === '>=') return Number(left) >= Number(right);
      }
    }

    // 2. Addition and subtraction (+, -)
    for (let i = expr.length - 1; i >= 0; i--) {
      const char = expr[i];
      if (char === '+' || char === '-') {
        // Ensure not inside parentheses or scientific notation or unary prefix
        if (this.isOperatorAt(expr, i) && i > 0) {
          const left = this.parseExpression(expr.slice(0, i));
          const right = this.parseExpression(expr.slice(i + 1));
          return char === '+' ? Number(left) + Number(right) : Number(left) - Number(right);
        }
      }
    }

    // 3. Multiplication and division (*, /)
    for (let i = expr.length - 1; i >= 0; i--) {
      const char = expr[i];
      if (char === '*' || char === '/') {
        if (this.isOperatorAt(expr, i)) {
          const left = this.parseExpression(expr.slice(0, i));
          const right = this.parseExpression(expr.slice(i + 1));
          if (char === '*') return Number(left) * Number(right);
          const rNum = Number(right);
          return rNum === 0 ? 0 : Number(left) / rNum;
        }
      }
    }

    // 4. Function call: NAME(...)
    const fnMatch = expr.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\((.*)\)$/s);
    if (fnMatch) {
      const fnName = fnMatch[1].toUpperCase();
      const argsRaw = this.splitArgs(fnMatch[2]);
      return this.executeFunction(fnName, argsRaw);
    }

    // 5. Parenthesized expression: (...)
    if (expr.startsWith('(') && expr.endsWith(')')) {
      return this.parseExpression(expr.slice(1, -1));
    }

    // 6. Cell reference: A1, $A$1
    const cellCoord = parseCellCoord(expr);
    if (cellCoord) {
      return this.getCellValue(cellCoord.row, cellCoord.col) ?? 0;
    }

    // 7. Range: A1:A10 (stand-alone range evaluates to its array of values)
    const rangeCoord = parseCellRange(expr);
    if (rangeCoord) {
      return this.getRangeValues(expr);
    }

    // 8. Number literal
    const num = Number(expr);
    if (!isNaN(num)) {
      return num;
    }

    // 9. String literal
    if ((expr.startsWith('"') && expr.endsWith('"')) || (expr.startsWith("'") && expr.endsWith("'"))) {
      return expr.slice(1, -1);
    }

    // 10. Boolean literals
    if (expr.toUpperCase() === 'TRUE') return true;
    if (expr.toUpperCase() === 'FALSE') return false;

    return expr;
  }

  private splitArgs(argsStr: string): string[] {
    const args: string[] = [];
    let current = '';
    let depth = 0;
    let inQuote = false;

    for (let i = 0; i < argsStr.length; i++) {
      const char = argsStr[i];
      if (char === '"' || char === "'") {
        inQuote = !inQuote;
        current += char;
      } else if (!inQuote && char === '(') {
        depth++;
        current += char;
      } else if (!inQuote && char === ')') {
        depth--;
        current += char;
      } else if (!inQuote && depth === 0 && char === ',') {
        args.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    if (current.trim().length > 0) {
      args.push(current.trim());
    }
    return args;
  }

  private isOperatorAt(expr: string, pos: number): boolean {
    let depth = 0;
    let inQuote = false;
    for (let i = 0; i < expr.length; i++) {
      const char = expr[i];
      if (char === '"' || char === "'") inQuote = !inQuote;
      else if (!inQuote && char === '(') depth++;
      else if (!inQuote && char === ')') depth--;

      if (i === pos) {
        return !inQuote && depth === 0;
      }
    }
    return false;
  }

  private findOperatorIndex(expr: string, op: string): number {
    let depth = 0;
    let inQuote = false;
    for (let i = 0; i <= expr.length - op.length; i++) {
      const char = expr[i];
      if (char === '"' || char === "'") inQuote = !inQuote;
      else if (!inQuote && char === '(') depth++;
      else if (!inQuote && char === ')') depth--;
      else if (!inQuote && depth === 0 && expr.slice(i, i + op.length) === op) {
        return i;
      }
    }
    return -1;
  }

  private executeFunction(name: string, rawArgs: string[]): any {
    switch (name) {
      case 'SUM': {
        let sum = 0;
        for (const arg of rawArgs) {
          const val = this.parseExpression(arg);
          if (Array.isArray(val)) {
            for (const item of val) {
              const n = Number(item);
              if (!isNaN(n)) sum += n;
            }
          } else {
            const n = Number(val);
            if (!isNaN(n)) sum += n;
          }
        }
        return sum;
      }

      case 'AVERAGE': {
        let sum = 0;
        let count = 0;
        for (const arg of rawArgs) {
          const val = this.parseExpression(arg);
          if (Array.isArray(val)) {
            for (const item of val) {
              const n = Number(item);
              if (!isNaN(n)) {
                sum += n;
                count++;
              }
            }
          } else {
            const n = Number(val);
            if (!isNaN(n)) {
              sum += n;
              count++;
            }
          }
        }
        return count === 0 ? 0 : sum / count;
      }

      case 'MIN': {
        const nums: number[] = [];
        for (const arg of rawArgs) {
          const val = this.parseExpression(arg);
          if (Array.isArray(val)) {
            for (const item of val) {
              const n = Number(item);
              if (!isNaN(n)) nums.push(n);
            }
          } else {
            const n = Number(val);
            if (!isNaN(n)) nums.push(n);
          }
        }
        return nums.length === 0 ? 0 : Math.min(...nums);
      }

      case 'MAX': {
        const nums: number[] = [];
        for (const arg of rawArgs) {
          const val = this.parseExpression(arg);
          if (Array.isArray(val)) {
            for (const item of val) {
              const n = Number(item);
              if (!isNaN(n)) nums.push(n);
            }
          } else {
            const n = Number(val);
            if (!isNaN(n)) nums.push(n);
          }
        }
        return nums.length === 0 ? 0 : Math.max(...nums);
      }

      case 'COUNT': {
        let count = 0;
        for (const arg of rawArgs) {
          const val = this.parseExpression(arg);
          if (Array.isArray(val)) {
            for (const item of val) {
              if (item !== null && item !== undefined && !isNaN(Number(item))) count++;
            }
          } else if (val !== null && val !== undefined && !isNaN(Number(val))) {
            count++;
          }
        }
        return count;
      }

      case 'COUNTA': {
        let count = 0;
        for (const arg of rawArgs) {
          const val = this.parseExpression(arg);
          if (Array.isArray(val)) {
            for (const item of val) {
              if (item !== null && item !== undefined && item !== '') count++;
            }
          } else if (val !== null && val !== undefined && val !== '') {
            count++;
          }
        }
        return count;
      }

      case 'IF': {
        const cond = this.parseExpression(rawArgs[0]);
        if (cond) {
          return rawArgs.length > 1 ? this.parseExpression(rawArgs[1]) : true;
        } else {
          return rawArgs.length > 2 ? this.parseExpression(rawArgs[2]) : false;
        }
      }

      case 'ROUND': {
        const num = Number(this.parseExpression(rawArgs[0])) || 0;
        const decimals = rawArgs.length > 1 ? Number(this.parseExpression(rawArgs[1])) || 0 : 0;
        const factor = Math.pow(10, decimals);
        return Math.round(num * factor) / factor;
      }

      case 'ABS': {
        const num = Number(this.parseExpression(rawArgs[0])) || 0;
        return Math.abs(num);
      }

      case 'SUBTOTAL': {
        const fnCode = Number(this.parseExpression(rawArgs[0]));
        const restArgs = rawArgs.slice(1);
        if (fnCode === 9 || fnCode === 109) {
          return this.executeFunction('SUM', restArgs);
        }
        if (fnCode === 1 || fnCode === 101) {
          return this.executeFunction('AVERAGE', restArgs);
        }
        if (fnCode === 4 || fnCode === 104) {
          return this.executeFunction('MAX', restArgs);
        }
        if (fnCode === 5 || fnCode === 105) {
          return this.executeFunction('MIN', restArgs);
        }
        return 0;
      }

      default:
        throw new Error(`Unsupported formula function in sandboxed evaluator: ${name}`);
    }
  }
}

/**
 * Evaluates all formulas in a sheet and populates cellDef.value with cached result.
 * Returns information on whether all formulas were successfully cached.
 */
export function evaluateAndCacheSheetFormulas(sheet: GridSheetDefinition): {
  evaluatedCount: number;
  hasUnevaluatedFormula: boolean;
} {
  const cells = sheet.cells || {};
  const evaluator = new SandboxedFormulaEvaluator(cells);
  let evaluatedCount = 0;
  let hasUnevaluatedFormula = false;

  for (const [coord, cellDef] of Object.entries(cells)) {
    if (cellDef && cellDef.formula) {
      try {
        const result = evaluator.evaluateFormula(cellDef.formula);
        cellDef.value = result;
        evaluatedCount++;
      } catch (err) {
        // Could not evaluate allowlisted formula with sandboxed evaluator
        hasUnevaluatedFormula = true;
      }
    }
  }

  return { evaluatedCount, hasUnevaluatedFormula };
}
