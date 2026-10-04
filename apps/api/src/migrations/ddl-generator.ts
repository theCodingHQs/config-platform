import type { FieldType, FieldConfig } from '@config-platform/schema';

export class UnsafeConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeConversionError';
  }
}

export function mapFieldTypeToPostgres(type: FieldType, config: FieldConfig = {}): string {
  switch (type) {
    case 'text': {
      const cfg = config as { maxLength?: number };
      return cfg.maxLength ? `VARCHAR(${cfg.maxLength})` : 'TEXT';
    }
    case 'number': {
      const cfg = config as { precision?: number; scale?: number };
      if (cfg.precision && cfg.scale) {
        return `NUMERIC(${cfg.precision}, ${cfg.scale})`;
      }
      if (cfg.precision) {
        return `NUMERIC(${cfg.precision})`;
      }
      return 'NUMERIC';
    }
    case 'boolean':
      return 'BOOLEAN';
    case 'date': {
      const cfg = config as { includeTime?: boolean };
      return cfg.includeTime ? 'TIMESTAMPTZ' : 'DATE';
    }
    case 'select':
      return 'VARCHAR(128)';
    case 'reference':
      return 'VARCHAR(64)';
    default:
      return 'TEXT';
  }
}

export interface PhysicalColumnDef {
  columnId: string;
  type: FieldType;
  required?: boolean;
  unique?: boolean;
  isPrimary?: boolean;
  config?: FieldConfig;
}

export class DDLGenerator {
  /**
   * Generates DDL for creating a new physical table named by stable ID
   */
  generateCreateTableDDL(
    schemaName: string,
    physicalTableName: string,
    columns: PhysicalColumnDef[] = []
  ): string {
    const colDefs: string[] = [
      `"id" VARCHAR(64) PRIMARY KEY DEFAULT gen_random_uuid()::text`,
      `"created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
      `"updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
    ];

    const indexes: string[] = [];

    for (const col of columns) {
      if (col.isPrimary || col.columnId === 'id') continue;
      const pgType = mapFieldTypeToPostgres(col.type, col.config);
      const notNull = col.required ? ' NOT NULL' : '';
      let defaultClause = '';
      if (col.config && 'defaultValue' in col.config && col.config.defaultValue !== undefined) {
        const val = col.config.defaultValue;
        if (typeof val === 'string') {
          defaultClause = ` DEFAULT '${val.replace(/'/g, "''")}'`;
        } else if (typeof val === 'number' || typeof val === 'boolean') {
          defaultClause = ` DEFAULT ${val}`;
        }
      }
      colDefs.push(`"${col.columnId}" ${pgType}${notNull}${defaultClause}`);

      if (col.unique) {
        indexes.push(
          `CREATE UNIQUE INDEX IF NOT EXISTS "uq_${physicalTableName}_${col.columnId}" ON "${schemaName}"."${physicalTableName}" ("${col.columnId}");`
        );
      }
    }

    const tableDDL = `CREATE TABLE IF NOT EXISTS "${schemaName}"."${physicalTableName}" (\n  ${colDefs.join(',\n  ')}\n);`;
    return [tableDDL, ...indexes].join('\n');
  }

  /**
   * Generates DDL for adding a column to an existing table
   */
  generateAddColumnDDL(
    schemaName: string,
    physicalTableName: string,
    col: PhysicalColumnDef
  ): string {
    const pgType = mapFieldTypeToPostgres(col.type, col.config);
    const notNull = col.required ? ' NOT NULL' : '';
    let defaultClause = '';
    if (col.config && 'defaultValue' in col.config && col.config.defaultValue !== undefined) {
      const val = col.config.defaultValue;
      if (typeof val === 'string') {
        defaultClause = ` DEFAULT '${val.replace(/'/g, "''")}'`;
      } else if (typeof val === 'number' || typeof val === 'boolean') {
        defaultClause = ` DEFAULT ${val}`;
      }
    }

    const sql = `ALTER TABLE "${schemaName}"."${physicalTableName}" ADD COLUMN "${col.columnId}" ${pgType}${notNull}${defaultClause};`;
    if (col.unique) {
      const indexSql = `CREATE UNIQUE INDEX IF NOT EXISTS "uq_${physicalTableName}_${col.columnId}" ON "${schemaName}"."${physicalTableName}" ("${col.columnId}");`;
      return `${sql}\n${indexSql}`;
    }
    return sql;
  }

  /**
   * Generates DDL for dropping a column
   */
  generateDropColumnDDL(
    schemaName: string,
    physicalTableName: string,
    physicalColumnName: string
  ): string {
    return `ALTER TABLE "${schemaName}"."${physicalTableName}" DROP COLUMN IF EXISTS "${physicalColumnName}" CASCADE;`;
  }

  /**
   * Generates DDL for dropping a table
   */
  generateDropTableDDL(schemaName: string, physicalTableName: string): string {
    return `DROP TABLE IF EXISTS "${schemaName}"."${physicalTableName}" CASCADE;`;
  }

  /**
   * Generates DDL for adding a foreign key constraint
   */
  generateAddForeignKeyDDL(
    schemaName: string,
    relationId: string,
    sourceTableId: string,
    sourceColumnId: string,
    targetTableId: string,
    targetColumnId: string = 'id',
    onDelete: string = 'RESTRICT'
  ): string {
    return `ALTER TABLE "${schemaName}"."${sourceTableId}" ADD CONSTRAINT "fk_${relationId}" FOREIGN KEY ("${sourceColumnId}") REFERENCES "${schemaName}"."${targetTableId}" ("${targetColumnId}") ON DELETE ${onDelete};`;
  }

  /**
   * Generates DDL for dropping a foreign key constraint
   */
  generateDropForeignKeyDDL(
    schemaName: string,
    relationId: string,
    sourceTableId: string
  ): string {
    return `ALTER TABLE "${schemaName}"."${sourceTableId}" DROP CONSTRAINT IF EXISTS "fk_${relationId}";`;
  }

  /**
   * Generates safety check query before running expand/contract type conversion
   */
  getSafetyCheckQuery(
    schemaName: string,
    physicalTableName: string,
    physicalColumnName: string,
    oldType: FieldType,
    newType: FieldType,
    config: FieldConfig = {}
  ): { query: string; params: any[]; isSafeWithoutCheck?: boolean } | null {
    if (oldType === newType) return null;

    // Conversions that are always safe
    if (newType === 'text') {
      return { query: '', params: [], isSafeWithoutCheck: true };
    }

    if (oldType === 'text' && newType === 'number') {
      // Must be numeric
      const query = `
        SELECT COUNT(*)::int AS invalid_count
        FROM "${schemaName}"."${physicalTableName}"
        WHERE "${physicalColumnName}" IS NOT NULL
          AND TRIM("${physicalColumnName}") !~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$'
      `;
      return { query, params: [] };
    }

    if (oldType === 'text' && newType === 'boolean') {
      const query = `
        SELECT COUNT(*)::int AS invalid_count
        FROM "${schemaName}"."${physicalTableName}"
        WHERE "${physicalColumnName}" IS NOT NULL
          AND LOWER(TRIM("${physicalColumnName}")) NOT IN ('true', 'false', 't', 'f', '1', '0', 'yes', 'no')
      `;
      return { query, params: [] };
    }

    if (oldType === 'text' && newType === 'select') {
      const cfg = config as { options?: Array<{ value: string }> };
      const allowed = (cfg.options || []).map((o) => o.value);
      if (allowed.length === 0) {
        return {
          query: `SELECT COUNT(*)::int AS invalid_count FROM "${schemaName}"."${physicalTableName}" WHERE "${physicalColumnName}" IS NOT NULL`,
          params: [],
        };
      }
      const placeholders = allowed.map((_, i) => `$${i + 1}`).join(', ');
      const query = `
        SELECT COUNT(*)::int AS invalid_count
        FROM "${schemaName}"."${physicalTableName}"
        WHERE "${physicalColumnName}" IS NOT NULL
          AND "${physicalColumnName}" NOT IN (${placeholders})
      `;
      return { query, params: allowed };
    }

    if (oldType === 'text' && newType === 'date') {
      // Regex check for ISO date or date-time
      const query = `
        SELECT COUNT(*)::int AS invalid_count
        FROM "${schemaName}"."${physicalTableName}"
        WHERE "${physicalColumnName}" IS NOT NULL
          AND TRIM("${physicalColumnName}") !~ '^\\d{4}-\\d{2}-\\d{2}'
      `;
      return { query, params: [] };
    }

    // Any other arbitrary conversions (e.g. boolean to number, reference to date, etc.) are unsafe by default
    throw new UnsafeConversionError(
      `Direct type conversion from '${oldType}' to '${newType}' is not supported and unsafe.`
    );
  }

  /**
   * Generates expand/contract DDL for type change:
   * 1. Add new column (c_xxxx__v2)
   * 2. Backfill from old column with safe cast
   * 3. Drop old column
   * 4. Rename new column to stable id (c_xxxx)
   */
  generateExpandContractDDL(
    schemaName: string,
    physicalTableName: string,
    physicalColumnName: string,
    oldType: FieldType,
    newType: FieldType,
    newConfig: FieldConfig = {}
  ): string {
    const tempCol = `${physicalColumnName}__v2`;
    const targetPgType = mapFieldTypeToPostgres(newType, newConfig);

    let castExpression = `"${physicalColumnName}"::${targetPgType}`;
    if (oldType === 'text' && newType === 'boolean') {
      castExpression = `(CASE WHEN LOWER(TRIM("${physicalColumnName}")) IN ('true', 't', '1', 'yes') THEN TRUE ELSE FALSE END)`;
    } else if (oldType === 'text' && newType === 'number') {
      castExpression = `TRIM("${physicalColumnName}")::${targetPgType}`;
    } else if (newType === 'text') {
      castExpression = `"${physicalColumnName}"::TEXT`;
    }

    return [
      `-- Expand: add temporary column`,
      `ALTER TABLE "${schemaName}"."${physicalTableName}" ADD COLUMN "${tempCol}" ${targetPgType};`,
      `-- Backfill: migrate existing data`,
      `UPDATE "${schemaName}"."${physicalTableName}" SET "${tempCol}" = ${castExpression};`,
      `-- Contract: drop old column and rename temporary column to preserve stable ID`,
      `ALTER TABLE "${schemaName}"."${physicalTableName}" DROP COLUMN "${physicalColumnName}" CASCADE;`,
      `ALTER TABLE "${schemaName}"."${physicalTableName}" RENAME COLUMN "${tempCol}" TO "${physicalColumnName}";`,
    ].join('\n');
  }
}

export const ddlGenerator = new DDLGenerator();
