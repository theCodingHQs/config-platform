import ExcelJS from 'exceljs';
import {
  type GridExportTemplateDefinition,
  type GridSheetDefinition,
  type GridCellDefinition,
  type GridRegionDefinition,
  type GridDatasetDefinition,
  GRID_LIMITS,
  evaluateExpression,
  migrateGridTemplateToV2,
} from '@config-platform/schema';
import { entityCache } from '../entity-cache.js';
import { permissionService } from '../../permissions/permission-service.js';
import { tenantLimitsService } from '../../limits/tenant-limits.js';
import { defaultStorageAdapter } from '../../db/storage-adapter.js';
import { queryBuilder, type QueryOptions } from '../query-builder.js';
import { gridXlsxRenderer } from './grid-xlsx-renderer.js';
import { evaluateAndCacheSheetFormulas } from './formula-evaluator.js';
import {
  datasetQueryBuilder,
  GridHydrationForbiddenError,
  GridHydrationLimitError,
} from './dataset-query-builder.js';
import { migrationService } from '../../migrations/migration-service.js';
import type { TenantRole } from '../../auth/auth-types.js';
import { chartDataExtractor } from './chart-data-extractor.js';
import { chartRenderer } from './chart-renderer.js';
import { shiftRangeByRegion } from './chart-range-helper.js';

export interface GridHydrationOptions {
  tenantId: string;
  userRole: TenantRole;
  tenantName?: string;
  userId?: string;
  userEmail?: string;
  filters?: any[];
  parameters?: any;
  maxRows?: number;
}

export {
  GridHydrationForbiddenError,
  GridHydrationLimitError,
};

/**
 * Rewrites Excel formula coordinates when rows in a repeating region are expanded by delta.
 * E.g., =SUM(D10:D15) -> =SUM(D10:D50) when region 10..15 expands by delta = 35.
 * Cells referencing rows below the region are also shifted.
 */
export function rewriteFormulaCoordinates(
  formula: string,
  regionStartRow1: number,
  regionEndRow1: number,
  delta: number
): string {
  if (!formula || delta === 0) return formula;

  // 1. Rewrite ranges: e.g. D10:D15 -> D10:D50
  let rewritten = formula.replace(
    /\b([A-Z]+)(\d+):([A-Z]+)(\d+)\b/g,
    (match, col1, r1Str, col2, r2Str) => {
      const r1 = parseInt(r1Str, 10);
      const r2 = parseInt(r2Str, 10);

      // If range spans the region (starts inside region, ends at regionEnd)
      if (r1 >= regionStartRow1 && r1 <= regionEndRow1 && r2 === regionEndRow1) {
        return `${col1}${r1}:${col2}${r2 + delta}`;
      }
      // If range is completely below the region
      if (r1 > regionEndRow1 && r2 > regionEndRow1) {
        return `${col1}${r1 + delta}:${col2}${r2 + delta}`;
      }
      return match;
    }
  );

  // 2. Rewrite standalone cell references below the region (not preceding a colon or following a colon)
  rewritten = rewritten.replace(
    /(^|[^A-Z0-9:])([A-Z]+)(\d+)(?![A-Z0-9:]|$)/g,
    (match, prefix, col, rStr) => {
      const r = parseInt(rStr, 10);
      if (r > regionEndRow1) {
        return `${prefix}${col}${r + delta}`;
      }
      return match;
    }
  );

  return rewritten;
}

/**
 * Grid Hydration Engine
 * Executes dynamic data queries for repeating regions and cell bindings,
 * applies band shifting / padding, formula range rewriting, and hidden field redaction.
 */
export class GridHydrator {
  /**
   * Produces a fully hydrated GridExportTemplateDefinition with live data,
   * padded or shifted regions, and updated formula coordinates.
   */
  public async hydrateGridDefinition(
    rawTemplate: GridExportTemplateDefinition,
    options: GridHydrationOptions
  ): Promise<GridExportTemplateDefinition> {
    const { tenantId, userRole } = options;

    // Requirement 0: Migrate v1 template if necessary without altering rendered output
    const template: GridExportTemplateDefinition =
      !rawTemplate.schemaVersion || rawTemplate.schemaVersion < 2
        ? migrateGridTemplateToV2(rawTemplate)
        : rawTemplate;

    const workspaceTimezone = await migrationService.getTenantTimezone(tenantId);
    const hydratedSheets: GridSheetDefinition[] = [];
    const hydratedCharts = template.charts ? JSON.parse(JSON.stringify(template.charts)) : [];

    // Query counter per export
    let totalQueriesExecuted = 0;
    const checkQueryCount = () => {
      totalQueriesExecuted++;
      if (totalQueriesExecuted > GRID_LIMITS.MAX_QUERIES_PER_EXPORT) {
        throw new Error(
          `Export exceeds maximum limit of ${GRID_LIMITS.MAX_QUERIES_PER_EXPORT} queries per export`
        );
      }
    };

    // Cache dataset results so multiple regions/cells referencing the same dataset don't execute multiple times
    const datasetCache = new Map<string, { rows: any[]; totalCount: number; isGrouped: boolean }>();

    const getOrExecuteDataset = async (dataset: GridDatasetDefinition) => {
      if (datasetCache.has(dataset.id)) {
        return datasetCache.get(dataset.id)!;
      }
      checkQueryCount();
      const res = await datasetQueryBuilder.executeDataset({
        tenantId,
        dataset,
        userRole,
        parameters: options.parameters || {},
        templateParameters: template.parameters || [],
        workspaceTimezone,
        exportTimezoneOverride: options.parameters?.timezone,
        maxRows: options.maxRows,
      });
      datasetCache.set(dataset.id, res);
      return res;
    };

    // Pre-bind parameter values for single-cell expressions
    const boundParams = datasetQueryBuilder.validateAndBindParameters(
      options.parameters || {},
      template.parameters || []
    );

    for (const sheetDef of template.sheets) {
      const regions = sheetDef.regions || [];
      const hydratedCells: Record<string, GridCellDefinition> = {};
      const shiftedRowHeights: Record<string, number> = {};
      const shiftedMerges: Array<{ startRow: number; endRow: number; startCol: number; endCol: number }> = [];
      const hydratedRegions: GridRegionDefinition[] = [];

      // Copy original row heights
      if (sheetDef.rowHeights) {
        for (const [rStr, h] of Object.entries(sheetDef.rowHeights)) {
          shiftedRowHeights[rStr] = h;
        }
      }

      if (regions.length > 0) {
        const region = regions[0]; // Primary repeating region
        let records: any[] = [];
        let totalCount = 0;
        let resolvedEntity: any = null;
        let hiddenFieldIds: Set<string> = new Set();

        const datasetId = region.datasetId;
        const targetDataset = datasetId
          ? (template.datasets || []).find((d) => d.id === datasetId)
          : null;

        if (targetDataset) {
          // If options.filters were passed (e.g. from export API / legacy 2B), validate hidden fields
          if (options.filters && Array.isArray(options.filters)) {
            const baseHidden = await permissionService.getHiddenFieldIds(
              tenantId,
              targetDataset.source.baseEntityId,
              userRole
            );
            for (const f of options.filters) {
              if (f.fieldId && baseHidden.has(f.fieldId)) {
                throw new GridHydrationForbiddenError(`Filter references hidden field '${f.fieldId}'`);
              }
            }
          }

          // Hydrate from dataset
          const dsResult = await getOrExecuteDataset(targetDataset);
          records = dsResult.rows;
          totalCount = dsResult.totalCount;

          // Check export limit
          await tenantLimitsService.checkExportLimit(tenantId, totalCount);

          // Get hidden field IDs for base entity
          hiddenFieldIds = await permissionService.getHiddenFieldIds(
            tenantId,
            targetDataset.source.baseEntityId,
            userRole
          );
        } else if (region.entityId) {
          // Backward compatibility for legacy entity-bound region
          const entityId = region.entityId;
          resolvedEntity = await entityCache.resolveEntity(tenantId, entityId);
          if (!resolvedEntity) {
            throw new Error(`Region entity '${entityId}' not found`);
          }

          const canExport = await permissionService.canExport(tenantId, resolvedEntity.entity.id, userRole);
          if (!canExport) {
            throw new GridHydrationForbiddenError(
              `Role '${userRole}' does not have export permission for '${resolvedEntity.entity.name}'`
            );
          }

          hiddenFieldIds = await permissionService.getHiddenFieldIds(
            tenantId,
            resolvedEntity.entity.id,
            userRole
          );

          const checkFieldForbidden = (fieldId?: string) => {
            if (fieldId && hiddenFieldIds.has(fieldId)) {
              throw new GridHydrationForbiddenError(`Filter or sort references hidden field '${fieldId}'`);
            }
          };

          if (options.filters && Array.isArray(options.filters)) {
            for (const f of options.filters) checkFieldForbidden(f.fieldId);
          }
          if (region.filter) {
            if (Array.isArray(region.filter)) {
              for (const f of region.filter) checkFieldForbidden(f?.fieldId);
            } else if (region.filter.fieldId) {
              checkFieldForbidden(region.filter.fieldId);
            }
          }
          if ((region as any).sort) {
            const s = (region as any).sort;
            if (Array.isArray(s)) {
              for (const item of s) checkFieldForbidden(item?.fieldId);
            } else if (s.fieldId) {
              checkFieldForbidden(s.fieldId);
            }
          }

          checkQueryCount();
          const schemaName = defaultStorageAdapter.getTenantSchemaName(tenantId);
          const tableName = resolvedEntity.entity.physicalTableName;

          const countRes = queryBuilder.buildCountQuery(schemaName, tableName, []);
          const countRows = await defaultStorageAdapter.query<{ total: number }>(
            tenantId,
            countRes.sql,
            countRes.params
          );
          totalCount = Number(countRows[0]?.total || 0);

          if (totalCount > GRID_LIMITS.MAX_RENDERED_DATA_ROWS) {
            throw new Error(
              `Export exceeds maximum rendered data rows cap of ${GRID_LIMITS.MAX_RENDERED_DATA_ROWS.toLocaleString()} (found ${totalCount.toLocaleString()} rows)`
            );
          }

          await tenantLimitsService.checkExportLimit(tenantId, totalCount);

          const limit = options.maxRows ? Math.min(options.maxRows, totalCount) : totalCount;
          const selectOptions: QueryOptions = {
            filters: [],
            sorts: [{ fieldName: 'id', physicalColumn: 'id', direction: 'ASC', type: 'text' }],
            limit,
            count: false,
          };
          const { sql, params } = queryBuilder.buildSelectQuery(schemaName, tableName, selectOptions);
          checkQueryCount();
          const rawRecords = await defaultStorageAdapter.query(tenantId, sql, params);
          records = rawRecords.slice(0, limit);
        }

        const estimatedCells =
          totalCount * (region.columns?.length || 1) + Object.keys(sheetDef.cells).length;
        if (estimatedCells > GRID_LIMITS.MAX_RENDERED_CELLS) {
          throw new Error(
            `Export exceeds maximum rendered cells cap of ${GRID_LIMITS.MAX_RENDERED_CELLS.toLocaleString()} (found ${estimatedCells.toLocaleString()} estimated cells)`
          );
        }

        const minRows = region.endRow - region.startRow + 1;
        const actualCount = records.length;
        const delta = Math.max(0, actualCount - minRows);

        const regionStartRow1 = region.startRow + 1;
        const regionEndRow1 = region.endRow + 1;

        // Template format row (first row of region)
        const formatRowCells: Record<number, GridCellDefinition> = {};
        for (const [coordKey, cDef] of Object.entries(sheetDef.cells)) {
          const [rStr, cStr] = coordKey.split(':');
          const r = parseInt(rStr, 10);
          const c = parseInt(cStr, 10);
          if (r === region.startRow) {
            formatRowCells[c] = cDef;
          }
        }

        // Hydrate records into region
        const totalRenderRows = Math.max(minRows, actualCount);
        for (let i = 0; i < totalRenderRows; i++) {
          const targetRow = region.startRow + i;
          const record = i < actualCount ? records[i] : null;

          // For each column mapped in region
          for (const colMapping of region.columns || []) {
            const c = colMapping.col;
            const fieldId = colMapping.fieldId;
            const formatDef = formatRowCells[c] || {};

            let val: any = '';
            if (record) {
              if (hiddenFieldIds.has(fieldId)) {
                val = ''; // Redact hidden field
              } else if (targetDataset) {
                // Find matching column in dataset row:
                // could match by alias, fieldId, or field name
                val = record[fieldId];
                if (val === undefined) {
                  const dsField = targetDataset.fields.find(
                    (f) => f.id === fieldId || f.name === fieldId || f.fieldPath === fieldId
                  );
                  if (dsField) {
                    val = record[dsField.id] ?? record[dsField.name];
                  }
                }
                if (val === undefined && fieldId) {
                  // Check groupBy fields
                  for (const [k, v] of Object.entries(record)) {
                    if (k.toLowerCase().includes(fieldId.toLowerCase())) {
                      val = v;
                      break;
                    }
                  }
                }
                if (val === undefined) val = '';
              } else if (resolvedEntity) {
                const physicalCol = resolvedEntity.fields.find(
                  (f: any) => f.id === fieldId
                )?.physicalColumnName;
                val = physicalCol && record[physicalCol] !== undefined ? record[physicalCol] : '';
              }
            }

            // Zebra styling alternate fill if enabled in format row
            let cellStyle = formatDef.style ? { ...formatDef.style } : undefined;
            if (cellStyle && i % 2 === 1) {
              cellStyle = {
                ...cellStyle,
                fill: { fgColor: '#F8FAFC' },
              };
            } else if (cellStyle && i % 2 === 0) {
              cellStyle = {
                ...cellStyle,
                fill: { fgColor: '#FFFFFF' },
              };
            }

            hydratedCells[`${targetRow}:${c}`] = {
              value: val,
              numFmt: formatDef.numFmt,
              style: cellStyle,
            };
          }
        }

        // Shift rows that appear BELOW the region by delta
        for (const [coordKey, cDef] of Object.entries(sheetDef.cells)) {
          const [rStr, cStr] = coordKey.split(':');
          const r = parseInt(rStr, 10);
          const c = parseInt(cStr, 10);

          if (r < region.startRow) {
            // Rows above region remain in place; rewrite formulas if referencing region
            let formula = cDef.formula;
            if (formula) {
              formula = rewriteFormulaCoordinates(formula, regionStartRow1, regionEndRow1, delta);
            }
            hydratedCells[`${r}:${c}`] = {
              ...cDef,
              formula,
            };
          } else if (r > region.endRow) {
            // Rows below region shifted by delta
            const newR = r + delta;
            let formula = cDef.formula;
            if (formula) {
              formula = rewriteFormulaCoordinates(formula, regionStartRow1, regionEndRow1, delta);
            }
            hydratedCells[`${newR}:${c}`] = {
              ...cDef,
              formula,
            };
            // Shift row height
            if (shiftedRowHeights[String(r)] !== undefined) {
              shiftedRowHeights[String(newR)] = shiftedRowHeights[String(r)];
              delete shiftedRowHeights[String(r)];
            }
          }
        }

        // Shift Merges
        for (const m of sheetDef.merges || []) {
          if (m.endRow < region.startRow) {
            shiftedMerges.push(m);
          } else if (m.startRow > region.endRow) {
            shiftedMerges.push({
              startRow: m.startRow + delta,
              endRow: m.endRow + delta,
              startCol: m.startCol,
              endCol: m.endCol,
            });
          }
        }

        hydratedRegions.push({
          ...region,
          endRow: region.startRow + totalRenderRows - 1,
        });

        // Shift chart anchors and range sources when regions expand
        if (delta > 0) {
          for (const ch of hydratedCharts) {
            if (ch.anchor && (ch.anchor.sheetId === sheetDef.id || ch.anchor.sheetId === sheetDef.name)) {
              if (ch.anchor.startRow > region.endRow) {
                ch.anchor.startRow += delta;
                ch.anchor.endRow += delta;
              } else if (ch.anchor.startRow >= region.startRow && ch.anchor.startRow <= region.endRow) {
                ch.anchor.endRow += delta;
              }
            }
            if (ch.source && ch.source.kind === 'range' && (ch.source.sheetId === sheetDef.id || ch.source.sheetId === sheetDef.name)) {
              if (ch.source.categoryRange) {
                ch.source.categoryRange = shiftRangeByRegion(ch.source.categoryRange, region.startRow, region.endRow, delta);
              }
              if (Array.isArray(ch.source.series)) {
                for (const s of ch.source.series) {
                  if (s.range) {
                    s.range = shiftRangeByRegion(s.range, region.startRow, region.endRow, delta);
                  }
                }
              }
            }
          }
        }
      } else {
        // No regions: copy cells as-is
        Object.assign(hydratedCells, sheetDef.cells);
        shiftedMerges.push(...(sheetDef.merges || []));
      }

      // Single-cell bindings through expression evaluator (tenant, user, date, params, datasets, aggregates)
      const exprScope = {
        tenant: {
          id: tenantId,
          name: options.tenantName || tenantId,
        },
        user: {
          id: options.userId || '',
          email: options.userEmail || '',
          role: userRole,
        },
        date: {
          now: new Date().toISOString(),
          today: new Date().toISOString().split('T')[0],
        },
        params: boundParams,
        parameters: boundParams,
      };

      for (const [coordKey, cDef] of Object.entries(hydratedCells)) {
        if (cDef.binding) {
          if (
            typeof cDef.binding === 'string' ||
            (typeof cDef.binding === 'object' && (cDef.binding as any).expression)
          ) {
            const exprStr =
              typeof cDef.binding === 'string'
                ? cDef.binding
                : (cDef.binding as any).expression;
            try {
              const evalResult = evaluateExpression(exprStr, exprScope);
              // Never concatenate into formula; strings starting with =, +, -, @ written as text
              cDef.value = evalResult;
              if (typeof evalResult === 'string' && /^\s*[=+\-@]/.test(evalResult)) {
                cDef.numFmt = '@';
              }
            } catch {
              // Expression evaluation error fallback
            }
          } else if (typeof cDef.binding === 'object') {
            const { datasetId, fieldId, aggregateId, parameterId, entityId } = cDef.binding;

            if (parameterId) {
              // Parameter binding
              cDef.value = boundParams[parameterId] ?? '';
            } else if (aggregateId && datasetId) {
              // Aggregate KPI binding (single value)
              const ds = (template.datasets || []).find((d) => d.id === datasetId);
              if (ds) {
                const dsResult = await getOrExecuteDataset(ds);
                const firstRow = dsResult.rows[0];
                const aggVal = firstRow ? firstRow[aggregateId] ?? 0 : 0;
                cDef.value = aggVal;
              }
            } else if (datasetId && fieldId) {
              // Dataset field scalar binding
              const ds = (template.datasets || []).find((d) => d.id === datasetId);
              if (ds) {
                const dsResult = await getOrExecuteDataset(ds);
                const firstRow = dsResult.rows[0];
                cDef.value = firstRow ? firstRow[fieldId] ?? '' : '';
              }
            } else if (entityId && fieldId) {
              // Legacy 2B entity binding
              const resolved = await entityCache.resolveEntity(tenantId, entityId);
              if (resolved) {
                const hidden = await permissionService.getHiddenFieldIds(
                  tenantId,
                  resolved.entity.id,
                  userRole
                );
                if (hidden.has(fieldId)) {
                  hydratedCells[coordKey] = {
                    ...cDef,
                    value: '', // Redact hidden field in scalar binding
                  };
                }
              }
            }
          }
        }
      }

      const hydratedSheet: GridSheetDefinition = {
        ...sheetDef,
        cells: hydratedCells,
        merges: shiftedMerges,
        rowHeights: Object.keys(shiftedRowHeights).length > 0 ? shiftedRowHeights : undefined,
        regions: hydratedRegions,
      };

      // Sandboxed evaluator: compute and cache formula results on shifted coordinates
      evaluateAndCacheSheetFormulas(hydratedSheet);

      hydratedSheets.push(hydratedSheet);
    }

    return {
      ...template,
      sheets: hydratedSheets,
      charts: hydratedCharts,
    };
  }

  /**
   * Hydrates a grid template with live tenant data and renders it to an ExcelJS Workbook.
   */
  public async hydrateToWorkbook(
    template: GridExportTemplateDefinition,
    options: GridHydrationOptions
  ): Promise<ExcelJS.Workbook> {
    const datasetCache = new Map<string, { rows: any[]; totalCount: number }>();
    const hydratedTemplate = await this.hydrateGridDefinition(template, options);

    const chartImages = new Map<string, Buffer>();
    if (hydratedTemplate.charts && hydratedTemplate.charts.length > 0) {
      for (const chart of hydratedTemplate.charts) {
        const chartData = await chartDataExtractor.extractChartData(
          options.tenantId,
          options.userRole,
          chart,
          hydratedTemplate,
          hydratedTemplate.sheets,
          datasetCache
        );
        const cols = Math.max(1, chart.anchor.endCol - chart.anchor.startCol + 1);
        const rows = Math.max(1, chart.anchor.endRow - chart.anchor.startRow + 1);
        const widthPx = Math.max(300, Math.min(cols * 75, 1200));
        const heightPx = Math.max(200, Math.min(rows * 24, 800));

        const pngBuffer = chartRenderer.renderToPng(
          chart,
          chartData,
          { width: widthPx, height: heightPx }
        );
        chartImages.set(chart.id, pngBuffer);
      }
    }

    return gridXlsxRenderer.renderToWorkbook(hydratedTemplate, chartImages);
  }

  public async renderHydratedToBuffer(
    template: GridExportTemplateDefinition,
    options: GridHydrationOptions
  ): Promise<Buffer> {
    const workbook = await this.hydrateToWorkbook(template, options);
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
}

export const gridHydrator = new GridHydrator();
