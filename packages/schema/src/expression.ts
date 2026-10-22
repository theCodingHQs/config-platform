import jsep from 'jsep';

export const MAX_EXPRESSION_LENGTH = 500;
export const MAX_AST_DEPTH = 10;

export const BLOCKED_IDENTIFIERS = new Set(['__proto__', 'constructor', 'prototype']);

export const WHITELISTED_NODES = new Set([
  'Literal',
  'Identifier',
  'BinaryExpression',
  'UnaryExpression',
  'MemberExpression',
  'CallExpression',
  'LogicalExpression',
  'ConditionalExpression',
  'ArrayExpression',
]);

export interface ExpressionScope {
  state?: Record<string, any>;
  params?: Record<string, any>;
  row?: Record<string, any>;
  ds?: Record<string, any>;
  user?: Record<string, any>;
  [key: string]: any;
}

export const PURE_FUNCTIONS: Record<string, (...args: any[]) => any> = {
  concat: (...args: any[]) => args.map((a) => (a === null || a === undefined ? '' : String(a))).join(''),
  upper: (str: any) => (str === null || str === undefined ? '' : String(str).toUpperCase()),
  lower: (str: any) => (str === null || str === undefined ? '' : String(str).toLowerCase()),
  trim: (str: any) => (str === null || str === undefined ? '' : String(str).trim()),
  round: (num: any, decimals: number = 0) => {
    const n = Number(num);
    if (isNaN(n)) return 0;
    const factor = Math.pow(10, decimals);
    return Math.round(n * factor) / factor;
  },
  floor: (num: any) => Math.floor(Number(num) || 0),
  ceil: (num: any) => Math.ceil(Number(num) || 0),
  abs: (num: any) => Math.abs(Number(num) || 0),
  min: (...args: any[]) => {
    const nums = args.map((a) => Number(a)).filter((n) => !isNaN(n));
    return nums.length === 0 ? 0 : Math.min(...nums);
  },
  max: (...args: any[]) => {
    const nums = args.map((a) => Number(a)).filter((n) => !isNaN(n));
    return nums.length === 0 ? 0 : Math.max(...nums);
  },
  formatDate: (val: any) => {
    if (!val) return '';
    const d = new Date(val);
    return isNaN(d.getTime()) ? String(val) : d.toLocaleDateString();
  },
  formatNumber: (val: any, decimals: number = 2) => {
    const n = Number(val);
    return isNaN(n) ? String(val) : n.toFixed(decimals);
  },
  coalesce: (...args: any[]) => {
    for (const a of args) {
      if (a !== null && a !== undefined && a !== '') return a;
    }
    return null;
  },
  default: (val: any, fallback: any) => {
    if (val === null || val === undefined || val === '') return fallback;
    return val;
  },
};

/**
 * Checks if a string is a template or direct expression containing {{ ... }}
 */
export function isExpression(val: any): boolean {
  if (typeof val !== 'string') return false;
  return /\{\{.+?\}\}/s.test(val);
}

/**
 * Checks if a string is a single whole expression e.g. "{{ state.count }}"
 */
export function isSingleExpression(val: string): boolean {
  return /^\s*\{\{\s*(.+?)\s*\}\}\s*$/s.test(val);
}

/**
 * Evaluates an AST node with strict whitelist and safety checks
 */
/** Extra pure functions available to one evaluation (e.g. calculated-field helpers). */
export type ExpressionFunctions = Record<string, (...args: any[]) => any>;

function evaluateAstNode(node: any, scope: ExpressionScope, depth: number, functions?: ExpressionFunctions): any {
  if (depth > MAX_AST_DEPTH) {
    throw new Error(`Expression exceeds maximum AST depth of ${MAX_AST_DEPTH}`);
  }

  if (!node || typeof node !== 'object') {
    return node;
  }

  if (!WHITELISTED_NODES.has(node.type)) {
    throw new Error(`Forbidden expression node type: ${node.type}`);
  }

  switch (node.type) {
    case 'Literal':
      return node.value;

    case 'Identifier': {
      const name = node.name;
      if (BLOCKED_IDENTIFIERS.has(name)) {
        throw new Error(`Access to blocked property: ${name}`);
      }
      if (name in scope) {
        return scope[name];
      }
      if (name in PURE_FUNCTIONS) {
        return PURE_FUNCTIONS[name];
      }
      if (name === 'true') return true;
      if (name === 'false') return false;
      if (name === 'null') return null;
      if (name === 'undefined') return undefined;
      return undefined;
    }

    case 'MemberExpression': {
      const objectVal = evaluateAstNode(node.object, scope, depth + 1, functions);
      if (objectVal === null || objectVal === undefined) {
        return undefined;
      }

      let propName: string;
      if (node.computed) {
        propName = String(evaluateAstNode(node.property, scope, depth + 1, functions));
      } else {
        propName = node.property.name;
      }

      if (BLOCKED_IDENTIFIERS.has(propName)) {
        throw new Error(`Access to blocked property: ${propName}`);
      }

      return objectVal[propName];
    }

    case 'LogicalExpression':
    case 'BinaryExpression': {
      if (node.operator === '&&') {
        const leftVal = evaluateAstNode(node.left, scope, depth + 1, functions);
        return leftVal ? evaluateAstNode(node.right, scope, depth + 1, functions) : leftVal;
      }
      if (node.operator === '||') {
        const leftVal = evaluateAstNode(node.left, scope, depth + 1, functions);
        return leftVal ? leftVal : evaluateAstNode(node.right, scope, depth + 1, functions);
      }
      if (node.operator === '??') {
        const leftVal = evaluateAstNode(node.left, scope, depth + 1, functions);
        return leftVal !== null && leftVal !== undefined
          ? leftVal
          : evaluateAstNode(node.right, scope, depth + 1, functions);
      }

      const left = evaluateAstNode(node.left, scope, depth + 1, functions);
      const right = evaluateAstNode(node.right, scope, depth + 1, functions);

      switch (node.operator) {
        case '+':
          return left + right;
        case '-':
          return left - right;
        case '*':
          return left * right;
        case '/':
          return right === 0 ? 0 : left / right;
        case '%':
          return left % right;
        case '==':
          return left == right;
        case '===':
          return left === right;
        case '!=':
          return left != right;
        case '!==':
          return left !== right;
        case '<':
          return left < right;
        case '<=':
          return left <= right;
        case '>':
          return left > right;
        case '>=':
          return left >= right;
        default:
          throw new Error(`Unsupported binary operator: ${node.operator}`);
      }
    }

    case 'UnaryExpression': {
      const arg = evaluateAstNode(node.argument, scope, depth + 1, functions);
      switch (node.operator) {
        case '!':
          return !arg;
        case '-':
          return -arg;
        case '+':
          return +arg;
        default:
          throw new Error(`Unsupported unary operator: ${node.operator}`);
      }
    }

    case 'ConditionalExpression': {
      const test = evaluateAstNode(node.test, scope, depth + 1, functions);
      return test
        ? evaluateAstNode(node.consequent, scope, depth + 1, functions)
        : evaluateAstNode(node.alternate, scope, depth + 1, functions);
    }

    case 'CallExpression': {
      let fnName = '';
      if (node.callee.type === 'Identifier') {
        fnName = node.callee.name;
      } else {
        throw new Error('Only direct calls to whitelisted pure functions are allowed');
      }

      if (BLOCKED_IDENTIFIERS.has(fnName)) {
        throw new Error(`Access to blocked function: ${fnName}`);
      }

      const fn = (functions && Object.prototype.hasOwnProperty.call(functions, fnName) ? functions[fnName] : undefined)
        ?? PURE_FUNCTIONS[fnName];
      if (typeof fn !== 'function') {
        throw new Error(`Function '${fnName}' is not in pure function whitelist`);
      }

      const args = (node.arguments || []).map((argNode: any) =>
        evaluateAstNode(argNode, scope, depth + 1, functions)
      );

      return fn(...args);
    }

    case 'ArrayExpression': {
      return (node.elements || []).map((el: any) =>
        evaluateAstNode(el, scope, depth + 1, functions)
      );
    }

    default:
      throw new Error(`Unsupported AST node type: ${node.type}`);
  }
}

/**
 * Evaluates an expression string without eval or Function constructor
 */
export function evaluateRawExpression(
  rawExpr: string,
  scope: ExpressionScope,
  functions?: ExpressionFunctions
): { value: any; error: string | null } {
  const trimmed = rawExpr.trim();
  if (trimmed.length > MAX_EXPRESSION_LENGTH) {
    return {
      value: undefined,
      error: `Expression exceeds max length of ${MAX_EXPRESSION_LENGTH} characters`,
    };
  }

  // Pre-scan for blocked strings as an additional layer of security
  for (const blocked of BLOCKED_IDENTIFIERS) {
    if (new RegExp(`\\b${blocked}\\b`).test(trimmed)) {
      return { value: undefined, error: `Forbidden access to '${blocked}'` };
    }
  }

  try {
    const ast = jsep(trimmed);
    const value = evaluateAstNode(ast, scope, 0, functions);
    return { value, error: null };
  } catch (err: any) {
    return { value: undefined, error: err.message || 'Expression evaluation error' };
  }
}

/**
 * Resolves a prop value which may be:
 * - A single expression: "{{ state.selectedId }}" -> returns the exact typed value (object, boolean, number, string)
 * - An interpolated template string: "User: {{ user.name }} (ID: {{ user.id }})" -> returns evaluated string
 * - A static value or object -> returns static value
 */
export function evaluatePropValue(
  propVal: any,
  scope: ExpressionScope
): { value: any; error: string | null } {
  if (typeof propVal !== 'string' || !isExpression(propVal)) {
    return { value: propVal, error: null };
  }

  // Check if it is a single expression: {{ expr }}
  const singleMatch = propVal.match(/^\s*\{\{\s*(.+?)\s*\}\}\s*$/s);
  if (singleMatch) {
    return evaluateRawExpression(singleMatch[1], scope);
  }

  // Otherwise it's a template string with one or more {{ expr }} occurrences
  let hasError: string | null = null;
  const replaced = propVal.replace(/\{\{\s*(.+?)\s*\}\}/g, (_, innerExpr) => {
    const res = evaluateRawExpression(innerExpr, scope);
    if (res.error) {
      hasError = res.error;
      return `[Error: ${res.error}]`;
    }
    return res.value === null || res.value === undefined ? '' : String(res.value);
  });

  return { value: replaced, error: hasError };
}

const ACTION_PROP_KEYS = new Set([
  'onRowClick',
  'onClick',
  'onChangeAction',
  'onSuccess',
  'onError',
  'actions',
]);

function isActionDefinition(val: any): boolean {
  if (!val || typeof val !== 'object') return false;
  const actionTypes = [
    'setState',
    'navigate',
    'openModal',
    'closeModal',
    'createRecord',
    'updateRecord',
    'deleteRecord',
    'refetchDataSource',
    'showToast',
    'confirm',
  ];
  return typeof val.type === 'string' && actionTypes.includes(val.type);
}

/**
 * Recursively resolves all props on a node and captures errors per prop
 */
export function evaluateProps(
  props: Record<string, any>,
  scope: ExpressionScope
): { resolvedProps: Record<string, any>; propErrors: Record<string, string> } {
  const resolvedProps: Record<string, any> = {};
  const propErrors: Record<string, string> = {};

  if (!props || typeof props !== 'object') {
    return { resolvedProps: props || {}, propErrors };
  }

  for (const [key, val] of Object.entries(props)) {
    // Never pre-resolve action definitions or event handler props at render time.
    // They are executed dynamically when events fire using runtime scope (e.g. { row }).
    if (
      ACTION_PROP_KEYS.has(key) ||
      (typeof key === 'string' && key.startsWith('on') && key.length > 2 && key[2] === key[2].toUpperCase()) ||
      isActionDefinition(val) ||
      (Array.isArray(val) && val.length > 0 && isActionDefinition(val[0]))
    ) {
      resolvedProps[key] = val;
      continue;
    }

    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      const nested = evaluateProps(val, scope);
      resolvedProps[key] = nested.resolvedProps;
      for (const [nestedKey, err] of Object.entries(nested.propErrors)) {
        propErrors[`${key}.${nestedKey}`] = err;
      }
    } else if (Array.isArray(val)) {
      resolvedProps[key] = val.map((item, idx) => {
        if (item !== null && typeof item === 'object') {
          const nested = evaluateProps(item, scope);
          for (const [nestedKey, err] of Object.entries(nested.propErrors)) {
            propErrors[`${key}[${idx}].${nestedKey}`] = err;
          }
          return nested.resolvedProps;
        } else {
          const evalRes = evaluatePropValue(item, scope);
          if (evalRes.error) {
            propErrors[`${key}[${idx}]`] = evalRes.error;
          }
          return evalRes.value;
        }
      });
    } else {
      const evalRes = evaluatePropValue(val, scope);
      resolvedProps[key] = evalRes.value;
      if (evalRes.error) {
        propErrors[key] = evalRes.error;
      }
    }
  }

  return { resolvedProps, propErrors };
}

/**
 * Alias for evaluateProps with { resolved, errors } return signature
 */
export function resolveProps(
  props: Record<string, any>,
  scope: ExpressionScope
): { resolved: Record<string, any>; errors: Record<string, string> } {
  const { resolvedProps, propErrors } = evaluateProps(props, scope);
  return { resolved: resolvedProps, errors: propErrors };
}

/**
 * Evaluates an expression string directly. Throws if there is an evaluation error.
 */
export function evaluateExpression(expr: string, scope: ExpressionScope): any {
  if (!expr) return undefined;
  const target = expr.includes('{{') ? expr : `{{ ${expr} }}`;
  const res = evaluatePropValue(target, scope);
  if (res.error) {
    throw new Error(res.error);
  }
  return res.value;
}

/**
 * Resolves a template string or expression value. Throws if there is an error.
 */
export function resolveTemplate(template: string, scope: ExpressionScope): any {
  if (!template) return template;
  const res = evaluatePropValue(template, scope);
  if (res.error) {
    throw new Error(res.error);
  }
  return res.value;
}


