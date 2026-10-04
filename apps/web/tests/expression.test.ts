import { describe, it, expect } from 'vitest';
import {
  evaluateRawExpression,
  evaluatePropValue,
  evaluateProps,
  MAX_EXPRESSION_LENGTH,
  MAX_AST_DEPTH,
  type ExpressionScope,
} from '@config-platform/schema';

describe('Expression Evaluator', () => {
  const scope: ExpressionScope = {
    state: {
      selectedId: 'rec_123',
      count: 42,
      price: 19.99,
      tags: ['alpha', 'beta'],
      user: { name: 'Alice', role: 'admin' },
      isActive: true,
      emptyVal: null,
    },
    params: {
      id: 'param_999',
    },
    row: {
      speed: 450,
      machineName: 'Milling Machine',
    },
    ds: {
      machines: {
        total: 5,
        items: [{ id: '1', name: 'M1' }],
      },
    },
    user: {
      id: 'usr_007',
      email: 'alice@example.com',
    },
  };

  describe('Valid Expressions & Scopes', () => {
    it('evaluates state and params scopes correctly', () => {
      expect(evaluateRawExpression('state.selectedId', scope)).toEqual({
        value: 'rec_123',
        error: null,
      });

      expect(evaluateRawExpression('params.id', scope)).toEqual({
        value: 'param_999',
        error: null,
      });
    });

    it('evaluates row, ds, and user scopes correctly', () => {
      expect(evaluateRawExpression('row.speed * 2', scope)).toEqual({
        value: 900,
        error: null,
      });

      expect(evaluateRawExpression('ds.machines.total', scope)).toEqual({
        value: 5,
        error: null,
      });

      expect(evaluateRawExpression('user.email', scope)).toEqual({
        value: 'alice@example.com',
        error: null,
      });
    });

    it('evaluates binary, unary, logical, and conditional expressions', () => {
      expect(evaluateRawExpression('state.count + 8', scope).value).toBe(50);
      expect(evaluateRawExpression('!state.isActive', scope).value).toBe(false);
      expect(evaluateRawExpression('state.isActive && state.count > 40', scope).value).toBe(true);
      expect(evaluateRawExpression('state.count > 50 ? "High" : "Normal"', scope).value).toBe('Normal');
      expect(evaluateRawExpression('state.emptyVal ?? "Fallback"', scope).value).toBe('Fallback');
    });

    it('evaluates whitelisted pure functions', () => {
      expect(evaluateRawExpression('upper(state.user.name)', scope).value).toBe('ALICE');
      expect(evaluateRawExpression('lower("HELLO WORLD")', scope).value).toBe('hello world');
      expect(evaluateRawExpression('concat(row.machineName, " - ", state.selectedId)', scope).value).toBe(
        'Milling Machine - rec_123'
      );
      expect(evaluateRawExpression('round(state.price, 1)', scope).value).toBe(20.0);
      expect(evaluateRawExpression('min(10, 5, 20)', scope).value).toBe(5);
      expect(evaluateRawExpression('max(10, 5, 20)', scope).value).toBe(20);
      expect(evaluateRawExpression('coalesce(state.emptyVal, state.user.name)', scope).value).toBe('Alice');
      expect(evaluateRawExpression('default(state.emptyVal, "default_val")', scope).value).toBe('default_val');
    });

    it('resolves template strings with evaluatePropValue', () => {
      const template = 'Welcome, {{ upper(user.email) }}! Your count is {{ state.count + 1 }}.';
      const res = evaluatePropValue(template, scope);
      expect(res.error).toBeNull();
      expect(res.value).toBe('Welcome, ALICE@EXAMPLE.COM! Your count is 43.');
    });

    it('resolves single typed expression without stringification', () => {
      const resBool = evaluatePropValue('{{ state.isActive }}', scope);
      expect(resBool.value).toBe(true);

      const resNum = evaluatePropValue('{{ state.count * 10 }}', scope);
      expect(resNum.value).toBe(420);

      const resObj = evaluatePropValue('{{ state.user }}', scope);
      expect(resObj.value).toEqual({ name: 'Alice', role: 'admin' });
    });
  });

  describe('Security & Blocked Access', () => {
    it('blocks access to __proto__, constructor, and prototype', () => {
      const protoRes = evaluateRawExpression('state.__proto__', scope);
      expect(protoRes.error).toMatch(/Forbidden access|blocked/i);

      const constrRes = evaluateRawExpression('state.constructor', scope);
      expect(constrRes.error).toMatch(/Forbidden access|blocked/i);

      const protoPropRes = evaluateRawExpression('state.prototype', scope);
      expect(protoPropRes.error).toMatch(/Forbidden access|blocked/i);
    });

    it('blocks eval, Function, window, process and unwhitelisted functions', () => {
      expect(evaluateRawExpression('eval("1+1")', scope).error).toBeTruthy();
      expect(evaluateRawExpression('Function("return 1")()', scope).error).toBeTruthy();
      expect(evaluateRawExpression('alert("hack")', scope).error).toMatch(/whitelist/i);
      expect(evaluateRawExpression('fetch("http://evil.com")', scope).error).toMatch(/whitelist/i);
    });

    it('blocks assignments and forbidden AST node types', () => {
      // In jsep assignment operators throw or are forbidden
      const assignRes = evaluateRawExpression('state.count = 100', scope);
      expect(assignRes.error).toBeTruthy();
    });
  });

  describe('Safety Limits', () => {
    it('enforces maximum expression length limit', () => {
      const longExpr = 'a'.repeat(MAX_EXPRESSION_LENGTH + 1);
      const res = evaluateRawExpression(longExpr, scope);
      expect(res.error).toMatch(/max length/i);
    });

    it('enforces maximum AST depth limit', () => {
      // Deeply nested expression: (((((((((((1 + 1)))))))))))
      let deepExpr = '1';
      for (let i = 0; i < MAX_AST_DEPTH + 5; i++) {
        deepExpr = `(1 + ${deepExpr})`;
      }
      const res = evaluateRawExpression(deepExpr, scope);
      expect(res.error).toMatch(/maximum AST depth/i);
    });
  });

  describe('Per-Prop Error Capture', () => {
    it('captures errors per prop on a node props object without throwing', () => {
      const nodeProps = {
        title: 'User: {{ state.user.name }}',
        goodCount: '{{ state.count + 1 }}',
        badSyntax: '{{ state.invalid +* 5 }}',
        forbiddenProp: '{{ state.__proto__.polluted }}',
        nested: {
          validLabel: 'Status: {{ upper("ok") }}',
          badFunc: '{{ dangerousExploit() }}',
        },
      };

      const { resolvedProps, propErrors } = evaluateProps(nodeProps, scope);

      // Valid props are resolved
      expect(resolvedProps.title).toBe('User: Alice');
      expect(resolvedProps.goodCount).toBe(43);
      expect(resolvedProps.nested.validLabel).toBe('Status: OK');

      // Errors captured per prop key
      expect(propErrors['badSyntax']).toBeDefined();
      expect(propErrors['forbiddenProp']).toBeDefined();
      expect(propErrors['nested.badFunc']).toBeDefined();
      expect(propErrors['title']).toBeUndefined();
      expect(propErrors['goodCount']).toBeUndefined();
    });
  });
});
