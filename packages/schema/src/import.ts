import { z } from 'zod';

export const DateFormatOptionSchema = z.enum(['ISO', 'DD/MM/YYYY', 'MM/DD/YYYY']);
export type DateFormatOption = z.infer<typeof DateFormatOptionSchema>;

export const DecimalSeparatorOptionSchema = z.enum(['.', ',']);
export type DecimalSeparatorOption = z.infer<typeof DecimalSeparatorOptionSchema>;

export const ImportOptionsSchema = z.object({
  sheetName: z.string().optional(),
  dateFormat: DateFormatOptionSchema.default('ISO'),
  decimalSeparator: DecimalSeparatorOptionSchema.default('.'),
  trueWords: z.array(z.string()).default(['true', 'yes', 'y', '1', 'on']),
  falseWords: z.array(z.string()).default(['false', 'no', 'n', '0', 'off']),
});
export type ImportOptions = z.infer<typeof ImportOptionsSchema>;

// Mapping: File column header -> entity field ID (or null / '__ignore__' for ignore)
export const ColumnMappingSchema = z.record(z.string(), z.string().nullable());
export type ColumnMapping = z.infer<typeof ColumnMappingSchema>;

export interface ImportPreviewResult {
  sheets: string[];
  selectedSheet: string;
  detectedColumns: string[];
  sampleRows: Record<string, any>[];
  totalRowsEstimated: number;
  suggestedMapping: Record<string, string | null>;
  unmappedRequiredFieldIds: string[];
}

export interface ImportRowError {
  row: number; // 1-based index (e.g. file row number)
  column?: string;
  message: string;
}

export interface ImportDryRunResult {
  success: boolean;
  totalRows: number;
  validRows: number;
  errorRows: number;
  errors: ImportRowError[];
  summary: string;
}

export interface ImportCommitResult {
  success: boolean;
  insertedCount: number;
}
