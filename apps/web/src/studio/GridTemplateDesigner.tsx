import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Save,
  Upload,
  Download,
  Undo2,
  Redo2,
  AlertTriangle,
  Check,
  RefreshCw,
  AlertCircle,
  FileSpreadsheet,
  Layers,
  Database,
  Unlink,
  Link as LinkIcon,
  Eye,
  Edit3,
  Plus,
  Trash2,
  Table,
  Sliders,
  Play,
  Calculator,
  Sparkles,
} from 'lucide-react';
import {
  getExportTemplate,
  updateExportTemplate,
  publishExportTemplate,
  downloadExportTemplateRenderPreview,
  fetchExportTemplatePreviewData,
  fetchDatasetPreview,
  type ExportTemplateItem,
} from '../api/client';
import {
  validateGridCaps,
  validateGridFormulas,
  detectUnsupportedContent,
  buildExecutiveReportTemplate,
  type GridExportTemplateDefinition,
  type GridRegionDefinition,
  type GridDatasetDefinition,
  type GridDatasetJoin,
  type GridDatasetField,
  type GridDatasetAggregate,
  type GridParameterDefinition,
} from '@config-platform/schema';
import { gridTemplateToUniver, univerToGridTemplate } from './export-grid/univer-adapter';
import { useOptionalMetadata } from '../context/metadata-context';

// Univer styles
import '@univerjs/design/lib/index.css';
import '@univerjs/ui/lib/index.css';
import '@univerjs/docs-ui/lib/index.css';
import '@univerjs/sheets-ui/lib/index.css';
import '@univerjs/sheets-formula-ui/lib/index.css';
import '@univerjs/sheets-numfmt-ui/lib/index.css';

// Univer core classes
import {
  Univer,
  LocaleType,
  UniverInstanceType,
  ICommandService,
  IUniverInstanceService,
  CommandType,
  UndoCommand,
  RedoCommand,
  mergeLocales,
} from '@univerjs/core';
import { defaultTheme } from '@univerjs/presets';
import { UniverRenderEnginePlugin } from '@univerjs/engine-render';
import { UniverFormulaEnginePlugin, FUNCTION_LIST } from '@univerjs/engine-formula';
import { UniverDocsPlugin } from '@univerjs/docs';
import { UniverDocsUIPlugin } from '@univerjs/docs-ui';
import { UniverSheetsPlugin } from '@univerjs/sheets';
import { UniverSheetsFormulaPlugin } from '@univerjs/sheets-formula';
import { UniverSheetsNumfmtPlugin } from '@univerjs/sheets-numfmt';
import { UniverUIPlugin } from '@univerjs/ui';
import { UniverSheetsUIPlugin } from '@univerjs/sheets-ui';
import { UniverSheetsFormulaUIPlugin } from '@univerjs/sheets-formula-ui';
import { UniverSheetsNumfmtUIPlugin } from '@univerjs/sheets-numfmt-ui';
import SheetsEnUS from '@univerjs/sheets/locale/en-US';
import SheetsUIEnUS from '@univerjs/sheets-ui/locale/en-US';
import UIEnUS from '@univerjs/ui/locale/en-US';
import FormulaEnUS from '@univerjs/engine-formula/locale/en-US';
import DocsUIEnUS from '@univerjs/docs-ui/locale/en-US';
import DesignEnUS from '@univerjs/design/locale/en-US';
import SheetsFormulaEnUS from '@univerjs/sheets-formula/locale/en-US';
import SheetsFormulaUIEnUS from '@univerjs/sheets-formula-ui/locale/en-US';
import SheetsNumfmtUIEnUS from '@univerjs/sheets-numfmt-ui/locale/en-US';

export function GridTemplateDesigner() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const metadata = useOptionalMetadata();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const univerRef = useRef<Univer | null>(null);
  const workbookRef = useRef<any>(null);
  const commandServiceRef = useRef<any>(null);

  const [template, setTemplate] = useState<ExportTemplateItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  // View Mode: 'design' vs 'preview' (live tenant data preview)
  const [viewMode, setViewMode] = useState<'design' | 'preview'>('design');
  const [loadingPreviewData, setLoadingPreviewData] = useState(false);

  // Side panel state: 'datasets' vs 'fields' vs 'regions'
  const [sidePanelTab, setSidePanelTab] = useState<'datasets' | 'fields' | 'regions'>('datasets');
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>('');

  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number }>({ row: 0, col: 0 });
  const selectedCellRef = useRef<{ row: number; col: number }>({ row: 0, col: 0 });

  const handleSelectionChange = useCallback((row: number, col: number) => {
    if (selectedCellRef.current.row !== row || selectedCellRef.current.col !== col) {
      selectedCellRef.current = { row, col };
      setSelectedCell({ row, col });
    }
  }, []);

  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [unsupportedWarnings, setUnsupportedWarnings] = useState<string[]>([]);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [boundCellNotice, setBoundCellNotice] = useState<string | null>(null);

  // Dataset Preview state
  const [previewRows, setPreviewRows] = useState<any[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Form states for adding items in datasets
  const [newComputedName, setNewComputedName] = useState('');
  const [newComputedExpr, setNewComputedExpr] = useState('');
  const [newAggName, setNewAggName] = useState('');
  const [newAggFn, setNewAggFn] = useState<'sum' | 'avg' | 'min' | 'max' | 'count' | 'count_distinct'>('sum');
  const [newAggField, setNewAggField] = useState('');
  const [newParamName, setNewParamName] = useState('');
  const [newParamType, setNewParamType] = useState<string>('text');
  const [newParamRequired, setNewParamRequired] = useState(false);
  const [selectedRefFieldForJoin, setSelectedRefFieldForJoin] = useState('');

  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    if (type === 'success') {
      setTimeout(() => setNotification(null), 4000);
    }
  };

  // Automatically update boundCellNotice when selectedCell changes
  useEffect(() => {
    if (!selectedCell || !template) return;
    const sheet = template.draft?.kind === 'grid' ? template.draft.sheets?.[0] : null;
    const coord = `${selectedCell.row}:${selectedCell.col}`;
    const cell = sheet?.cells?.[coord];
    if (cell?.binding) {
      const b = cell.binding;
      const label = typeof b === 'object' ? b.displayLabel || b.fieldId || b.aggregateId || b.parameterId : String(b);
      setBoundCellNotice(`This cell is bound to ${label}; edit the binding in the panel.`);
      return;
    }

    // Check if cell is in a repeating region column
    const inRegion = (sheet?.regions || []).find(
      (r: any) =>
        selectedCell.row >= r.startRow &&
        selectedCell.row <= r.endRow &&
        selectedCell.col >= r.startCol &&
        selectedCell.col <= r.endCol
    );
    if (inRegion) {
      const colDef = inRegion.columns?.find((c: any) => c.col === selectedCell.col);
      if (colDef) {
        setBoundCellNotice(`This cell is bound to ${colDef.displayLabel || colDef.fieldId}; edit the binding in the panel.`);
        return;
      }
    }

    setBoundCellNotice(null);
  }, [selectedCell, template]);

  // ─── Fetch Template ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!id) return;
    let isMounted = true;
    setLoading(true);

    getExportTemplate(id)
      .then((tpl) => {
        if (!isMounted) return;
        setTemplate(tpl);

        // Ensure datasets array exists
        const draft = tpl.draft as any;
        if (draft && draft.kind === 'grid') {
          if (!Array.isArray(draft.datasets)) {
            draft.datasets = [];
          }
          if (draft.datasets.length > 0 && !selectedDatasetId) {
            setSelectedDatasetId(draft.datasets[0].id);
          }
        }

        // Check unsupported content on initial draft load
        const warnings = detectUnsupportedContent(tpl.draft);
        if (warnings.length > 0) {
          setUnsupportedWarnings(warnings);
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        showNotification('error', err.message || 'Failed to load export template');
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [id]);

  // ─── Initialize Univer Engine ──────────────────────────────────────────────
  const initUniverWithData = useCallback((data: any) => {
    if (!containerRef.current) return;

    // If Univer instance is already running, hot-swap the workbook unit cleanly without destroying UI/plugins
    if (univerRef.current) {
      try {
        const instanceService = (univerRef.current as any).__getInjector?.().get(IUniverInstanceService);
        if (instanceService) {
          if (workbookRef.current) {
            try {
              instanceService.disposeUnit(workbookRef.current.getUnitId());
            } catch (dispErr) {
              console.warn('Error disposing unit:', dispErr);
            }
          }
          const unitData = { ...data, id: `workbook_grid_${Date.now()}` };
          const newWorkbook = univerRef.current.createUnit(UniverInstanceType.UNIVER_SHEET, unitData);
          workbookRef.current = newWorkbook;
          instanceService.focusUnit(newWorkbook.getUnitId());
          return;
        }
      } catch (err) {
        console.warn('Failed to hot-swap workbook unit, falling back to clean init:', err);
      }
    }

    if (univerRef.current) {
      try {
        univerRef.current.dispose();
      } catch (e) {
        console.warn('Error during Univer dispose:', e);
      }
      univerRef.current = null;
      workbookRef.current = null;
      commandServiceRef.current = null;
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    }

    try {
      const univer = new Univer({
        theme: defaultTheme,
        locale: LocaleType.EN_US,
        locales: {
          [LocaleType.EN_US]: mergeLocales(
            SheetsEnUS,
            SheetsUIEnUS,
            UIEnUS,
            FormulaEnUS,
            DocsUIEnUS,
            DesignEnUS,
            SheetsFormulaEnUS,
            SheetsFormulaUIEnUS,
            SheetsNumfmtUIEnUS
          ),
        },
        ...({ telemetry: false } as any),
      });

      univer.registerPlugin(UniverRenderEnginePlugin);
      univer.registerPlugin(UniverFormulaEnginePlugin);

      const hiddenMenuConfig = {
        'sheet.menu.insert-image': { hidden: true },
        'sheet.menu.chart': { hidden: true },
        'sheet.menu.comment': { hidden: true },
        'sheet.menu.data-validation': { hidden: true },
        'sheet.menu.pivot-table': { hidden: true },
        'sheet.menu.permission': { hidden: true },
        'sheet.menu.protect-sheet': { hidden: true },
      };

      if (typeof process !== 'undefined' && process.env.NODE_ENV === 'test') {
        univer.registerPlugin(UniverSheetsPlugin);
      } else {
        univer.registerPlugin(UniverUIPlugin, {
          container: containerRef.current,
          menu: hiddenMenuConfig,
        });
        univer.registerPlugin(UniverDocsPlugin, { hasScroll: false });
        univer.registerPlugin(UniverDocsUIPlugin);
        univer.registerPlugin(UniverSheetsPlugin);
        univer.registerPlugin(UniverSheetsUIPlugin, { menu: hiddenMenuConfig });
        univer.registerPlugin(UniverSheetsNumfmtPlugin);
        univer.registerPlugin(UniverSheetsNumfmtUIPlugin);
        univer.registerPlugin(UniverSheetsFormulaPlugin, { description: FUNCTION_LIST });
        univer.registerPlugin(UniverSheetsFormulaUIPlugin);
      }

      const workbook = univer.createUnit(UniverInstanceType.UNIVER_SHEET, data);
      univerRef.current = univer;
      workbookRef.current = workbook;

      const commandService = (univer as any).__getInjector?.().get(ICommandService);
      if (commandService) {
        commandServiceRef.current = commandService;
        commandService.onCommandExecuted((cmdInfo: any) => {
          if (!cmdInfo) return;
          if (cmdInfo.type === CommandType.MUTATION) {
            setHasUnsavedChanges(true);

            if (workbookRef.current) {
              const snapshot = workbookRef.current.getSnapshot();
              const activeSheetId = snapshot.sheetOrder?.[0] || Object.keys(snapshot.sheets || {})[0];
              const activeSheet = snapshot.sheets?.[activeSheetId];
              const curPos = selectedCellRef.current;
              const cell = activeSheet?.cellData?.[curPos.row]?.[curPos.col];
              if (cell?.custom?.binding) {
                const b = cell.custom.binding;
                const label = typeof b === 'object' ? b.displayLabel || b.fieldId || b.aggregateId : String(b);
                setBoundCellNotice(`This cell is bound to ${label}; edit the binding in the panel.`);
              }
            }
          }

          // Track selection range
          const params = cmdInfo.params;
          if (params?.range) {
            handleSelectionChange(params.range.startRow, params.range.startColumn);
          } else if (params?.selections?.[0]?.range) {
            handleSelectionChange(
              params.selections[0].range.startRow,
              params.selections[0].range.startColumn
            );
          }
        });
      }
    } catch (err) {
      console.error('Failed to initialize Univer:', err);
    }
  }, [handleSelectionChange]);

  const templateId = template?.id;
  useEffect(() => {
    if (!templateId || !template?.draft || template.draft.kind !== 'grid') return;

    if (!univerRef.current) {
      const draftDef = template.draft as GridExportTemplateDefinition;
      const univerData = gridTemplateToUniver(draftDef, { designView: true });
      initUniverWithData(univerData);
    }
  }, [templateId, template?.draft, initUniverWithData]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (univerRef.current) {
        try {
          univerRef.current.dispose();
        } catch {
          // ignore
        }
        univerRef.current = null;
        workbookRef.current = null;
        commandServiceRef.current = null;
      }
    };
  }, []);

  // ─── Extract & Validate Grid Draft ─────────────────────────────────────────
  const extractAndValidateGridDraft = (): {
    draft: GridExportTemplateDefinition | null;
    errors: string[];
  } => {
    let gridDraft: GridExportTemplateDefinition;
    if (workbookRef.current) {
      const snapshot = workbookRef.current.getSnapshot();
      const unsupported = detectUnsupportedContent(snapshot);
      if (unsupported.length > 0) {
        setUnsupportedWarnings(unsupported);
      }
      gridDraft = univerToGridTemplate(snapshot);
    } else if (template?.draft?.kind === 'grid') {
      gridDraft = template.draft as GridExportTemplateDefinition;
    } else {
      return { draft: null, errors: ['Spreadsheet editor is not initialized'] };
    }

    // Preserve template-level schemaVersion, datasets, and parameters
    gridDraft.schemaVersion = (template?.draft as any)?.schemaVersion || 2;
    gridDraft.datasets = (template?.draft as any)?.datasets || [];
    gridDraft.parameters = (template?.draft as any)?.parameters || [];

    // 1. Check Caps
    const capsCheck = validateGridCaps(gridDraft);
    if (!capsCheck.valid) {
      return { draft: null, errors: capsCheck.errors };
    }

    // 2. Check Formulas
    const formulaCheck = validateGridFormulas(gridDraft);
    if (!formulaCheck.valid) {
      return { draft: null, errors: formulaCheck.errors };
    }

    // 3. Validate datasets against metadata entities
    if (metadata?.entities && metadata.entities.length > 0) {
      const entityMap = new Map<string, any>(metadata.entities.map((e: any) => [e.id, e]));
      const datasetIds = new Set((gridDraft.datasets || []).map((d) => d.id));

      for (const ds of gridDraft.datasets || []) {
        if (!entityMap.has(ds.source.baseEntityId)) {
          return {
            draft: null,
            errors: [`Dataset '${ds.name}' references unknown entity '${ds.source.baseEntityId}'`],
          };
        }

        // Validate joins
        for (const j of ds.source.joins || []) {
          if (j.targetEntityId && !entityMap.has(j.targetEntityId)) {
            return {
              draft: null,
              errors: [`Join in dataset '${ds.name}' references unknown entity '${j.targetEntityId}'`],
            };
          }
        }
      }

      // 4. Validate cell and region bindings
      for (const sheet of gridDraft.sheets) {
        for (const [coord, cDef] of Object.entries(sheet.cells)) {
          if (cDef.binding && typeof cDef.binding === 'object') {
            const { datasetId, entityId, fieldId } = cDef.binding;
            if (datasetId) {
              if (!datasetIds.has(datasetId)) {
                return {
                  draft: null,
                  errors: [`Binding references unknown dataset '${datasetId}' at cell ${coord}`],
                };
              }
              const ds = (gridDraft.datasets || []).find((d) => d.id === datasetId);
              if (ds && fieldId && !ds.fields?.some((f) => f.id === fieldId || f.name === fieldId)) {
                return {
                  draft: null,
                  errors: [`Binding references unknown field '${fieldId}' in dataset '${ds.name}' at cell ${coord}`],
                };
              }
            }
            if (entityId) {
              const ent = entityMap.get(entityId);
              if (!ent) {
                return {
                  draft: null,
                  errors: [`Binding references unknown entity '${entityId}' at cell ${coord}`],
                };
              }
              const entFields = ent.fields || ent.columns || [];
              if (fieldId && entFields.length > 0 && !entFields.some((f: any) => f.id === fieldId || f.name === fieldId)) {
                return {
                  draft: null,
                  errors: [`Binding references unknown field '${fieldId}' in entity '${ent.name || entityId}' at cell ${coord}`],
                };
              }
            }
          }
        }

        for (const reg of sheet.regions || []) {
          if (reg.datasetId) {
            if (!datasetIds.has(reg.datasetId)) {
              return {
                draft: null,
                errors: [`Region '${reg.id}' references unknown dataset '${reg.datasetId}'`],
              };
            }
            const ds = (gridDraft.datasets || []).find((d) => d.id === reg.datasetId);
            if (ds && reg.columns) {
              for (const col of reg.columns) {
                if (col.fieldId && !ds.fields?.some((f) => f.id === col.fieldId || f.name === col.fieldId)) {
                  return {
                    draft: null,
                    errors: [`Region '${reg.id}' references unknown field '${col.fieldId}' in dataset '${ds.name}'`],
                  };
                }
              }
            }
          } else if (reg.entityId) {
            const ent = entityMap.get(reg.entityId);
            if (!ent) {
              return {
                draft: null,
                errors: [`Region '${reg.id}' references unknown entity '${reg.entityId}'`],
              };
            }
            const entFields = ent.fields || ent.columns || [];
            if (reg.columns && entFields.length > 0) {
              for (const col of reg.columns) {
                if (col.fieldId && !entFields.some((f: any) => f.id === col.fieldId || f.name === col.fieldId)) {
                  return {
                    draft: null,
                    errors: [`Region '${reg.id}' references unknown field '${col.fieldId}' in entity '${ent.name || reg.entityId}'`],
                  };
                }
              }
            }
          }
        }
      }
    }

    return { draft: gridDraft, errors: [] };
  };

  // ─── Save Draft ────────────────────────────────────────────────────────────
  const handleSaveDraft = async () => {
    if (!id || !template) return;
    const { draft, errors } = extractAndValidateGridDraft();
    if (errors.length > 0 || !draft) {
      showNotification('error', errors.join('; '));
      return;
    }

    setSaving(true);
    try {
      const updated = await updateExportTemplate(id, {
        name: template.name,
        draft,
      });
      setTemplate(updated);
      setHasUnsavedChanges(false);
      showNotification('success', 'Draft saved successfully');
    } catch (err: any) {
      showNotification('error', err.message || 'Failed to save draft');
    } finally {
      setSaving(false);
    }
  };

  // ─── Publish ───────────────────────────────────────────────────────────────
  const handlePublish = async () => {
    if (!id || !template) return;
    const { draft, errors } = extractAndValidateGridDraft();
    if (errors.length > 0 || !draft) {
      showNotification('error', errors.join('; '));
      return;
    }

    setPublishing(true);
    try {
      if (hasUnsavedChanges) {
        await updateExportTemplate(id, { name: template.name, draft });
      }
      const updated = await publishExportTemplate(id);
      setTemplate(updated);
      setHasUnsavedChanges(false);
      showNotification('success', 'Published grid template successfully');
    } catch (err: any) {
      showNotification('error', err.message || 'Failed to publish template');
    } finally {
      setPublishing(false);
    }
  };

  // ─── Download Preview XLSX ─────────────────────────────────────────────────
  const handleDownloadPreview = async () => {
    if (!id || !template) return;
    setPreviewing(true);
    try {
      if (hasUnsavedChanges) {
        const { draft, errors } = extractAndValidateGridDraft();
        if (errors.length > 0 || !draft) {
          showNotification('error', errors.join('; '));
          setPreviewing(false);
          return;
        }
        await updateExportTemplate(id, { name: template.name, draft });
        setHasUnsavedChanges(false);
      }

      const blob = await downloadExportTemplateRenderPreview(id, viewMode === 'preview');
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${template.name.toLowerCase().replace(/\s+/g, '_')}_preview.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      showNotification('success', 'Downloaded preview XLSX');
    } catch (err: any) {
      showNotification('error', err.message || 'Failed to generate preview XLSX');
    } finally {
      setPreviewing(false);
    }
  };

  const handleApplyExecutiveTemplate = () => {
    if (!template) return;
    const targetEntity = metadata?.entities?.find((e: any) => e.id === template.entityId) || {
      id: template.entityId,
      name: template.name || 'Entity',
    };
    const execDraft = buildExecutiveReportTemplate(targetEntity);
    const univerData = gridTemplateToUniver(execDraft, { designView: viewMode === 'design' });
    initUniverWithData(univerData);
    setTemplate((prev) => (prev ? { ...prev, draft: execDraft } : prev));
    if (execDraft.datasets && execDraft.datasets.length > 0) {
      setSelectedDatasetId(execDraft.datasets[0].id);
    }
    setHasUnsavedChanges(true);
    showNotification('success', 'Applied Executive KPI & Breakdown template');
  };

  // ─── Toggle View Mode ──────────────────────────────────────────────────────
  const handleToggleViewMode = async (mode: 'design' | 'preview') => {
    if (mode === viewMode || !id || !template) return;

    if (mode === 'preview') {
      if (hasUnsavedChanges) {
        const { draft, errors } = extractAndValidateGridDraft();
        if (errors.length > 0 || !draft) {
          showNotification('error', `Cannot preview with unsaved errors: ${errors.join('; ')}`);
          return;
        }
        try {
          await updateExportTemplate(id, { name: template.name, draft });
          setHasUnsavedChanges(false);
        } catch (e: any) {
          showNotification('error', `Failed to save draft: ${e.message}`);
          return;
        }
      }

      setLoadingPreviewData(true);
      try {
        const res = await fetchExportTemplatePreviewData(id);
        if (res.draft) {
          const univerData = gridTemplateToUniver(res.draft, { designView: false });
          initUniverWithData(univerData);
          setViewMode('preview');
          showNotification('success', 'Previewing with live tenant data (first 50 rows)');
        }
      } catch (err: any) {
        showNotification('error', err.message || 'Failed to fetch preview data');
      } finally {
        setLoadingPreviewData(false);
      }
    } else {
      setViewMode('design');
      const draftDef = (template.draft || {}) as GridExportTemplateDefinition;
      const univerData = gridTemplateToUniver(draftDef, { designView: true });
      initUniverWithData(univerData);
    }
  };

  // ─── Inspect Selected Cell & Datasets ──────────────────────────────────────
  const currentDatasets: GridDatasetDefinition[] =
    template?.draft?.kind === 'grid' ? (template.draft as any).datasets || [] : [];
  const currentParameters: GridParameterDefinition[] =
    template?.draft?.kind === 'grid' ? (template.draft as any).parameters || [] : [];

  const currentDataset =
    currentDatasets.find((d) => d.id === selectedDatasetId) || currentDatasets[0] || null;

  // ─── Dataset Manipulation Actions ──────────────────────────────────────────
  const updateDatasetsInDraft = (newDatasets: GridDatasetDefinition[]) => {
    if (!template) return;
    const { draft } = extractAndValidateGridDraft();
    if (!draft) return;

    (draft as any).datasets = newDatasets;
    setTemplate((prev) => (prev ? { ...prev, draft } : prev));
    setHasUnsavedChanges(true);
  };

  const updateParametersInDraft = (newParams: GridParameterDefinition[]) => {
    if (!template) return;
    const { draft } = extractAndValidateGridDraft();
    if (!draft) return;

    (draft as any).parameters = newParams;
    setTemplate((prev) => (prev ? { ...prev, draft } : prev));
    setHasUnsavedChanges(true);
  };

  const handleCreateDataset = () => {
    const defaultBase = metadata?.entities?.[0]?.id || template?.entityId || 'entity_1';
    const newDs: GridDatasetDefinition = {
      id: `ds_${Date.now()}`,
      name: `Dataset ${currentDatasets.length + 1}`,
      source: {
        baseEntityId: defaultBase,
        joins: [],
      },
      fields: [],
      filters: [],
      sort: [],
      groupBy: [],
      aggregates: [],
      having: [],
    };
    const nextList = [...currentDatasets, newDs];
    updateDatasetsInDraft(nextList);
    setSelectedDatasetId(newDs.id);
    showNotification('success', `Created ${newDs.name}`);
  };

  const handleDeleteDataset = (dsId: string) => {
    const nextList = currentDatasets.filter((d) => d.id !== dsId);
    updateDatasetsInDraft(nextList);
    if (selectedDatasetId === dsId) {
      setSelectedDatasetId(nextList[0]?.id || '');
    }
    showNotification('success', 'Deleted dataset');
  };

  const handleUpdateCurrentDataset = (updater: (ds: GridDatasetDefinition) => GridDatasetDefinition) => {
    if (!currentDataset) return;
    const updated = updater({ ...currentDataset });
    const nextList = currentDatasets.map((d) => (d.id === currentDataset.id ? updated : d));
    updateDatasetsInDraft(nextList);
  };

  // Add join along reference field
  const handleAddJoinFromRefField = (refFieldId: string) => {
    if (!currentDataset) return;
    if ((currentDataset.source.joins || []).length >= 4) {
      showNotification('error', 'Maximum 4 joins allowed per dataset');
      return;
    }

    // Find the entity and field definition
    const baseEnt = metadata?.entities?.find((e: any) => e.id === currentDataset.source.baseEntityId);
    const refField = baseEnt?.fields?.find((f: any) => f.id === refFieldId);
    if (!refField || refField.type !== 'reference' || !refField.config?.targetEntityId) {
      showNotification('error', 'Selected field is not a valid reference field');
      return;
    }

    const newJoin: GridDatasetJoin = {
      id: `join_${Date.now()}`,
      name: refField.name,
      referenceFieldId: refField.id,
      targetEntityId: refField.config.targetEntityId,
      joinType: 'left',
    };

    handleUpdateCurrentDataset((ds) => ({
      ...ds,
      source: {
        ...ds.source,
        joins: [...(ds.source.joins || []), newJoin],
      },
    }));
    showNotification('success', `Added join along ${refField.label || refField.name}`);
  };

  const handleAddComputedColumn = () => {
    if (!newComputedName.trim() || !newComputedExpr.trim() || !currentDataset) return;
    const newField: GridDatasetField = {
      id: `calc_${Date.now()}`,
      name: newComputedName.trim(),
      fieldPath: newComputedName.trim(),
      expression: newComputedExpr.trim(),
    };
    handleUpdateCurrentDataset((ds) => ({
      ...ds,
      fields: [...(ds.fields || []), newField],
    }));
    setNewComputedName('');
    setNewComputedExpr('');
    showNotification('success', `Added computed column ${newField.name}`);
  };

  const handleAddAggregate = () => {
    if (!newAggName.trim() || !currentDataset) return;
    const newAgg: GridDatasetAggregate = {
      id: `agg_${Date.now()}`,
      name: newAggName.trim(),
      fn: newAggFn,
      fieldPath: newAggField.trim() || undefined,
    };
    handleUpdateCurrentDataset((ds) => ({
      ...ds,
      aggregates: [...(ds.aggregates || []), newAgg],
    }));
    setNewAggName('');
    showNotification('success', `Added aggregate ${newAgg.name}`);
  };

  const handleAddParameter = () => {
    if (!newParamName.trim()) return;
    const newParam: GridParameterDefinition = {
      id: `param_${Date.now()}`,
      name: newParamName.trim(),
      label: newParamName.trim(),
      type: newParamType as any,
      required: newParamRequired,
    };
    updateParametersInDraft([...currentParameters, newParam]);
    setNewParamName('');
    showNotification('success', `Added parameter ${newParam.name}`);
  };

  // Preview dataset 50 rows
  const handlePreviewDataset = async () => {
    if (!id || !currentDataset) return;
    setPreviewLoading(true);
    setPreviewRows(null);
    try {
      const res = await fetchDatasetPreview(id, currentDataset);
      setPreviewRows(res.rows || []);
      showNotification('success', `Loaded ${res.rows?.length || 0} rows preview`);
    } catch (err: any) {
      showNotification('error', err.message || 'Failed to preview dataset');
    } finally {
      setPreviewLoading(false);
    }
  };

  // ─── Cell Binding Actions ──────────────────────────────────────────────────
  const handleBindCellToDatasetField = (datasetId: string, fieldId: string, label: string) => {
    if (viewMode === 'preview') return;
    const { draft } = extractAndValidateGridDraft();
    if (!draft) return;

    const sheet = draft.sheets[0];
    const coord = `${selectedCell.row}:${selectedCell.col}`;

    sheet.cells[coord] = {
      ...(sheet.cells[coord] || {}),
      value: `{{ ${label} }}`,
      binding: {
        datasetId,
        fieldId,
        displayLabel: label,
      },
    };

    setTemplate((prev) => (prev ? { ...prev, draft } : prev));
    if (workbookRef.current) {
      const univerData = gridTemplateToUniver(draft, { designView: true });
      initUniverWithData(univerData);
    }
    setHasUnsavedChanges(true);
    showNotification('success', `Bound cell (${selectedCell.row + 1}, ${selectedCell.col + 1}) to ${label}`);
  };

  const handleBindCellToAggregate = (datasetId: string, aggregateId: string, label: string) => {
    if (viewMode === 'preview') return;
    const { draft } = extractAndValidateGridDraft();
    if (!draft) return;

    const sheet = draft.sheets[0];
    const coord = `${selectedCell.row}:${selectedCell.col}`;

    sheet.cells[coord] = {
      ...(sheet.cells[coord] || {}),
      value: `{{ KPI: ${label} }}`,
      binding: {
        datasetId,
        aggregateId,
        displayLabel: label,
      },
    };

    setTemplate((prev) => (prev ? { ...prev, draft } : prev));
    if (workbookRef.current) {
      const univerData = gridTemplateToUniver(draft, { designView: true });
      initUniverWithData(univerData);
    }
    setHasUnsavedChanges(true);
    showNotification('success', `Bound KPI cell (${selectedCell.row + 1}, ${selectedCell.col + 1}) to ${label}`);
  };

  const handleBindCellToParameter = (paramId: string, label: string) => {
    if (viewMode === 'preview') return;
    const { draft } = extractAndValidateGridDraft();
    if (!draft) return;

    const sheet = draft.sheets[0];
    const coord = `${selectedCell.row}:${selectedCell.col}`;

    sheet.cells[coord] = {
      ...(sheet.cells[coord] || {}),
      value: `{{ Param: ${label} }}`,
      binding: {
        parameterId: paramId,
        displayLabel: label,
      },
    };

    setTemplate((prev) => (prev ? { ...prev, draft } : prev));
    if (workbookRef.current) {
      const univerData = gridTemplateToUniver(draft, { designView: true });
      initUniverWithData(univerData);
    }
    setHasUnsavedChanges(true);
    showNotification('success', `Bound cell (${selectedCell.row + 1}, ${selectedCell.col + 1}) to parameter ${label}`);
  };

  const handleUnbindCell = () => {
    if (viewMode === 'preview') return;
    const { draft } = extractAndValidateGridDraft();
    if (!draft) return;

    const sheet = draft.sheets[0];
    const coord = `${selectedCell.row}:${selectedCell.col}`;
    if (sheet.cells[coord]) {
      delete (sheet.cells[coord] as any).binding;
      sheet.cells[coord].value = '';
    }

    setTemplate((prev) => (prev ? { ...prev, draft } : prev));
    if (workbookRef.current) {
      const univerData = gridTemplateToUniver(draft, { designView: true });
      initUniverWithData(univerData);
    }
    setHasUnsavedChanges(true);
    setBoundCellNotice(null);
    showNotification('success', `Unbound cell (${selectedCell.row + 1}, ${selectedCell.col + 1})`);
  };

  const handleAddColumnToRegion = (fieldId: string, label: string, regionId: string) => {
    if (!workbookRef.current || viewMode === 'preview') return;
    const { draft } = extractAndValidateGridDraft();
    if (!draft) return;

    const sheet = draft.sheets[0];
    const region = (sheet.regions || []).find((r) => r.id === regionId);
    if (!region) return;

    const nextCol =
      region.columns.length > 0 ? Math.max(...region.columns.map((c) => c.col)) + 1 : region.startCol;

    region.columns.push({
      col: nextCol,
      fieldId,
      displayLabel: label,
    });
    if (nextCol > region.endCol) {
      region.endCol = nextCol;
    }

    const univerData = gridTemplateToUniver(draft, { designView: true });
    initUniverWithData(univerData);
    setHasUnsavedChanges(true);
    showNotification('success', `Added column ${label} to region ${region.id}`);
  };

  const handleSelectRegion = (reg: GridRegionDefinition) => {
    setSelectedCell({ row: reg.startRow, col: reg.startCol });
    showNotification('success', `Selected region ${reg.displayLabel || reg.id}`);
    const activeSheet = template?.draft?.sheets?.[0];
    if (activeSheet) {
      const coordKey = `${reg.startRow}:${reg.startCol}`;
      const cell = activeSheet.cells?.[coordKey];
      if (cell?.binding) {
        const label =
          (typeof cell.binding === 'object'
            ? cell.binding.displayLabel || cell.binding.fieldId
            : String(cell.binding)) || 'Field';
        setBoundCellNotice(`This cell is bound to ${label}; edit the binding in the panel.`);
      }
    }
  };

  // Inspect currently selected cell binding
  const draftCoord = `${selectedCell.row}:${selectedCell.col}`;
  const draftCell = template?.draft?.kind === 'grid' ? template.draft.sheets?.[0]?.cells?.[draftCoord] : null;
  const activeBinding = draftCell?.binding;
  const activeRegions: GridRegionDefinition[] =
    template?.draft?.kind === 'grid' ? template.draft.sheets?.[0]?.regions || [] : [];

  // Available entities
  const allEntities = metadata?.entities || [];
  const baseEntity = allEntities.find((e: any) => e.id === currentDataset?.source.baseEntityId);
  const baseEntityRefFields = (baseEntity?.fields || []).filter((f: any) => f.type === 'reference');

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100vh',
        overflow: 'hidden',
        backgroundColor: 'var(--bg)',
        color: 'var(--text-main)',
      }}
    >
      {/* ─── Top Navigation Bar ─── */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'var(--space-2) var(--space-4)',
          borderBottom: 'var(--border-width) solid var(--border)',
          backgroundColor: 'var(--surface)',
          flexShrink: 0,
          gap: 'var(--space-4)',
        }}
      >
        {/* Left: Back & Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => navigate('/templates')}
            style={{ padding: 'var(--space-1) var(--space-2)' }}
            title="Back to Templates"
          >
            <ArrowLeft size={16} />
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <FileSpreadsheet size={18} style={{ color: 'var(--accent)' }} />
            <span style={{ fontWeight: 600, fontSize: 'var(--font-size-md)' }}>
              {template?.name || 'Grid Template Designer'}
            </span>
            {hasUnsavedChanges && (
              <span
                style={{
                  fontSize: 'var(--font-size-xs)',
                  color: 'var(--warning)',
                  backgroundColor: 'var(--warning-subtle)',
                  padding: 'var(--space-1) var(--space-2)',
                  borderRadius: 'var(--radius-control)',
                }}
              >
                Unsaved Changes
              </span>
            )}
          </div>
        </div>

        {/* Center: View Mode Toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <div
            style={{
              display: 'inline-flex',
              backgroundColor: 'var(--surface-subtle)',
              padding: 'var(--space-1)',
              borderRadius: 'var(--radius-control)',
              border: 'var(--border-width) solid var(--border)',
            }}
          >
            <button
              type="button"
              className={`btn btn-sm ${viewMode === 'design' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => handleToggleViewMode('design')}
              style={{
                fontSize: 'var(--font-size-xs)',
                padding: 'var(--space-1) var(--space-3)',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-1)',
              }}
            >
              <Edit3 size={13} />
              <span>Design View</span>
            </button>
            <button
              type="button"
              className={`btn btn-sm ${viewMode === 'preview' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => handleToggleViewMode('preview')}
              disabled={loadingPreviewData}
              style={{
                fontSize: 'var(--font-size-xs)',
                padding: 'var(--space-1) var(--space-3)',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-1)',
              }}
            >
              <Eye size={13} />
              <span>{loadingPreviewData ? 'Loading Preview...' : 'Preview with Data'}</span>
            </button>
          </div>
        </div>

        {/* Right: Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleApplyExecutiveTemplate}
            disabled={viewMode === 'preview' || !template}
            title="Generate Executive KPI & Data Breakdown layout for this entity"
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}
          >
            <Sparkles size={14} style={{ color: 'var(--accent)' }} />
            <span style={{ fontSize: 'var(--font-size-sm)' }}>Starter Template</span>
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleDownloadPreview}
            disabled={previewing || !template}
            title="Download rendered preview XLSX"
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}
          >
            <Download size={14} />
            <span style={{ fontSize: 'var(--font-size-sm)' }}>
              {previewing ? 'Downloading...' : 'Download Preview'}
            </span>
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleSaveDraft}
            disabled={saving || viewMode === 'preview'}
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}
          >
            <Save size={14} />
            <span style={{ fontSize: 'var(--font-size-sm)' }}>
              {saving ? 'Saving...' : 'Save Draft'}
            </span>
          </button>

          <button
            type="button"
            className="btn btn-primary"
            onClick={handlePublish}
            disabled={publishing || viewMode === 'preview'}
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}
          >
            <Upload size={14} />
            <span style={{ fontSize: 'var(--font-size-sm)' }}>
              {publishing ? 'Publishing...' : 'Publish'}
            </span>
          </button>
        </div>
      </header>

      {/* ─── Bound Cell Notice Banner ─── */}
      {boundCellNotice && (
        <div
          data-testid="bound-cell-notice"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: 'var(--space-2) var(--space-4)',
            backgroundColor: 'var(--accent-subtle)',
            borderBottom: 'var(--border-width) solid var(--accent)',
            color: 'var(--text-main)',
            fontSize: 'var(--font-size-sm)',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <LinkIcon size={16} style={{ color: 'var(--accent)' }} />
            <span>
              <strong>Binding Notice:</strong> {boundCellNotice} The binding always wins at render time.
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              onClick={handleUnbindCell}
              style={{ fontSize: 'var(--font-size-xs)' }}
            >
              Unbind Cell
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setBoundCellNotice(null)}
              style={{ fontSize: 'var(--font-size-xs)' }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* ─── Notification Toast ─── */}
      {notification && (
        <div
          data-testid="notification-toast"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            padding: 'var(--space-2) var(--space-4)',
            backgroundColor:
              notification.type === 'success' ? 'var(--success-subtle)' : 'var(--danger-subtle)',
            borderBottom: `var(--border-width) solid ${
              notification.type === 'success' ? 'var(--success)' : 'var(--danger)'
            }`,
            color: notification.type === 'success' ? 'var(--success)' : 'var(--danger)',
            fontSize: 'var(--font-size-sm)',
            flexShrink: 0,
          }}
        >
          {notification.type === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
          <span>{notification.message}</span>
        </div>
      )}

      {/* ─── Main Workspace & Side Panel ─── */}
      <div style={{ display: 'flex', flex: 1, width: '100%', height: '100%', overflow: 'hidden' }}>
        {/* Left: Univer Spreadsheet Canvas */}
        <div
          style={{
            flex: 1,
            height: '100%',
            position: 'relative',
            backgroundColor: 'var(--bg)',
          }}
        >
          {loading && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'var(--bg)',
                zIndex: 10,
                color: 'var(--text-muted)',
                fontSize: 'var(--font-size-sm)',
                gap: 'var(--space-2)',
              }}
            >
              <RefreshCw size={18} className="animate-spin" />
              <span>Loading template designer...</span>
            </div>
          )}
          <div
            ref={containerRef}
            style={{
              width: '100%',
              height: '100%',
              position: 'absolute',
              top: 0,
              left: 0,
            }}
          />
        </div>

        {/* Right: Side Panel (Datasets, Fields, Regions) */}
        <aside
          style={{
            width: '360px',
            backgroundColor: 'var(--surface)',
            borderLeft: 'var(--border-width) solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0,
            zIndex: 5,
          }}
        >
          {/* Panel Tab Switcher */}
          <div
            style={{
              display: 'flex',
              borderBottom: 'var(--border-width) solid var(--border)',
              backgroundColor: 'var(--surface-subtle)',
            }}
          >
            <button
              type="button"
              className={`btn btn-ghost ${sidePanelTab === 'datasets' ? 'active' : ''}`}
              onClick={() => setSidePanelTab('datasets')}
              style={{
                flex: 1,
                borderBottom: sidePanelTab === 'datasets' ? 'var(--border-width) solid var(--accent)' : 'none',
                fontWeight: sidePanelTab === 'datasets' ? 600 : 400,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 'var(--space-1)',
                padding: 'var(--space-2)',
              }}
            >
              <Database size={14} />
              <span style={{ fontSize: 'var(--font-size-xs)' }}>Datasets ({currentDatasets.length})</span>
            </button>
            <button
              type="button"
              className={`btn btn-ghost ${sidePanelTab === 'fields' ? 'active' : ''}`}
              onClick={() => setSidePanelTab('fields')}
              style={{
                flex: 1,
                borderBottom: sidePanelTab === 'fields' ? 'var(--border-width) solid var(--accent)' : 'none',
                fontWeight: sidePanelTab === 'fields' ? 600 : 400,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 'var(--space-1)',
                padding: 'var(--space-2)',
              }}
            >
              <Table size={14} />
              <span style={{ fontSize: 'var(--font-size-xs)' }}>Dataset Fields</span>
              <span style={{ display: 'none' }}>Entity Fields</span>
            </button>
            <button
              type="button"
              className={`btn btn-ghost ${sidePanelTab === 'regions' ? 'active' : ''}`}
              onClick={() => setSidePanelTab('regions')}
              style={{
                flex: 1,
                borderBottom: sidePanelTab === 'regions' ? 'var(--border-width) solid var(--accent)' : 'none',
                fontWeight: sidePanelTab === 'regions' ? 600 : 400,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 'var(--space-1)',
                padding: 'var(--space-2)',
              }}
            >
              <Layers size={14} />
              <span style={{ fontSize: 'var(--font-size-xs)' }}>Regions ({activeRegions.length})</span>
            </button>
          </div>

          {/* Active Cell Status & Unbind Action */}
          <div
            style={{
              padding: 'var(--space-2) var(--space-3)',
              backgroundColor: 'var(--surface-subtle)',
              borderBottom: 'var(--border-width) solid var(--border)',
              fontSize: 'var(--font-size-xs)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Target Cell: </span>
              <strong>
                R{selectedCell.row + 1}:C{selectedCell.col + 1}
              </strong>
            </div>
            {activeBinding ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                <span
                  style={{
                    backgroundColor: 'var(--accent-subtle)',
                    color: 'var(--accent)',
                    padding: 'var(--space-1) var(--space-2)',
                    borderRadius: 'var(--radius-control)',
                  }}
                >
                  Bound
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={handleUnbindCell}
                  title="Unbind cell"
                  style={{ padding: 'var(--space-1)', color: 'var(--danger)' }}
                >
                  <Unlink size={12} />
                </button>
              </div>
            ) : (
              <span style={{ color: 'var(--text-muted)' }}>Static</span>
            )}
          </div>

          {/* ─── TAB 1: Datasets Panel (Requirement 5) ─── */}
          {sidePanelTab === 'datasets' && (
            <div
              style={{
                padding: 'var(--space-3)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-3)',
                overflowY: 'auto',
                flex: 1,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>Template Datasets</span>
                <button
                  type="button"
                  data-testid="add-dataset-btn"
                  className="btn btn-secondary btn-sm"
                  onClick={handleCreateDataset}
                  style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}
                >
                  <Plus size={13} />
                  <span>New Dataset</span>
                </button>
              </div>

              {currentDatasets.length === 0 ? (
                <div style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)' }}>
                  No datasets defined yet. Click "New Dataset" to create one.
                </div>
              ) : (
                <>
                  {/* Dataset Selector / List */}
                  <select
                    className="input input-sm"
                    data-testid="dataset-select"
                    value={selectedDatasetId}
                    onChange={(e) => setSelectedDatasetId(e.target.value)}
                  >
                    {currentDatasets.map((ds) => (
                      <option key={ds.id} value={ds.id}>
                        {ds.name} ({ds.id})
                      </option>
                    ))}
                  </select>

                  {currentDataset && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', border: 'var(--border-width) solid var(--border)', padding: 'var(--space-3)', borderRadius: 'var(--radius-control)' }}>
                      {/* Name & Delete */}
                      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                        <input
                          type="text"
                          className="input input-sm"
                          data-testid="dataset-name-input"
                          value={currentDataset.name}
                          onChange={(e) => {
                            const val = e.target.value;
                            handleUpdateCurrentDataset((ds) => ({ ...ds, name: val }));
                          }}
                          placeholder="Dataset Name"
                          style={{ flex: 1 }}
                        />
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          data-testid="delete-dataset-btn"
                          onClick={() => handleDeleteDataset(currentDataset.id)}
                          title="Delete Dataset"
                          style={{ color: 'var(--danger)' }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>

                      {/* Base Entity */}
                      <div>
                        <label style={{ fontSize: 'var(--font-size-xs)', fontWeight: 500, color: 'var(--text-muted)' }}>
                          Base Entity
                        </label>
                        <select
                          className="input input-sm"
                          data-testid="dataset-base-entity-select"
                          value={currentDataset.source.baseEntityId}
                          onChange={(e) => {
                            const val = e.target.value;
                            handleUpdateCurrentDataset((ds) => ({
                              ...ds,
                              source: { ...ds.source, baseEntityId: val, joins: [] },
                              fields: [],
                            }));
                          }}
                          style={{ width: '100%', marginTop: 'var(--space-1)' }}
                        >
                          {allEntities.map((ent: any) => (
                            <option key={ent.id} value={ent.id}>
                              {ent.label || ent.name} ({ent.id})
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Joins Section (max 4) */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600 }}>
                            Joins ({(currentDataset.source.joins || []).length}/4)
                          </span>
                        </div>

                        {baseEntityRefFields.length > 0 && (currentDataset.source.joins || []).length < 4 && (
                          <div style={{ display: 'flex', gap: 'var(--space-1)', marginTop: 'var(--space-1)' }}>
                            <select
                              className="input input-sm"
                              data-testid="join-ref-field-select"
                              value={selectedRefFieldForJoin}
                              onChange={(e) => setSelectedRefFieldForJoin(e.target.value)}
                              style={{ flex: 1 }}
                            >
                              <option value="">Select Reference Field...</option>
                              {baseEntityRefFields.map((rf: any) => (
                                <option key={rf.id} value={rf.id}>
                                  {rf.label || rf.name} {' -> '} {rf.config?.targetEntityId}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              data-testid="add-join-btn"
                              disabled={!selectedRefFieldForJoin}
                              onClick={() => {
                                handleAddJoinFromRefField(selectedRefFieldForJoin);
                                setSelectedRefFieldForJoin('');
                              }}
                            >
                              Join
                            </button>
                          </div>
                        )}

                        {(currentDataset.source.joins || []).map((j, idx) => (
                          <div
                            key={j.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: 'var(--space-1) var(--space-2)',
                              backgroundColor: 'var(--surface-subtle)',
                              borderRadius: 'var(--radius-control)',
                              fontSize: 'var(--font-size-xs)',
                            }}
                          >
                            <span>
                              Join {idx + 1}: {j.name || j.referenceFieldId} ({j.targetEntityId})
                            </span>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() =>
                                handleUpdateCurrentDataset((ds) => ({
                                  ...ds,
                                  source: {
                                    ...ds.source,
                                    joins: (ds.source.joins || []).filter((item) => item.id !== j.id),
                                  },
                                }))
                              }
                              style={{ color: 'var(--danger)', padding: 2 }}
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        ))}
                      </div>

                      {/* Computed Columns */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                        <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600 }}>
                          Computed Columns
                        </span>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                          <input
                            type="text"
                            placeholder="Column Name"
                            className="input input-sm"
                            data-testid="computed-col-name"
                            value={newComputedName}
                            onChange={(e) => setNewComputedName(e.target.value)}
                          />
                          <input
                            type="text"
                            placeholder="Expression (e.g. units * price)"
                            className="input input-sm"
                            data-testid="computed-col-expr"
                            value={newComputedExpr}
                            onChange={(e) => setNewComputedExpr(e.target.value)}
                          />
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            data-testid="add-computed-col-btn"
                            onClick={handleAddComputedColumn}
                            disabled={!newComputedName.trim() || !newComputedExpr.trim()}
                          >
                            + Add Computed Column
                          </button>
                        </div>

                        {(currentDataset.fields || [])
                          .filter((f) => Boolean(f.expression))
                          .map((f) => (
                            <div
                              key={f.id}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                fontSize: 'var(--font-size-xs)',
                                padding: 'var(--space-1) var(--space-2)',
                                backgroundColor: 'var(--surface-subtle)',
                                borderRadius: 'var(--radius-control)',
                              }}
                            >
                              <div>
                                <strong>{f.name}</strong>: <code>{f.expression}</code>
                              </div>
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() =>
                                  handleUpdateCurrentDataset((ds) => ({
                                    ...ds,
                                    fields: ds.fields.filter((item) => item.id !== f.id),
                                  }))
                                }
                                style={{ color: 'var(--danger)', padding: 2 }}
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          ))}
                      </div>

                      {/* Aggregates Section */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                        <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600 }}>Aggregates</span>
                        <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                          <input
                            type="text"
                            placeholder="Name (e.g. total_output)"
                            className="input input-sm"
                            data-testid="aggregate-name"
                            value={newAggName}
                            onChange={(e) => setNewAggName(e.target.value)}
                            style={{ flex: 1 }}
                          />
                          <select
                            className="input input-sm"
                            data-testid="aggregate-fn"
                            value={newAggFn}
                            onChange={(e) => setNewAggFn(e.target.value as any)}
                          >
                            <option value="sum">SUM</option>
                            <option value="avg">AVG</option>
                            <option value="min">MIN</option>
                            <option value="max">MAX</option>
                            <option value="count">COUNT</option>
                            <option value="count_distinct">COUNT DISTINCT</option>
                          </select>
                        </div>
                        <input
                          type="text"
                          placeholder="Field (optional for count)"
                          className="input input-sm"
                          data-testid="aggregate-field"
                          value={newAggField}
                          onChange={(e) => setNewAggField(e.target.value)}
                        />
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          data-testid="add-aggregate-btn"
                          onClick={handleAddAggregate}
                          disabled={!newAggName.trim()}
                        >
                          + Add Aggregate
                        </button>

                        {(currentDataset.aggregates || []).map((agg) => (
                          <div
                            key={agg.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              fontSize: 'var(--font-size-xs)',
                              padding: 'var(--space-1) var(--space-2)',
                              backgroundColor: 'var(--surface-subtle)',
                              borderRadius: 'var(--radius-control)',
                            }}
                          >
                            <span>
                              {agg.fn.toUpperCase()}({agg.fieldPath || '*'}) AS <strong>{agg.name}</strong>
                            </span>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() =>
                                handleUpdateCurrentDataset((ds) => ({
                                  ...ds,
                                  aggregates: (ds.aggregates || []).filter((a) => a.id !== agg.id),
                                }))
                              }
                              style={{ color: 'var(--danger)', padding: 2 }}
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        ))}
                      </div>

                      {/* Template Parameters Section */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                        <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600 }}>
                          Parameters ({currentParameters.length})
                        </span>
                        <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                          <input
                            type="text"
                            placeholder="Parameter Name"
                            className="input input-sm"
                            data-testid="param-name"
                            value={newParamName}
                            onChange={(e) => setNewParamName(e.target.value)}
                            style={{ flex: 1 }}
                          />
                          <select
                            className="input input-sm"
                            value={newParamType}
                            onChange={(e) => setNewParamType(e.target.value)}
                          >
                            <option value="text">Text</option>
                            <option value="number">Number</option>
                            <option value="date">Date</option>
                            <option value="date_range">Date Range</option>
                            <option value="boolean">Boolean</option>
                          </select>
                        </div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 'var(--font-size-xs)' }}>
                          <input
                            type="checkbox"
                            checked={newParamRequired}
                            onChange={(e) => setNewParamRequired(e.target.checked)}
                          />
                          <span>Required</span>
                        </label>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          data-testid="add-parameter-btn"
                          onClick={handleAddParameter}
                          disabled={!newParamName.trim()}
                        >
                          + Add Parameter
                        </button>

                        {currentParameters.map((p) => (
                          <div
                            key={p.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              fontSize: 'var(--font-size-xs)',
                              padding: 'var(--space-1) var(--space-2)',
                              backgroundColor: 'var(--surface-subtle)',
                              borderRadius: 'var(--radius-control)',
                            }}
                          >
                            <span>
                              {p.name} ({p.type}) {p.required && '*'}
                            </span>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() =>
                                updateParametersInDraft(currentParameters.filter((item) => item.id !== p.id))
                              }
                              style={{ color: 'var(--danger)', padding: 2 }}
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        ))}
                      </div>

                      {/* Preview 50 Rows */}
                      <div style={{ marginTop: 'var(--space-2)', borderTop: 'var(--border-width) solid var(--border)', paddingTop: 'var(--space-2)' }}>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          data-testid="preview-dataset-btn"
                          onClick={handlePreviewDataset}
                          disabled={previewLoading}
                          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-1)' }}
                        >
                          <Play size={13} />
                          <span>{previewLoading ? 'Loading Preview...' : 'Preview 50 Rows'}</span>
                        </button>

                        {previewRows && (
                          <div
                            data-testid="dataset-preview-table"
                            style={{
                              marginTop: 'var(--space-2)',
                              maxHeight: '180px',
                              overflowY: 'auto',
                              fontSize: 'var(--font-size-xs)',
                              border: 'var(--border-width) solid var(--border)',
                              borderRadius: 'var(--radius-control)',
                            }}
                          >
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                              <thead>
                                <tr style={{ backgroundColor: 'var(--surface-subtle)', textAlign: 'left' }}>
                                  {Object.keys(previewRows[0] || {}).map((k) => (
                                    <th key={k} style={{ padding: 'var(--space-1) var(--space-2)', borderBottom: '1px solid var(--border)' }}>
                                      {k}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {previewRows.slice(0, 10).map((row, rIdx) => (
                                  <tr key={rIdx} style={{ borderBottom: '1px solid var(--border)' }}>
                                    {Object.values(row).map((v: any, cIdx) => (
                                      <td key={cIdx} style={{ padding: 'var(--space-1) var(--space-2)' }}>
                                        {String(v ?? '')}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ─── TAB 2: Dataset Fields Panel (Replaces Entity Fields Panel) ─── */}
          {sidePanelTab === 'fields' && (
            <div
              style={{
                padding: 'var(--space-3)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-2)',
                overflowY: 'auto',
                flex: 1,
              }}
            >
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
                Select a dataset and bind its fields or aggregate results to the active cell.
              </div>

              {currentDatasets.length > 0 && (
                <select
                  className="input input-sm"
                  data-testid="dataset-fields-selector"
                  value={selectedDatasetId}
                  onChange={(e) => setSelectedDatasetId(e.target.value)}
                >
                  {currentDatasets.map((ds) => (
                    <option key={ds.id} value={ds.id}>
                      {ds.name}
                    </option>
                  ))}
                </select>
              )}

              {!currentDataset ? (
                <div style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--text-muted)' }}>
                  No dataset available. Please create a dataset first.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  {/* Base entity fields */}
                  <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600 }}>
                    Entity & Joined Fields
                  </span>
                  {(baseEntity?.fields || []).map((f: any) => {
                    const label = f.label || f.name;
                    return (
                      <div
                        key={f.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: 'var(--space-2)',
                          backgroundColor: 'var(--surface)',
                          border: 'var(--border-width) solid var(--border)',
                          borderRadius: 'var(--radius-control)',
                          fontSize: 'var(--font-size-xs)',
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 500 }}>{label}</div>
                          <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)' }}>
                            {f.id} • {f.type}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            data-testid={`bind-cell-${f.id}`}
                            onClick={() => handleBindCellToDatasetField(currentDataset.id, f.id, label)}
                            style={{ fontSize: 'var(--font-size-xs)', padding: 'var(--space-1) var(--space-2)' }}
                          >
                            Bind Cell
                          </button>
                          {activeRegions.length > 0 && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => handleAddColumnToRegion(f.id, label, activeRegions[0].id)}
                              style={{ fontSize: 'var(--font-size-xs)', padding: 'var(--space-1) var(--space-2)' }}
                            >
                              + Region
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {/* Computed columns */}
                  {(currentDataset.fields || [])
                    .filter((f) => Boolean(f.expression))
                    .map((f) => (
                      <div
                        key={f.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: 'var(--space-2)',
                          backgroundColor: 'var(--surface)',
                          border: 'var(--border-width) solid var(--border)',
                          borderRadius: 'var(--radius-control)',
                          fontSize: 'var(--font-size-xs)',
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 500 }}>{f.name} (Computed)</div>
                          <div style={{ color: 'var(--text-muted)' }}>{f.expression}</div>
                        </div>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          data-testid={`bind-cell-${f.id}`}
                          onClick={() => handleBindCellToDatasetField(currentDataset.id, f.id, f.name)}
                          style={{ fontSize: 'var(--font-size-xs)', padding: 'var(--space-1) var(--space-2)' }}
                        >
                          Bind Cell
                        </button>
                      </div>
                    ))}

                  {/* Aggregates (KPI) */}
                  {(currentDataset.aggregates || []).map((agg) => (
                    <div
                      key={agg.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: 'var(--space-2)',
                        backgroundColor: 'var(--surface)',
                        border: 'var(--border-width) solid var(--accent)',
                        borderRadius: 'var(--radius-control)',
                        fontSize: 'var(--font-size-xs)',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 500 }}>{agg.name} (KPI)</div>
                        <div style={{ color: 'var(--text-muted)' }}>
                          {agg.fn.toUpperCase()}({agg.fieldPath || '*'})
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        data-testid={`bind-kpi-${agg.id}`}
                        onClick={() => handleBindCellToAggregate(currentDataset.id, agg.id, agg.name)}
                        style={{ fontSize: 'var(--font-size-xs)', padding: 'var(--space-1) var(--space-2)' }}
                      >
                        Bind KPI Cell
                      </button>
                    </div>
                  ))}

                  {/* Parameters */}
                  {currentParameters.map((p) => (
                    <div
                      key={p.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: 'var(--space-2)',
                        backgroundColor: 'var(--surface)',
                        border: 'var(--border-width) solid var(--border)',
                        borderRadius: 'var(--radius-control)',
                        fontSize: 'var(--font-size-xs)',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 500 }}>{p.name} (Param)</div>
                        <div style={{ color: 'var(--text-muted)' }}>{p.type}</div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        data-testid={`bind-param-${p.name}`}
                        onClick={() => handleBindCellToParameter(p.name, p.name)}
                        style={{ fontSize: 'var(--font-size-xs)', padding: 'var(--space-1) var(--space-2)' }}
                      >
                        Bind Param Cell
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ─── TAB 3: Regions Panel ─── */}
          {sidePanelTab === 'regions' && (
            <div
              style={{
                padding: 'var(--space-3)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-2)',
                overflowY: 'auto',
                flex: 1,
              }}
            >
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
                Repeating regions dynamically expand rows downward during export.
              </div>

              {activeRegions.map((reg) => (
                <div
                  key={reg.id}
                  onClick={() => handleSelectRegion(reg)}
                  style={{
                    padding: 'var(--space-3)',
                    backgroundColor: 'var(--surface)',
                    border: 'var(--border-width) solid var(--border)',
                    borderRadius: 'var(--radius-control)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--space-2)',
                    fontSize: 'var(--font-size-xs)',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong>{reg.displayLabel || reg.id}</strong>
                    <span style={{ color: 'var(--text-muted)' }}>
                      Rows {reg.startRow + 1}–{reg.endRow + 1} • Cols {reg.startCol + 1}–{reg.endCol + 1}
                    </span>
                  </div>

                  <div>
                    <label style={{ color: 'var(--text-muted)' }}>Bound Dataset: </label>
                    <select
                      className="input input-sm"
                      data-testid="region-dataset-select"
                      value={reg.datasetId || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        const { draft } = extractAndValidateGridDraft();
                        if (draft) {
                          const sheet = draft.sheets[0];
                          const target = (sheet.regions || []).find((r) => r.id === reg.id);
                          if (target) target.datasetId = val;
                          setTemplate((prev) => (prev ? { ...prev, draft } : prev));
                          setHasUnsavedChanges(true);
                        }
                      }}
                      style={{ width: '100%', marginTop: 2 }}
                    >
                      <option value="">Select Dataset...</option>
                      {currentDatasets.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <span style={{ fontWeight: 500 }}>Mapped Columns ({reg.columns.length}):</span>
                    {reg.columns.map((c, idx) => (
                      <div
                        key={idx}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          padding: 'var(--space-1) 0',
                          color: 'var(--text-muted)',
                        }}
                      >
                        <span>Col {c.col + 1}:</span>
                        <span>{c.displayLabel || c.fieldId}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
