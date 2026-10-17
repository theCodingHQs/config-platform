import React, { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FileSpreadsheet,
  Plus,
  Copy,
  Trash2,
  ChevronUp,
  ChevronDown,
  Save,
  Check,
  Eye,
  Download,
  RefreshCw,
  AlertCircle,
  FileText,
  Search,
  X,
  SlidersHorizontal,
} from "lucide-react";
import {
  listExportTemplates,
  getExportTemplate,
  createExportTemplate,
  updateExportTemplate,
  deleteExportTemplate,
  publishExportTemplate,
  duplicateExportTemplate,
  previewExportTemplateDraft,
  createExportDownloadToken,
  type ExportTemplateItem,
} from "../api/client";
import { useMetadata } from "../context/metadata-context";
import {
  buildGridStarterTemplate,
  buildExecutiveReportTemplate,
  GRID_STARTER_TEMPLATES,
  type GridStarterTemplateId,
  type SimpleExportTemplateDefinition,
  type ExportTemplateColumn,
  type ExportTemplateSort,
  type ExportTemplateFilter,
  type ErdTable,
  type ErdColumn,
} from "@config-platform/schema";

export function ExportTemplatesManager() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    null,
  );
  const [isCreating, setIsCreating] = useState(false);
  const [searchFilter, setSearchFilter] = useState("");
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // New template form state
  const [newTemplateName, setNewTemplateName] = useState("");
  const [newTemplateEntityId, setNewTemplateEntityId] = useState("");
  const [newTemplateKind, setNewTemplateKind] = useState<"simple" | "grid">(
    "grid",
  );
  const [gridPreset, setGridPreset] = useState<GridStarterTemplateId | "blank">(
    "executive",
  );

  // Editor draft state
  const [draftName, setDraftName] = useState("");
  const [draft, setDraft] = useState<SimpleExportTemplateDefinition | null>(
    null,
  );
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Live preview state
  const [previewData, setPreviewData] = useState<{
    columns: Array<{ fieldId: string; header: string; format: string }>;
    rows: Array<Record<string, any>>;
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // ─── Queries ─────────────────────────────────────────────────────────────

  const { entities = [], isLoading: entitiesLoading } = useMetadata();

  const {
    data: templates = [],
    isLoading: templatesLoading,
    refetch: refetchTemplates,
  } = useQuery<ExportTemplateItem[]>({
    queryKey: ["export-templates"],
    queryFn: () => listExportTemplates(),
  });

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);
  const selectedEntity = entities.find(
    (e) => e.id === selectedTemplate?.entityId,
  );
  const entityFields: ErdColumn[] = selectedEntity
    ? ((selectedEntity.columns ||
        (selectedEntity as any).fields ||
        []) as ErdColumn[])
    : [];

  // ─── Template Selection & Draft Init ─────────────────────────────────────

  useEffect(() => {
    if (selectedTemplate) {
      setDraftName(selectedTemplate.name);
      setDraft(JSON.parse(JSON.stringify(selectedTemplate.draft)));
      setHasUnsavedChanges(false);
      setPreviewData(null);
    } else {
      setDraft(null);
      setDraftName("");
      setPreviewData(null);
    }
  }, [selectedTemplateId, templates]);

  // Auto-select first template when available
  useEffect(() => {
    if (!selectedTemplateId && !isCreating && templates.length > 0) {
      setSelectedTemplateId(templates[0].id);
    }
  }, [templates, selectedTemplateId, isCreating]);

  // ─── Mutations ───────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: () => {
      const payload: any = {
        name: newTemplateName.trim(),
        entityId: newTemplateEntityId,
      };
      if (newTemplateKind === "grid") {
        const targetEntity = entities.find((e) => e.id === newTemplateEntityId);
        if (gridPreset !== "blank" && targetEntity) {
          payload.draft = buildGridStarterTemplate(targetEntity, gridPreset);
        } else {
          payload.draft = {
            kind: "grid",
            version: 1,
            schemaVersion: 2,
            parameters: [],
            datasets: [],
            sheets: [
              {
                id: "sheet_1",
                name: "Sheet 1",
                order: 0,
                cells: {},
              },
            ],
          };
        }
      }
      return createExportTemplate(payload);
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["export-templates"] });
      setIsCreating(false);
      setNewTemplateName("");
      setNewTemplateEntityId("");
      if (newTemplateKind === "grid") {
        navigate(`/studio/export-templates/${created.id}/designer`);
      } else {
        setSelectedTemplateId(created.id);
        showSuccess(`Template '${created.name}' created`);
      }
    },
    onError: (err: any) => {
      showError(err.message || "Failed to create export template");
    },
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!selectedTemplateId || !draft)
        throw new Error("No template selected");
      return updateExportTemplate(selectedTemplateId, {
        name: draftName.trim(),
        draft,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["export-templates"] });
      setHasUnsavedChanges(false);
      showSuccess("Draft saved successfully");
    },
    onError: (err: any) => {
      showError(err.message || "Failed to save draft");
    },
  });

  const publishMutation = useMutation({
    mutationFn: () => {
      if (!selectedTemplateId) throw new Error("No template selected");
      return publishExportTemplate(selectedTemplateId);
    },
    onSuccess: (pub) => {
      queryClient.invalidateQueries({ queryKey: ["export-templates"] });
      setHasUnsavedChanges(false);
      showSuccess(`Published template as version ${pub.version}`);
    },
    onError: (err: any) => {
      showError(err.message || "Failed to publish template");
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: (id: string) => duplicateExportTemplate(id),
    onSuccess: (duplicated) => {
      queryClient.invalidateQueries({ queryKey: ["export-templates"] });
      setSelectedTemplateId(duplicated.id);
      showSuccess(`Duplicated as '${duplicated.name}'`);
    },
    onError: (err: any) => {
      showError(err.message || "Failed to duplicate template");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteExportTemplate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["export-templates"] });
      setSelectedTemplateId(null);
      showSuccess("Template deleted");
    },
    onError: (err: any) => {
      showError(err.message || "Failed to delete template");
    },
  });

  // ─── Helpers ─────────────────────────────────────────────────────────────

  const showSuccess = (msg: string) => {
    setActionSuccess(msg);
    setActionError(null);
    setTimeout(() => setActionSuccess(null), 3500);
  };

  const showError = (msg: string) => {
    setActionError(msg);
    setActionSuccess(null);
  };

  const handleQuickCreateExecutiveTemplate = (targetEntityId?: string) => {
    const ent = entities.find((e) => e.id === targetEntityId) || entities[0];
    if (!ent) {
      showError("Please create an entity first before creating an export template.");
      return;
    }
    const execDraft = buildExecutiveReportTemplate(ent);
    createExportTemplate({
      name: `${ent.label || ent.name} Executive Summary`,
      entityId: ent.id,
      draft: execDraft,
    })
      .then((created) => {
        queryClient.invalidateQueries({ queryKey: ["export-templates"] });
        showSuccess(`Generated executive template for ${ent.label || ent.name}`);
        navigate(`/studio/export-templates/${created.id}/designer`);
      })
      .catch((err) => {
        showError(err.message || "Failed to generate template");
      });
  };

  const handleFetchPreview = async () => {
    if (!selectedTemplate || !draft) return;
    setPreviewLoading(true);
    try {
      const data = await previewExportTemplateDraft(
        selectedTemplate.entityId,
        draft,
      );
      setPreviewData(data);
    } catch (err: any) {
      showError(err.message || "Failed to generate preview");
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleTestDownload = async (format: "xlsx" | "csv") => {
    if (!selectedTemplate || !draft) return;
    try {
      const { downloadUrl } = await createExportDownloadToken({
        templateId: selectedTemplate.id,
        entityId: selectedTemplate.entityId,
        format,
      });
      // Browser download trigger (no blob in browser memory)
      window.location.href = downloadUrl;
      showSuccess(`Downloading ${format.toUpperCase()} export...`);
    } catch (err: any) {
      showError(err.message || "Download failed");
    }
  };

  // ─── Column Manipulation ──────────────────────────────────────────────────

  const handleToggleColumn = (fieldId: string, defaultHeader: string) => {
    if (!draft) return;
    const exists = draft.columns?.some((c) => c.fieldId === fieldId);
    let nextCols: ExportTemplateColumn[];
    if (exists) {
      nextCols = draft.columns?.filter((c) => c.fieldId !== fieldId);
    } else {
      nextCols = [
        ...draft.columns,
        { fieldId, header: defaultHeader, format: "text" },
      ];
    }
    setDraft({ ...draft, columns: nextCols });
    setHasUnsavedChanges(true);
  };

  const handleMoveColumn = (index: number, direction: "up" | "down") => {
    if (!draft) return;
    const targetIdx = direction === "up" ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= draft.columns?.length) return;
    const nextCols = [...draft.columns];
    const [moved] = nextCols.splice(index, 1);
    nextCols.splice(targetIdx, 0, moved);
    setDraft({ ...draft, columns: nextCols });
    setHasUnsavedChanges(true);
  };

  const handleUpdateColumn = (
    index: number,
    patch: Partial<ExportTemplateColumn>,
  ) => {
    if (!draft) return;
    const nextCols = [...draft.columns];
    nextCols[index] = { ...nextCols[index], ...patch };
    setDraft({ ...draft, columns: nextCols });
    setHasUnsavedChanges(true);
  };

  // ─── Filter & Sort Manipulation ──────────────────────────────────────────

  const handleAddSort = () => {
    if (!draft || !selectedEntity || entityFields.length === 0) return;
    const firstField = entityFields[0];
    const nextSorts: ExportTemplateSort[] = [
      ...(draft.defaultSort || []),
      { fieldId: firstField.id, direction: "asc" },
    ];
    setDraft({ ...draft, defaultSort: nextSorts });
    setHasUnsavedChanges(true);
  };

  const handleRemoveSort = (index: number) => {
    if (!draft) return;
    const nextSorts = (draft.defaultSort || []).filter((_, i) => i !== index);
    setDraft({ ...draft, defaultSort: nextSorts });
    setHasUnsavedChanges(true);
  };

  const handleAddFilter = () => {
    if (!draft || !selectedEntity || entityFields.length === 0) return;
    const firstField = entityFields[0];
    const nextFilters: ExportTemplateFilter[] = [
      ...(draft.defaultFilters || []),
      { fieldId: firstField.id, op: "eq", value: "" },
    ];
    setDraft({ ...draft, defaultFilters: nextFilters });
    setHasUnsavedChanges(true);
  };

  const handleRemoveFilter = (index: number) => {
    if (!draft) return;
    const nextFilters = (draft.defaultFilters || []).filter(
      (_, i) => i !== index,
    );
    setDraft({ ...draft, defaultFilters: nextFilters });
    setHasUnsavedChanges(true);
  };

  // ─── Render ──────────────────────────────────────────────────────────────

  const filteredTemplates = templates.filter((t) =>
    t.name.toLowerCase().includes(searchFilter.toLowerCase()),
  );

  return (
    <div
      style={{ maxWidth: "1400px", margin: "0 auto", padding: "2rem 1.5rem" }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "2rem",
        }}
      >
        <div>
          <h1
            style={{
              fontSize: "var(--font-size-2xl)",
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              gap: "0.625rem",
            }}
          >
            <FileSpreadsheet size={24} style={{ color: "var(--accent)" }} />
            Export Templates
          </h1>
          <p
            style={{
              color: "var(--text-muted)",
              fontSize: "var(--font-size-sm)",
              marginTop: "0.25rem",
            }}
          >
            Design reusable export layouts, column formats, default filters, and
            safe filenames for CSV and XLSX.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            setIsCreating(true);
            setSelectedTemplateId(null);
            if (entities.length > 0 && !newTemplateEntityId) {
              setNewTemplateEntityId(entities[0].id);
            }
          }}
          style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
        >
          <Plus size={16} /> New Template
        </button>
      </div>

      {/* Notifications */}
      {actionError && (
        <div
          style={{
            backgroundColor: "var(--danger-subtle)",
            border: "var(--border-width) solid var(--danger)",
            borderRadius: "var(--radius-surface)",
            padding: "var(--space-3) var(--space-4)",
            marginBottom: "1rem",
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
            color: "var(--danger)",
          }}
        >
          <AlertCircle size={16} />
          <span style={{ fontSize: "var(--font-size-sm)" }}>{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            style={{
              marginLeft: "auto",
              background: "none",
              border: "none",
              color: "inherit",
              cursor: "pointer",
            }}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {actionSuccess && (
        <div
          style={{
            backgroundColor: "var(--success-subtle)",
            border: "var(--border-width) solid var(--success)",
            borderRadius: "var(--radius-surface)",
            padding: "var(--space-3) var(--space-4)",
            marginBottom: "1rem",
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
            color: "var(--success)",
          }}
        >
          <Check size={16} />
          <span style={{ fontSize: "var(--font-size-sm)" }}>
            {actionSuccess}
          </span>
        </div>
      )}

      {/* Main Two-Panel Layout */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "320px 1fr",
          gap: "1.5rem",
          alignItems: "start",
        }}
      >
        {/* Left Panel: Template List */}
        <div
          style={{
            backgroundColor: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-surface)",
            padding: "1rem",
          }}
        >
          {/* Search Box */}
          <div
            style={{
              position: "relative",
              marginBottom: "1rem",
            }}
          >
            <Search
              size={15}
              style={{
                position: "absolute",
                left: "0.75rem",
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--text-muted)",
              }}
            />
            <input
              type="text"
              className="input"
              placeholder="Search templates..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              style={{
                paddingLeft: "2.25rem",
                width: "100%",
                fontSize: "var(--font-size-sm)",
              }}
            />
          </div>

          {templatesLoading ? (
            <div
              style={{
                textAlign: "center",
                padding: "2rem",
                color: "var(--text-muted)",
              }}
            >
              Loading templates...
            </div>
          ) : filteredTemplates.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                padding: "1.5rem 0.75rem",
                color: "var(--text-muted)",
                fontSize: "var(--font-size-sm)",
              }}
            >
              <p style={{ marginBottom: "0.75rem" }}>No export templates found</p>
              {entities.length > 0 && (
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  onClick={() => handleQuickCreateExecutiveTemplate()}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.375rem",
                    fontSize: "var(--font-size-xs)",
                  }}
                >
                  <FileSpreadsheet size={13} style={{ color: "var(--accent)" }} />
                  <span>Generate Starter Template</span>
                </button>
              )}
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.375rem",
              }}
            >
              {filteredTemplates.map((tpl) => {
                const ent = entities.find((e) => e.id === tpl.entityId);
                const isSelected = tpl.id === selectedTemplateId && !isCreating;
                return (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => {
                      setIsCreating(false);
                      setSelectedTemplateId(tpl.id);
                    }}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "0.75rem 0.875rem",
                      borderRadius: "var(--radius-control)",
                      border: isSelected
                        ? "1px solid var(--accent)"
                        : "1px solid transparent",
                      backgroundColor: isSelected
                        ? "var(--accent-subtle)"
                        : "transparent",
                      color: isSelected ? "var(--accent)" : "var(--text-main)",
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <span
                        style={{
                          fontWeight: 600,
                          fontSize: "var(--font-size-sm)",
                        }}
                      >
                        {tpl.name}
                      </span>
                      <span
                        style={{
                          fontSize: "var(--font-size-xs)",
                          padding: "0.125rem 0.375rem",
                          borderRadius: "var(--radius-control)",
                          backgroundColor:
                            tpl.draft?.kind === "grid"
                              ? "var(--accent-subtle)"
                              : tpl.published
                                ? "var(--success-subtle)"
                                : "var(--surface-subtle)",
                          color:
                            tpl.draft?.kind === "grid"
                              ? "var(--accent)"
                              : tpl.published
                                ? "var(--success)"
                                : "var(--text-muted)",
                        }}
                      >
                        {tpl.draft?.kind === "grid"
                          ? "Grid"
                          : tpl.published
                            ? `v${tpl.version} Pub`
                            : `v${tpl.version} Draft`}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: "var(--font-size-xs)",
                        color: "var(--text-muted)",
                        marginTop: "0.25rem",
                      }}
                    >
                      Entity: {ent ? ent.label : tpl.entityId}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Panel: Designer & Details */}
        <div
          style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}
        >
          {isCreating ? (
            /* Creation Card */
            <div
              style={{
                backgroundColor: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-surface)",
                padding: "1.5rem",
              }}
            >
              <h2
                style={{
                  fontSize: "var(--font-size-lg)",
                  fontWeight: 600,
                  marginBottom: "1.25rem",
                }}
              >
                Create Export Template
              </h2>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "1rem",
                  maxWidth: "500px",
                }}
              >
                <div>
                  <label
                    style={{
                      display: "block",
                      fontWeight: 600,
                      fontSize: "var(--font-size-sm)",
                      marginBottom: "0.375rem",
                    }}
                  >
                    Template Name
                  </label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g. Monthly Orders Report"
                    value={newTemplateName}
                    onChange={(e) => setNewTemplateName(e.target.value)}
                    style={{ width: "100%" }}
                  />
                </div>
                <div>
                  <label
                    style={{
                      display: "block",
                      fontWeight: 600,
                      fontSize: "var(--font-size-sm)",
                      marginBottom: "0.375rem",
                    }}
                  >
                    Target Entity
                  </label>
                  <select
                    className="input"
                    value={newTemplateEntityId}
                    onChange={(e) => setNewTemplateEntityId(e.target.value)}
                    style={{ width: "100%" }}
                  >
                    {entities.map((ent) => (
                      <option key={ent.id} value={ent.id}>
                        {ent.label} ({ent.name})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    style={{
                      display: "block",
                      fontWeight: 600,
                      fontSize: "var(--font-size-sm)",
                      marginBottom: "var(--space-1)",
                    }}
                  >
                    Template Kind
                  </label>
                  <div style={{ display: "flex", gap: "var(--space-4)" }}>
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "var(--space-2)",
                        cursor: "pointer",
                        fontSize: "var(--font-size-sm)",
                      }}
                    >
                      <input
                        type="radio"
                        name="templateKind"
                        value="simple"
                        checked={newTemplateKind === "simple"}
                        onChange={() => setNewTemplateKind("simple")}
                      />
                      <span>Simple (Column list)</span>
                    </label>
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "var(--space-2)",
                        cursor: "pointer",
                        fontSize: "var(--font-size-sm)",
                      }}
                    >
                      <input
                        type="radio"
                        name="templateKind"
                        value="grid"
                        checked={newTemplateKind === "grid"}
                        onChange={() => setNewTemplateKind("grid")}
                      />
                      <span>Grid (Spreadsheet Designer)</span>
                    </label>
                  </div>
                </div>

                {newTemplateKind === "grid" && (
                  <div>
                    <label
                      style={{
                        display: "block",
                        fontWeight: 600,
                        fontSize: "var(--font-size-sm)",
                        marginBottom: "var(--space-2)",
                      }}
                    >
                      Starting Layout
                    </label>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                        gap: "var(--space-3)",
                      }}
                    >
                      <div
                        onClick={() => setGridPreset("executive")}
                        style={{
                          padding: "var(--space-3)",
                          borderRadius: "var(--radius-control)",
                          border:
                            gridPreset === "executive"
                              ? "2px solid var(--accent)"
                              : "var(--border-width) solid var(--border)",
                          backgroundColor:
                            gridPreset === "executive"
                              ? "var(--accent-subtle)"
                              : "var(--surface-subtle)",
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "var(--space-2)",
                            marginBottom: "var(--space-1)",
                          }}
                        >
                          <FileSpreadsheet
                            size={16}
                            style={{ color: "var(--accent)" }}
                          />
                          <span
                            style={{
                              fontWeight: 600,
                              fontSize: "var(--font-size-sm)",
                              color: "var(--text-main)",
                            }}
                          >
                            Executive KPI & Breakdown
                          </span>
                        </div>
                        <p
                          style={{
                            margin: 0,
                            fontSize: "var(--font-size-xs)",
                            color: "var(--text-muted)",
                            lineHeight: 1.4,
                          }}
                        >
                          Four live KPI cards, totals, and a formatted,
                          entity-connected table with room for additional rows.
                        </p>
                      </div>

                      {GRID_STARTER_TEMPLATES.filter((starter) => starter.id !== "executive").map((starter) => (
                        <button
                          key={starter.id}
                          type="button"
                          onClick={() => setGridPreset(starter.id)}
                          aria-pressed={gridPreset === starter.id}
                          style={{
                            padding: "var(--space-3)",
                            borderRadius: "var(--radius-control)",
                            border: gridPreset === starter.id
                              ? "2px solid var(--accent)"
                              : "var(--border-width) solid var(--border)",
                            backgroundColor: gridPreset === starter.id
                              ? "var(--accent-subtle)"
                              : "var(--surface-subtle)",
                            color: "var(--text-main)",
                            textAlign: "left",
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                          }}
                        >
                          <span
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "var(--space-2)",
                              marginBottom: "var(--space-1)",
                              fontWeight: 600,
                              fontSize: "var(--font-size-sm)",
                            }}
                          >
                            <FileSpreadsheet size={16} style={{ color: "var(--accent)" }} />
                            {starter.name}
                          </span>
                          <span
                            style={{
                              display: "block",
                              fontSize: "var(--font-size-xs)",
                              color: "var(--text-muted)",
                              lineHeight: 1.4,
                            }}
                          >
                            {starter.description}
                          </span>
                        </button>
                      ))}

                      <div
                        onClick={() => setGridPreset("blank")}
                        style={{
                          padding: "var(--space-3)",
                          borderRadius: "var(--radius-control)",
                          border:
                            gridPreset === "blank"
                              ? "2px solid var(--accent)"
                              : "var(--border-width) solid var(--border)",
                          backgroundColor:
                            gridPreset === "blank"
                              ? "var(--accent-subtle)"
                              : "var(--surface-subtle)",
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "var(--space-2)",
                            marginBottom: "var(--space-1)",
                          }}
                        >
                          <FileSpreadsheet
                            size={16}
                            style={{ color: "var(--text-muted)" }}
                          />
                          <span
                            style={{
                              fontWeight: 600,
                              fontSize: "var(--font-size-sm)",
                              color: "var(--text-main)",
                            }}
                          >
                            Blank Spreadsheet
                          </span>
                        </div>
                        <p
                          style={{
                            margin: 0,
                            fontSize: "var(--font-size-xs)",
                            color: "var(--text-muted)",
                            lineHeight: 1.4,
                          }}
                        >
                          Clean canvas ready for custom design, cell bindings,
                          and datasets from scratch.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
                <div
                  style={{
                    display: "flex",
                    gap: "0.75rem",
                    marginTop: "0.5rem",
                  }}
                >
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={
                      !newTemplateName.trim() ||
                      !newTemplateEntityId ||
                      createMutation.isPending
                    }
                    onClick={() => createMutation.mutate()}
                  >
                    Create Template
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setIsCreating(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          ) : !selectedTemplate ? (
            <div
              style={{
                backgroundColor: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-surface)",
                padding: "3rem",
                textAlign: "center",
                color: "var(--text-muted)",
              }}
            >
              <FileSpreadsheet
                size={44}
                style={{ margin: "0 auto 1rem", color: "var(--accent)", opacity: 0.8 }}
              />
              <h3
                style={{
                  fontSize: "var(--font-size-base)",
                  fontWeight: 600,
                  color: "var(--text-main)",
                  marginBottom: "0.5rem",
                }}
              >
                No Export Templates Yet
              </h3>
              <p
                style={{
                  maxWidth: "440px",
                  margin: "0 auto 1.5rem",
                  fontSize: "var(--font-size-sm)",
                }}
              >
                Generate a professional executive report template with dynamic KPI cards, aggregated database metrics, and repeating breakdown tables with 1 click.
              </p>
              {entities.length > 0 ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => handleQuickCreateExecutiveTemplate()}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    margin: "0 auto",
                  }}
                >
                  <FileSpreadsheet size={16} />
                  <span>Generate Executive Template for {entities[0]?.label || entities[0]?.name}</span>
                </button>
              ) : (
                <p style={{ fontSize: "var(--font-size-xs)", color: "var(--text-muted)" }}>
                  Create an entity first to generate export templates.
                </p>
              )}
            </div>
          ) : selectedTemplate.draft?.kind === "grid" ? (
            <div
              style={{
                backgroundColor: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-surface)",
                padding: "3rem",
                textAlign: "center",
              }}
            >
              <FileSpreadsheet
                size={48}
                style={{ color: "var(--accent)", margin: "0 auto 1rem" }}
              />
              <h2
                style={{
                  fontSize: "var(--font-size-lg)",
                  fontWeight: 600,
                  marginBottom: "0.5rem",
                }}
              >
                {selectedTemplate.name}
              </h2>
              <p
                style={{
                  color: "var(--text-muted)",
                  fontSize: "var(--font-size-sm)",
                  marginBottom: "1.5rem",
                  maxWidth: "480px",
                  margin: "0 auto 1.5rem",
                }}
              >
                This is a spreadsheet grid template. Open the dedicated grid
                designer to edit layout, styles, merges, number formats, and
                static formulas.
              </p>
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  gap: "0.75rem",
                }}
              >
                <Link
                  to={`/studio/export-templates/${selectedTemplate.id}/designer`}
                  className="btn btn-primary"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.5rem",
                  }}
                >
                  <FileSpreadsheet size={16} /> Open Grid Designer
                </Link>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => duplicateMutation.mutate(selectedTemplate.id)}
                  disabled={duplicateMutation.isPending}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.5rem",
                  }}
                >
                  <Copy size={16} /> Duplicate
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    if (
                      window.confirm(
                        `Delete template '${selectedTemplate.name}'?`,
                      )
                    ) {
                      deleteMutation.mutate(selectedTemplate.id);
                    }
                  }}
                  disabled={deleteMutation.isPending}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    color: "var(--danger)",
                  }}
                >
                  <Trash2 size={16} /> Delete
                </button>
              </div>
            </div>
          ) : !draft ? (
            <div
              style={{
                backgroundColor: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-surface)",
                padding: "3rem",
                textAlign: "center",
                color: "var(--text-muted)",
              }}
            >
              <FileSpreadsheet
                size={40}
                style={{ margin: "0 auto 1rem", opacity: 0.4 }}
              />
              <p>
                Select an export template on the left or create a new one to
                begin designing.
              </p>
            </div>
          ) : (
            /* Template Editor */
            <>
              {/* Top Action Bar */}
              <div
                style={{
                  backgroundColor: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-surface)",
                  padding: "1.25rem",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "1rem",
                }}
              >
                <div
                  style={{ display: "flex", alignItems: "center", gap: "1rem" }}
                >
                  <input
                    type="text"
                    className="input"
                    value={draftName}
                    onChange={(e) => {
                      setDraftName(e.target.value);
                      setHasUnsavedChanges(true);
                    }}
                    style={{
                      fontWeight: 600,
                      fontSize: "var(--font-size-base)",
                      width: "280px",
                    }}
                  />
                  <span
                    style={{
                      fontSize: "var(--font-size-xs)",
                      padding: "0.25rem 0.5rem",
                      borderRadius: "var(--radius-control)",
                      backgroundColor: "var(--surface-subtle)",
                      color: "var(--text-muted)",
                    }}
                  >
                    v{selectedTemplate.version}{" "}
                    {selectedTemplate.published ? "Published" : "Draft"}
                  </span>
                  {hasUnsavedChanges && (
                    <span
                      style={{
                        fontSize: "var(--font-size-xs)",
                        color: "var(--warning)",
                        fontWeight: 500,
                      }}
                    >
                      Unsaved changes
                    </span>
                  )}
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                  }}
                >
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => saveMutation.mutate()}
                    disabled={saveMutation.isPending}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.375rem",
                    }}
                  >
                    <Save size={15} /> Save Draft
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => publishMutation.mutate()}
                    disabled={publishMutation.isPending}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.375rem",
                    }}
                  >
                    <Check size={15} /> Publish
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() =>
                      duplicateMutation.mutate(selectedTemplate.id)
                    }
                    title="Duplicate Template"
                    style={{ padding: "0.5rem" }}
                  >
                    <Copy size={16} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      if (
                        confirm(
                          `Delete export template '${selectedTemplate.name}'?`,
                        )
                      ) {
                        deleteMutation.mutate(selectedTemplate.id);
                      }
                    }}
                    title="Delete Template"
                    style={{ padding: "0.5rem", color: "var(--danger)" }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              {/* Column Selection & Reordering */}
              <div
                style={{
                  backgroundColor: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-surface)",
                  padding: "1.5rem",
                }}
              >
                <h3
                  style={{
                    fontSize: "var(--font-size-base)",
                    fontWeight: 600,
                    marginBottom: "0.5rem",
                  }}
                >
                  Columns ({draft.columns?.length} selected)
                </h3>
                <p
                  style={{
                    fontSize: "var(--font-size-sm)",
                    color: "var(--text-muted)",
                    marginBottom: "1rem",
                  }}
                >
                  Select fields to export, reorder them, customize header
                  labels, and pick formatting.
                </p>

                {/* Selected Columns List */}
                {draft.columns?.length === 0 ? (
                  <div
                    style={{
                      padding: "1.5rem",
                      textAlign: "center",
                      color: "var(--text-muted)",
                      fontSize: "var(--font-size-sm)",
                    }}
                  >
                    No columns added. Check fields below to add them to this
                    export template.
                  </div>
                ) : (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.5rem",
                      marginBottom: "1.5rem",
                    }}
                  >
                    {draft.columns?.map((col, idx) => {
                      const fieldDef = entityFields.find(
                        (f: ErdColumn) => f.id === col.fieldId,
                      );
                      return (
                        <div
                          key={col.fieldId}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "auto 1fr 180px 140px auto",
                            alignItems: "center",
                            gap: "0.75rem",
                            padding: "0.625rem 0.875rem",
                            backgroundColor: "var(--surface-subtle)",
                            borderRadius: "var(--radius-control)",
                            border: "1px solid var(--border)",
                          }}
                        >
                          <span
                            style={{
                              fontSize: "var(--font-size-xs)",
                              color: "var(--text-muted)",
                              width: "20px",
                            }}
                          >
                            {idx + 1}.
                          </span>
                          <div>
                            <div
                              style={{
                                fontSize: "var(--font-size-xs)",
                                color: "var(--text-muted)",
                              }}
                            >
                              Field: {fieldDef?.label || col.fieldId} (
                              {fieldDef?.type || "text"})
                            </div>
                            <input
                              type="text"
                              className="input"
                              placeholder="Header label"
                              value={col.header || ""}
                              onChange={(e) =>
                                handleUpdateColumn(idx, {
                                  header: e.target.value,
                                })
                              }
                              style={{
                                width: "100%",
                                marginTop: "0.25rem",
                                fontSize: "var(--font-size-sm)",
                              }}
                            />
                          </div>
                          <div>
                            <select
                              className="input"
                              value={col.format || "text"}
                              onChange={(e) =>
                                handleUpdateColumn(idx, {
                                  format: e.target.value,
                                })
                              }
                              style={{
                                width: "100%",
                                fontSize: "var(--font-size-xs)",
                              }}
                            >
                              <option value="text">Text (Default)</option>
                              <option value="number">Number</option>
                              <option value="currency">Currency</option>
                              <option value="percentage">Percentage</option>
                              <option value="date_iso">Date (ISO 8601)</option>
                              <option value="date_locale">Date (Locale)</option>
                              <option value="datetime_iso">
                                DateTime (ISO)
                              </option>
                              <option value="boolean_true_false">
                                Boolean (true/false)
                              </option>
                              <option value="boolean_yes_no">
                                Boolean (Yes/No)
                              </option>
                            </select>
                          </div>
                          <div style={{ display: "flex", gap: "0.25rem" }}>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              disabled={idx === 0}
                              onClick={() => handleMoveColumn(idx, "up")}
                              style={{ padding: "0.375rem" }}
                              title="Move up"
                            >
                              <ChevronUp size={14} />
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              disabled={idx === draft.columns?.length - 1}
                              onClick={() => handleMoveColumn(idx, "down")}
                              style={{ padding: "0.375rem" }}
                              title="Move down"
                            >
                              <ChevronDown size={14} />
                            </button>
                          </div>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() =>
                              handleToggleColumn(col.fieldId, col.header || "")
                            }
                            style={{
                              padding: "0.375rem",
                              color: "var(--danger)",
                            }}
                            title="Remove column"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Available Fields Picker */}
                {selectedEntity && (
                  <div>
                    <h4
                      style={{
                        fontSize: "var(--font-size-xs)",
                        fontWeight: 600,
                        color: "var(--text-muted)",
                        marginBottom: "0.5rem",
                        textTransform: "uppercase",
                      }}
                    >
                      Available Entity Fields
                    </h4>
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "0.5rem",
                      }}
                    >
                      {entityFields.map((f: ErdColumn) => {
                        const isSelected = draft.columns?.some(
                          (c) => c.fieldId === f.id,
                        );
                        return (
                          <button
                            key={f.id}
                            type="button"
                            onClick={() =>
                              handleToggleColumn(f.id, f.label || f.name)
                            }
                            style={{
                              padding: "0.375rem 0.75rem",
                              borderRadius: "var(--radius-control)",
                              fontSize: "var(--font-size-xs)",
                              border: isSelected
                                ? "1px solid var(--accent)"
                                : "1px solid var(--border)",
                              backgroundColor: isSelected
                                ? "var(--accent-subtle)"
                                : "var(--surface)",
                              color: isSelected
                                ? "var(--accent)"
                                : "var(--text-main)",
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "0.375rem",
                            }}
                          >
                            {isSelected ? (
                              <Check size={12} />
                            ) : (
                              <Plus size={12} />
                            )}
                            {f.label} ({f.type})
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Formatting, CSV & Filename Settings */}
              <div
                style={{
                  backgroundColor: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-surface)",
                  padding: "1.5rem",
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                  gap: "1.5rem",
                }}
              >
                {/* Filename Expression */}
                <div>
                  <h4
                    style={{
                      fontSize: "var(--font-size-sm)",
                      fontWeight: 600,
                      marginBottom: "0.5rem",
                    }}
                  >
                    Filename Expression
                  </h4>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g. {{ entity.name }}_{{ date }}"
                    value={draft.filenameExpression || ""}
                    onChange={(e) => {
                      setDraft({
                        ...draft,
                        filenameExpression: e.target.value,
                      });
                      setHasUnsavedChanges(true);
                    }}
                    style={{ width: "100%", fontSize: "var(--font-size-sm)" }}
                  />
                  <p
                    style={{
                      fontSize: "var(--font-size-xs)",
                      color: "var(--text-muted)",
                      marginTop: "0.375rem",
                    }}
                  >
                    Sandboxed expression. Variables available:{" "}
                    <code>entity.name</code>, <code>template.name</code>,{" "}
                    <code>date</code>, <code>timestamp</code>.
                  </p>
                </div>

                {/* CSV Options */}
                <div>
                  <h4
                    style={{
                      fontSize: "var(--font-size-sm)",
                      fontWeight: 600,
                      marginBottom: "0.5rem",
                    }}
                  >
                    CSV Export Options
                  </h4>
                  <div
                    style={{
                      display: "flex",
                      gap: "1rem",
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <label
                        style={{
                          fontSize: "var(--font-size-xs)",
                          color: "var(--text-muted)",
                          display: "block",
                          marginBottom: "0.25rem",
                        }}
                      >
                        Delimiter
                      </label>
                      <select
                        className="input"
                        value={draft.csv?.delimiter || ","}
                        onChange={(e) => {
                          setDraft({
                            ...draft,
                            csv: {
                              ...draft.csv,
                              delimiter: e.target.value as any,
                            },
                          });
                          setHasUnsavedChanges(true);
                        }}
                        style={{ fontSize: "var(--font-size-sm)" }}
                      >
                        <option value=",">Comma (,)</option>
                        <option value=";">Semicolon (;)</option>
                        <option value="&#9;">Tab (\t)</option>
                        <option value="|">Pipe (|)</option>
                      </select>
                    </div>
                    <div style={{ marginTop: "1.25rem" }}>
                      <label
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.375rem",
                          fontSize: "var(--font-size-sm)",
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={draft.csv?.bom ?? false}
                          onChange={(e) => {
                            setDraft({
                              ...draft,
                              csv: { ...draft.csv, bom: e.target.checked },
                            });
                            setHasUnsavedChanges(true);
                          }}
                        />
                        Include UTF-8 BOM
                      </label>
                    </div>
                  </div>
                </div>

                {/* Header Toggle & PDF Mode */}
                <div>
                  <h4
                    style={{
                      fontSize: "var(--font-size-sm)",
                      fontWeight: 600,
                      marginBottom: "0.5rem",
                    }}
                  >
                    General Options
                  </h4>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.5rem",
                    }}
                  >
                    <label
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.375rem",
                        fontSize: "var(--font-size-sm)",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={draft.includeHeader !== false}
                        onChange={(e) => {
                          setDraft({
                            ...draft,
                            includeHeader: e.target.checked,
                          });
                          setHasUnsavedChanges(true);
                        }}
                      />
                      Include Header Row
                    </label>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                        marginTop: "0.25rem",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "var(--font-size-xs)",
                          color: "var(--text-muted)",
                        }}
                      >
                        PDF Mode:
                      </span>
                      <select
                        className="input"
                        value={draft.pdf?.mode || "table"}
                        onChange={(e) => {
                          setDraft({
                            ...draft,
                            pdf: { mode: e.target.value as any },
                          });
                          setHasUnsavedChanges(true);
                        }}
                        style={{ fontSize: "var(--font-size-xs)" }}
                      >
                        <option value="table">Table Mode</option>
                        <option value="layout">Layout Mode</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              {/* Default Sorts & Filters */}
              <div
                style={{
                  backgroundColor: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-surface)",
                  padding: "1.5rem",
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "1.5rem",
                }}
              >
                {/* Default Sort */}
                <div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: "0.75rem",
                    }}
                  >
                    <h4
                      style={{
                        fontSize: "var(--font-size-sm)",
                        fontWeight: 600,
                      }}
                    >
                      Default Sorting
                    </h4>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={handleAddSort}
                      style={{
                        fontSize: "var(--font-size-xs)",
                        padding: "0.25rem 0.5rem",
                      }}
                    >
                      <Plus size={13} /> Add Sort
                    </button>
                  </div>
                  {(draft.defaultSort || []).length === 0 ? (
                    <p
                      style={{
                        fontSize: "var(--font-size-xs)",
                        color: "var(--text-muted)",
                      }}
                    >
                      No default sort specified (uses ID ASC).
                    </p>
                  ) : (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.5rem",
                      }}
                    >
                      {draft.defaultSort?.map((s, idx) => (
                        <div
                          key={idx}
                          style={{
                            display: "flex",
                            gap: "0.5rem",
                            alignItems: "center",
                          }}
                        >
                          <select
                            className="input"
                            value={s.fieldId}
                            onChange={(e) => {
                              const next = [...(draft.defaultSort || [])];
                              next[idx] = {
                                ...next[idx],
                                fieldId: e.target.value,
                              };
                              setDraft({ ...draft, defaultSort: next });
                              setHasUnsavedChanges(true);
                            }}
                            style={{ flex: 1, fontSize: "var(--font-size-xs)" }}
                          >
                            {entityFields.map((f: ErdColumn) => (
                              <option key={f.id} value={f.id}>
                                {f.label || f.name}
                              </option>
                            ))}
                          </select>
                          <select
                            className="input"
                            value={s.direction}
                            onChange={(e) => {
                              const next = [...(draft.defaultSort || [])];
                              next[idx] = {
                                ...next[idx],
                                direction: e.target.value as any,
                              };
                              setDraft({ ...draft, defaultSort: next });
                              setHasUnsavedChanges(true);
                            }}
                            style={{
                              width: "90px",
                              fontSize: "var(--font-size-xs)",
                            }}
                          >
                            <option value="asc">ASC</option>
                            <option value="desc">DESC</option>
                          </select>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => handleRemoveSort(idx)}
                            style={{
                              padding: "0.25rem",
                              color: "var(--danger)",
                            }}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Default Filters */}
                <div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: "0.75rem",
                    }}
                  >
                    <h4
                      style={{
                        fontSize: "var(--font-size-sm)",
                        fontWeight: 600,
                      }}
                    >
                      Default Filters
                    </h4>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={handleAddFilter}
                      style={{
                        fontSize: "var(--font-size-xs)",
                        padding: "0.25rem 0.5rem",
                      }}
                    >
                      <Plus size={13} /> Add Filter
                    </button>
                  </div>
                  {(draft.defaultFilters || []).length === 0 ? (
                    <p
                      style={{
                        fontSize: "var(--font-size-xs)",
                        color: "var(--text-muted)",
                      }}
                    >
                      No default filters.
                    </p>
                  ) : (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.5rem",
                      }}
                    >
                      {draft.defaultFilters?.map((f, idx) => (
                        <div
                          key={idx}
                          style={{
                            display: "flex",
                            gap: "0.375rem",
                            alignItems: "center",
                          }}
                        >
                          <select
                            className="input"
                            value={f.fieldId}
                            onChange={(e) => {
                              const next = [...(draft.defaultFilters || [])];
                              next[idx] = {
                                ...next[idx],
                                fieldId: e.target.value,
                              };
                              setDraft({ ...draft, defaultFilters: next });
                              setHasUnsavedChanges(true);
                            }}
                            style={{ flex: 1, fontSize: "var(--font-size-xs)" }}
                          >
                            {entityFields.map((field: ErdColumn) => (
                              <option key={field.id} value={field.id}>
                                {field.label || field.name}
                              </option>
                            ))}
                          </select>
                          <select
                            className="input"
                            value={f.op}
                            onChange={(e) => {
                              const next = [...(draft.defaultFilters || [])];
                              next[idx] = {
                                ...next[idx],
                                op: e.target.value as any,
                              };
                              setDraft({ ...draft, defaultFilters: next });
                              setHasUnsavedChanges(true);
                            }}
                            style={{
                              width: "100px",
                              fontSize: "var(--font-size-xs)",
                            }}
                          >
                            <option value="eq">Equals</option>
                            <option value="neq">Not equals</option>
                            <option value="contains">Contains</option>
                            <option value="gt">&gt;</option>
                            <option value="gte">&gt;=</option>
                            <option value="lt">&lt;</option>
                            <option value="lte">&lt;=</option>
                            <option value="isNull">Is null</option>
                          </select>
                          <input
                            type="text"
                            className="input"
                            placeholder="Value"
                            value={f.value ?? ""}
                            onChange={(e) => {
                              const next = [...(draft.defaultFilters || [])];
                              next[idx] = {
                                ...next[idx],
                                value: e.target.value,
                              };
                              setDraft({ ...draft, defaultFilters: next });
                              setHasUnsavedChanges(true);
                            }}
                            style={{
                              width: "90px",
                              fontSize: "var(--font-size-xs)",
                            }}
                          />
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => handleRemoveFilter(idx)}
                            style={{
                              padding: "0.25rem",
                              color: "var(--danger)",
                            }}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Live Preview (20 Rows) & Test Export */}
              <div
                style={{
                  backgroundColor: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-surface)",
                  padding: "1.5rem",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "1rem",
                  }}
                >
                  <div>
                    <h3
                      style={{
                        fontSize: "var(--font-size-base)",
                        fontWeight: 600,
                      }}
                    >
                      Live Preview (First 20 Rows)
                    </h3>
                    <p
                      style={{
                        fontSize: "var(--font-size-xs)",
                        color: "var(--text-muted)",
                      }}
                    >
                      Preview formatted values, resolved reference displays, and
                      column order with active settings.
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={handleFetchPreview}
                      disabled={previewLoading}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.375rem",
                        fontSize: "var(--font-size-xs)",
                      }}
                    >
                      <Eye size={14} />{" "}
                      {previewLoading ? "Loading..." : "Generate Preview"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => handleTestDownload("xlsx")}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.375rem",
                        fontSize: "var(--font-size-xs)",
                      }}
                      title="Test download XLSX"
                    >
                      <Download size={14} /> Export XLSX
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => handleTestDownload("csv")}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.375rem",
                        fontSize: "var(--font-size-xs)",
                      }}
                      title="Test download CSV"
                    >
                      <Download size={14} /> Export CSV
                    </button>
                  </div>
                </div>

                {previewData ? (
                  <div
                    style={{
                      overflowX: "auto",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-control)",
                    }}
                  >
                    <table
                      style={{
                        width: "100%",
                        borderCollapse: "collapse",
                        textAlign: "left",
                        fontSize: "var(--font-size-xs)",
                      }}
                    >
                      <thead>
                        <tr
                          style={{
                            backgroundColor: "var(--surface-subtle)",
                            borderBottom: "1px solid var(--border)",
                          }}
                        >
                          {previewData.columns?.map((c) => (
                            <th
                              key={c.fieldId}
                              style={{
                                padding: "0.625rem 0.75rem",
                                fontWeight: 600,
                                color: "var(--text-muted)",
                              }}
                            >
                              {c.header}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewData.rows.length === 0 ? (
                          <tr>
                            <td
                              colSpan={previewData.columns?.length}
                              style={{
                                padding: "1.5rem",
                                textAlign: "center",
                                color: "var(--text-muted)",
                              }}
                            >
                              No records found for this entity.
                            </td>
                          </tr>
                        ) : (
                          previewData.rows.map((row, rIdx) => (
                            <tr
                              key={rIdx}
                              style={{
                                borderBottom: "1px solid var(--border)",
                              }}
                            >
                              {previewData.columns?.map((c) => (
                                <td
                                  key={c.fieldId}
                                  style={{ padding: "0.5rem 0.75rem" }}
                                >
                                  {row[c.fieldId] !== undefined &&
                                  row[c.fieldId] !== null
                                    ? String(row[c.fieldId])
                                    : ""}
                                </td>
                              ))}
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div
                    style={{
                      padding: "2rem",
                      textAlign: "center",
                      color: "var(--text-muted)",
                      fontSize: "var(--font-size-sm)",
                      border: "1px dashed var(--border)",
                      borderRadius: "var(--radius-control)",
                    }}
                  >
                    Click &quot;Generate Preview&quot; to test row rendering
                    against current entity data.
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
