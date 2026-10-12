import type { ResolvedEntity } from './entity-cache.js';
import { entityCache } from './entity-cache.js';
import type { StorageAdapter } from '../db/storage-adapter.js';
import { defaultStorageAdapter } from '../db/storage-adapter.js';

export class UnknownFieldsError extends Error {
  public unknownFields: string[];
  constructor(unknownFields: string[]) {
    super(`Unknown field(s): ${unknownFields.join(', ')}`);
    this.name = 'UnknownFieldsError';
    this.unknownFields = unknownFields;
  }
}

export class RecordValidationError extends Error {
  public errors: Record<string, string>;
  constructor(errors: Record<string, string>) {
    super('Record validation failed');
    this.name = 'RecordValidationError';
    this.errors = errors;
  }
}

export class RecordValidator {
  constructor(private storage: StorageAdapter = defaultStorageAdapter) {}

  /**
   * Validates input data for create or patch operations
   */
  async validate(
    tenantId: string,
    resolvedEntity: ResolvedEntity,
    data: Record<string, any>,
    isPatch: boolean = false,
    options?: { skipReferenceDbCheck?: boolean }
  ): Promise<{ mappedPhysicalData: Record<string, any> }> {
    const errors: Record<string, string> = {};
    const unknownFields: string[] = [];
    const mappedPhysicalData: Record<string, any> = {};

    // 1. Check for unknown fields
    for (const key of Object.keys(data)) {
      if (resolvedEntity.systemFields.has(key)) {
        // Silently ignore system keys (id, created_at, updated_at) if present - never write them
        continue;
      }
      if (!resolvedEntity.fieldByName.has(key)) {
        unknownFields.push(key);
      }
    }

    if (unknownFields.length > 0) {
      throw new UnknownFieldsError(unknownFields);
    }

    // 2. Validate fields
    for (const field of resolvedEntity.fields) {
      const val = data[field.name];
      const isProvided = val !== undefined;

      // Required check
      if (!isPatch && field.required && (val === undefined || val === null || val === '')) {
        errors[field.name] = `${field.label || field.name} is required`;
        continue;
      }

      if (isPatch && field.required && isProvided && (val === null || val === '')) {
        errors[field.name] = `${field.label || field.name} cannot be empty`;
        continue;
      }

      if (!isProvided || val === null) {
        if (isProvided && val === null) {
          mappedPhysicalData[field.physicalColumnName] = null;
        }
        continue;
      }

      // Type-specific validations
      switch (field.type) {
        case 'text': {
          if (typeof val !== 'string') {
            errors[field.name] = `${field.label} must be a string`;
            break;
          }
          const cfg = (field.config || {}) as { maxLength?: number };
          if (cfg.maxLength && val.length > cfg.maxLength) {
            errors[field.name] = `${field.label} exceeds maximum length of ${cfg.maxLength}`;
            break;
          }
          mappedPhysicalData[field.physicalColumnName] = val;
          break;
        }

        case 'number': {
          const num = typeof val === 'number' ? val : Number(val);
          if (typeof val !== 'number' && (typeof val !== 'string' || isNaN(num) || val.trim() === '')) {
            errors[field.name] = `${field.label} must be a valid number`;
            break;
          }
          const cfg = (field.config || {}) as { min?: number; max?: number };
          if (cfg.min !== undefined && num < cfg.min) {
            errors[field.name] = `${field.label} must be at least ${cfg.min}`;
            break;
          }
          if (cfg.max !== undefined && num > cfg.max) {
            errors[field.name] = `${field.label} must be at most ${cfg.max}`;
            break;
          }
          mappedPhysicalData[field.physicalColumnName] = num;
          break;
        }

        case 'boolean': {
          if (typeof val !== 'boolean') {
            if (val === 'true' || val === 1) {
              mappedPhysicalData[field.physicalColumnName] = true;
            } else if (val === 'false' || val === 0) {
              mappedPhysicalData[field.physicalColumnName] = false;
            } else {
              errors[field.name] = `${field.label} must be a boolean`;
            }
            break;
          }
          mappedPhysicalData[field.physicalColumnName] = val;
          break;
        }

        case 'date': {
          const parsed = Date.parse(val);
          if (isNaN(parsed)) {
            errors[field.name] = `${field.label} must be a valid ISO date`;
            break;
          }
          mappedPhysicalData[field.physicalColumnName] = new Date(parsed).toISOString();
          break;
        }

        case 'select': {
          if (typeof val !== 'string') {
            errors[field.name] = `${field.label} must be a string`;
            break;
          }
          const cfg = (field.config || {}) as { options?: Array<{ value: string; label?: string }> };
          const allowedOptions = (cfg.options || []).map((o) => o.value);
          if (allowedOptions.length > 0 && !allowedOptions.includes(val)) {
            errors[field.name] = `${field.label} must be one of: ${allowedOptions.join(', ')}`;
            break;
          }
          mappedPhysicalData[field.physicalColumnName] = val;
          break;
        }

        case 'reference': {
          if (typeof val !== 'string' || val.trim() === '') {
            errors[field.name] = `${field.label} must be a valid reference ID`;
            break;
          }

          const cfg = (field.config || {}) as { targetEntityId: string };
          if (!cfg.targetEntityId) {
            errors[field.name] = `Reference target entity is not configured`;
            break;
          }

          if (options?.skipReferenceDbCheck) {
            mappedPhysicalData[field.physicalColumnName] = val;
            break;
          }

          // Check if referenced record exists in target entity
          try {
            const targetEntity = await entityCache.resolveEntity(tenantId, cfg.targetEntityId);
            const targetTable = this.storage.getPhysicalTableName(
              tenantId,
              targetEntity.entity.physicalTableName
            );

            const existsRows = await this.storage.query<{ count: number }>(
              tenantId,
              `SELECT 1 FROM ${targetTable} WHERE id = $1 LIMIT 1`,
              [val]
            );

            if (existsRows.length === 0) {
              errors[field.name] = `Referenced record with id '${val}' does not exist in target entity '${targetEntity.entity.label || targetEntity.entity.name}'`;
              break;
            }

            mappedPhysicalData[field.physicalColumnName] = val;
          } catch (err: any) {
            errors[field.name] = `Unable to verify reference: ${err.message}`;
          }
          break;
        }

        default:
          mappedPhysicalData[field.physicalColumnName] = val;
      }
    }

    if (Object.keys(errors).length > 0) {
      throw new RecordValidationError(errors);
    }

    return { mappedPhysicalData };
  }
}

export const recordValidator = new RecordValidator();
