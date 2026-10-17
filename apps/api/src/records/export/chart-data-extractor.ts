import {
  type GridChartDefinition,
  type GridExportTemplateDefinition,
  type GridSheetDefinition,
  type ChartRenderData,
  CHART_LIMITS,
} from '@config-platform/schema';
import { entityCache } from '../entity-cache.js';
import { permissionService } from '../../permissions/permission-service.js';
import {
  datasetQueryBuilder,
  GridHydrationForbiddenError,
} from './dataset-query-builder.js';
import { readRangeValues } from './chart-range-helper.js';
import type { TenantRole } from '../../auth/auth-types.js';

export class ChartDataExtractor {
  /**
   * Extracts chart render data (categories and series numbers) from either
   * a dataset source or a hydrated range source, enforcing entity and field permissions.
   */
  public async extractChartData(
    tenantId: string,
    userRole: TenantRole,
    chart: GridChartDefinition,
    template: GridExportTemplateDefinition,
    hydratedSheets: GridSheetDefinition[],
    datasetCache?: Map<string, { rows: any[]; totalCount: number }>
  ): Promise<ChartRenderData> {
    if (chart.source.kind === 'dataset') {
      const datasetId = chart.source.datasetId;
      const dataset = (template.datasets || []).find((d) => d.id === datasetId);
      if (!dataset) {
        throw new Error(`Dataset '${datasetId}' referenced by chart '${chart.id}' was not found in template`);
      }

      // 1. Verify canExport permission on base entity and joined entities
      const baseEntityDef = await entityCache.resolveEntity(tenantId, dataset.source.baseEntityId);
      if (!baseEntityDef) {
        throw new Error(`Base entity '${dataset.source.baseEntityId}' for dataset '${datasetId}' not found`);
      }
      const canExportBase = await permissionService.canExport(tenantId, baseEntityDef.entity.id, userRole);
      if (!canExportBase) {
        throw new GridHydrationForbiddenError(
          `Export forbidden: role '${userRole}' does not have export permissions on entity '${baseEntityDef.entity.name}'`
        );
      }

      if (dataset.source.joins && dataset.source.joins.length > 0) {
        for (const j of dataset.source.joins) {
          if (!j.targetEntityId) continue;
          const joinEntity = await entityCache.resolveEntity(tenantId, j.targetEntityId);
          if (joinEntity) {
            const canExportJoin = await permissionService.canExport(tenantId, joinEntity.entity.id, userRole);
            if (!canExportJoin) {
              throw new GridHydrationForbiddenError(
                `Export forbidden: role '${userRole}' does not have export permissions on joined entity '${joinEntity.entity.name}'`
              );
            }
          }
        }
      }

      // 2. Verify field visibility on referenced category and series
      const hiddenFields = await permissionService.getHiddenFieldIds(
        tenantId,
        baseEntityDef.entity.id,
        userRole
      );

      const categoryFieldId = typeof chart.source.category === 'string'
        ? chart.source.category
        : chart.source.category.fieldId;

      if (hiddenFields.has(categoryFieldId)) {
        throw new GridHydrationForbiddenError(
          `Access denied: field '${categoryFieldId}' used as chart category is hidden for role '${userRole}'`
        );
      }

      for (const s of chart.source.series) {
        if (s.fieldId && hiddenFields.has(s.fieldId)) {
          throw new GridHydrationForbiddenError(
            `Access denied: field '${s.fieldId}' used in chart series is hidden for role '${userRole}'`
          );
        }
      }

      // 3. Execute or retrieve dataset result
      let dsResult = datasetCache?.get(datasetId);
      if (!dsResult) {
        dsResult = await datasetQueryBuilder.executeDataset({
          tenantId,
          userRole,
          dataset,
          templateParameters: template.parameters || [],
          parameters: {},
          maxRows: CHART_LIMITS.MAX_POINTS_PER_SERIES + 1,
        });
        datasetCache?.set(datasetId, dsResult);
      }

      const rows = dsResult.rows || [];
      if (rows.length > CHART_LIMITS.MAX_POINTS_PER_SERIES) {
        throw new Error(
          `Dataset '${datasetId}' returned ${rows.length} points, exceeding maximum limit of ${CHART_LIMITS.MAX_POINTS_PER_SERIES} points per series`
        );
      }

      const categories = rows.map((r) => {
        const val = r[categoryFieldId];
        return val !== null && val !== undefined ? String(val) : '';
      });

      const series = chart.source.series.map((s, idx) => {
        const key = s.aggregateId || s.fieldId!;
        const seriesName = s.name || key;
        const data = rows.map((r) => {
          const num = Number(r[key]);
          return isFinite(num) ? num : 0;
        });
        return {
          name: seriesName,
          data,
          color: s.color,
          type: s.type,
        };
      });

      return { categories, series };
    }

    // Range-based chart source
    if (chart.source.kind === 'range') {
      const sheetId = chart.source.sheetId;
      const targetSheet = hydratedSheets.find((s) => s.id === sheetId || s.name === sheetId);
      if (!targetSheet) {
        throw new Error(`Sheet '${sheetId}' referenced by chart '${chart.id}' not found`);
      }

      let categories: string[] = [];
      if (chart.source.categoryRange) {
        const rawCats = readRangeValues(targetSheet.cells, chart.source.categoryRange);
        categories = rawCats.map((v) => (v !== null && v !== undefined ? String(v) : ''));
      }

      const series = chart.source.series.map((s) => {
        const rawData = readRangeValues(targetSheet.cells, s.range);
        if (rawData.length > CHART_LIMITS.MAX_POINTS_PER_SERIES) {
          throw new Error(
            `Series '${s.name}' range '${s.range}' has ${rawData.length} cells, exceeding maximum limit of ${CHART_LIMITS.MAX_POINTS_PER_SERIES} points`
          );
        }
        const numericData = rawData.map((v) => {
          const num = Number(v);
          return isFinite(num) ? num : 0;
        });
        return {
          name: s.name,
          data: numericData,
          color: s.color,
          type: s.type,
        };
      });

      // If categoryRange was omitted, generate 1-based index categories
      if (categories.length === 0 && series.length > 0) {
        const maxLen = Math.max(...series.map((s) => s.data.length), 0);
        categories = Array.from({ length: maxLen }, (_, i) => String(i + 1));
      }

      return { categories, series };
    }

    throw new Error(`Unsupported chart source kind`);
  }
}

export const chartDataExtractor = new ChartDataExtractor();
