import { describe, it, expect } from 'vitest';
import { Univer, UniverInstanceType, LocaleType, ICommandService, CommandType } from '@univerjs/core';
import { UniverFormulaEnginePlugin } from '@univerjs/engine-formula';
import { UniverSheetsPlugin } from '@univerjs/sheets';
import { UniverSheetsFormulaPlugin, CalculationMode } from '@univerjs/sheets-formula';
import { UniverDataValidationPlugin } from '@univerjs/data-validation';
import { UniverSheetsDataValidationPlugin } from '@univerjs/sheets-data-validation';
import { buildProductionTrackerTemplate, type GridExportTemplateDefinition } from '@config-platform/schema';
import { gridTemplateToUniver } from '../src/studio/export-grid/univer-adapter';

/**
 * Loads a template the way the designer does (adapter → Univer with forced formula computation and
 * checkbox validation) and returns every formula cell's computed value plus the mutations that
 * would mark the designer dirty.
 */
async function loadInUniver(template: GridExportTemplateDefinition) {
  const univer = new Univer({ locale: LocaleType.EN_US });
  univer.registerPlugin(UniverFormulaEnginePlugin);
  univer.registerPlugin(UniverSheetsPlugin);
  univer.registerPlugin(UniverSheetsFormulaPlugin, { initialFormulaComputing: CalculationMode.FORCED } as any);
  univer.registerPlugin(UniverDataValidationPlugin);
  univer.registerPlugin(UniverSheetsDataValidationPlugin);

  const userMutations: string[] = [];
  const commands = (univer as any).__getInjector().get(ICommandService);
  commands.onCommandExecuted((info: any, options?: { onlyLocal?: boolean }) => {
    if (info.type === CommandType.MUTATION && !options?.onlyLocal) userMutations.push(info.id);
  });

  const data = gridTemplateToUniver(template, { designView: true });
  const wb: any = univer.createUnit(UniverInstanceType.UNIVER_SHEET, data);
  await new Promise((r) => setTimeout(r, 1500));

  const sheetId = template.sheets[0].id;
  const matrix = wb.getSheetBySheetId(sheetId).getCellMatrix();
  const values: Record<string, any> = {};
  for (const coord of Object.keys(template.sheets[0].cells)) {
    if (!template.sheets[0].cells[coord].formula) continue;
    const [r, c] = coord.split(':').map(Number);
    values[coord] = matrix.getValue(r, c)?.v;
  }
  univer.dispose();
  return { values, userMutations };
}

const errorsIn = (values: Record<string, any>) =>
  Object.entries(values).filter(([, v]) => typeof v === 'string' && v.startsWith('#'));

describe('Production tracker formulas in the Univer engine (designer)', () => {
  it('data-bound template: placeholders in design view produce no formula errors', async () => {
    const template = buildProductionTrackerTemplate({
      productionEntityId: 't_sheet',
      machineEntityId: 't_machine',
      machineRefFieldId: 'f_machine',
      defaultMonth: '2026-10-01',
    });
    const { values, userMutations } = await loadInUniver(template);
    expect(errorsIn(values)).toEqual([]);
    expect(Number(values['20:34'])).toBe(0); // GAP
    expect(Number(values['20:35'])).toBe(0); // ATTAIN.
    expect(Number(values['3:18'])).toBe(0); // TARGETS MISSED
    // Loading (including the forced recalculation) must not count as an unsaved edit
    expect(userMutations).toEqual([]);
  }, 20000);

  it('sample template: computes the same per-row values as the export', async () => {
    const template = buildProductionTrackerTemplate();
    const { values } = await loadInUniver(template);
    expect(errorsIn(values)).toEqual([]);
    const met = Number(values['20:33']);
    expect(met).toBeGreaterThan(0);
    expect(Number(values['20:34'])).toBe(26 - met); // GAP = plan - met
    expect(Number(values['20:35'])).toBe(Math.round((met / 26) * 100) / 100); // ATTAIN.
  }, 20000);
});
