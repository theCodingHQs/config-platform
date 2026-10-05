import React, { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  GripVertical,
  Copy,
  X,
  Undo2,
  Redo2,
  Check,
  AlertTriangle,
  ArrowLeft,
  Plus,
  Database,
  Sliders,
  LayoutTemplate,
  Shield,
  MousePointerClick,
} from "lucide-react";

import { useMetadata } from "../context/metadata-context";
import { renderNode } from "../renderer/render-node";
import { PageRuntimeProvider } from "../context/page-runtime-context";
import { ExpressionInput } from "./ExpressionInput";
import { ActionEditor } from "./ActionEditor";
import { StateEditorModal } from "./StateEditorModal";
import { DataSourceEditorModal } from "./DataSourceEditorModal";
import { TemplatePickerModal } from "./TemplatePickerModal";
import { ComponentOverlay } from "./ComponentOverlay";
import { createTemplatePage, type TemplateType } from "./templates";
import {
  fetchPage,
  updatePage,
  publishPage,
  type PageDetail,
} from "../api/client";
import type {
  PageDefinition,
  NodeDefinition,
  NodeType,
  DataSourceDefinition,
} from "@config-platform/schema";

// Stable JSON stringifier for accurate dirty / change detection regardless of object key order
function stableStringify(obj: any): string {
  if (obj === null || obj === undefined) return "";
  if (typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(stableStringify).join(",") + "]";
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

// Helper tree functions
function findNode(root: NodeDefinition, id: string): NodeDefinition | null {
  if (root.id === id) return root;
  if (root.children) {
    for (const child of root.children) {
      const found = findNode(child, id);
      if (found) return found;
    }
  }
  return null;
}

function updateNodeInTree(
  root: NodeDefinition,
  targetId: string,
  updater: (node: NodeDefinition) => NodeDefinition,
): NodeDefinition {
  if (root.id === targetId) {
    return updater(root);
  }
  if (!root.children) return root;

  return {
    ...root,
    children: root.children.map((child) =>
      updateNodeInTree(child, targetId, updater),
    ),
  };
}

function removeNodeFromTree(
  root: NodeDefinition,
  targetId: string,
): NodeDefinition {
  if (!root.children) return root;
  return {
    ...root,
    children: root.children
      .filter((child) => child.id !== targetId)
      .map((child) => removeNodeFromTree(child, targetId)),
  };
}

function insertNodeIntoTree(
  root: NodeDefinition,
  targetParentId: string,
  newNode: NodeDefinition,
): NodeDefinition {
  if (root.id === targetParentId) {
    return {
      ...root,
      children: [...(root.children || []), newNode],
    };
  }
  if (!root.children) return root;

  return {
    ...root,
    children: root.children.map((child) =>
      insertNodeIntoTree(child, targetParentId, newNode),
    ),
  };
}

function cloneNodeWithNewIds(node: NodeDefinition): NodeDefinition {
  const newId = `${node.type}_${Math.random().toString(36).substring(2, 7)}`;
  return {
    ...node,
    id: newId,
    children: node.children
      ? node.children.map(cloneNodeWithNewIds)
      : undefined,
  };
}

// Tree view item component
const SortableTreeItem: React.FC<{
  node: NodeDefinition;
  depth?: number;
  selectedId: string | null;
  hoveredId: string | null;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
}> = ({
  node,
  depth = 0,
  selectedId,
  hoveredId,
  onSelect,
  onHover,
  onDelete,
  onDuplicate,
}) => {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({
      id: node.id,
    });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    marginLeft: `${depth * 14}px`,
  };

  const isSelected = selectedId === node.id;
  const isHovered = hoveredId === node.id;

  return (
    <div style={style} ref={setNodeRef}>
      <div
        onClick={() => onSelect(isSelected ? null : node.id)}
        onMouseEnter={(e) => {
          e.stopPropagation();
          onHover(node.id);
        }}
        onMouseLeave={(e) => {
          e.stopPropagation();
          onHover(null);
        }}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0.375rem 0.5rem",
          borderRadius: "var(--radius-sm)",
          backgroundColor: isSelected
            ? "var(--accent-subtle)"
            : isHovered
              ? "var(--surface-2)"
              : "transparent",
          border: isSelected
            ? "1px solid var(--accent)"
            : isHovered
              ? "1px dashed var(--accent)"
              : "1px solid transparent",
          cursor: "pointer",
          fontSize: "var(--font-size-xs)",
          marginBottom: "var(--spacing-1)",
          transition: "all 0.12s ease",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <span
            {...attributes}
            {...listeners}
            style={{
              cursor: "grab",
              color: "var(--muted)",
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            <GripVertical size={13} />
          </span>
          <span
            style={{
              fontWeight: 600,
              color: isSelected
                ? "var(--accent)"
                : isHovered
                  ? "var(--accent)"
                  : "var(--text)",
            }}
          >
            {node.type}
          </span>
          <span
            style={{
              color: "var(--muted)",
              fontSize: "var(--font-size-xs)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {node.id}
          </span>
        </div>

        <div style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}>
          <button
            type="button"
            className="btn btn-ghost"
            style={{
              padding: "0.125rem 0.25rem",
              display: "inline-flex",
              alignItems: "center",
            }}
            onClick={(e) => {
              e.stopPropagation();
              onDuplicate(node.id);
            }}
            title="Duplicate"
            aria-label="Duplicate"
          >
            <Copy size={12} />
          </button>
          {depth > 0 && (
            <button
              type="button"
              className="btn btn-ghost"
              style={{
                padding: "0.125rem 0.25rem",
                color: "var(--danger)",
                display: "inline-flex",
                alignItems: "center",
              }}
              onClick={(e) => {
                e.stopPropagation();
                onDelete(node.id);
              }}
              title="Delete"
              aria-label="Delete"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {node.children && node.children.length > 0 && (
        <div>
          {node.children.map((child) => (
            <SortableTreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              hoveredId={hoveredId}
              onSelect={onSelect}
              onHover={onHover}
              onDelete={onDelete}
              onDuplicate={onDuplicate}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const PageBuilder: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { tenantId, entities } = useMetadata();
  const queryClient = useQueryClient();

  const [pageDetail, setPageDetail] = useState<PageDetail | null>(null);
  const [draft, setDraft] = useState<PageDefinition | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const [isPreviewPublished, setIsPreviewPublished] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [showValidationPopover, setShowValidationPopover] = useState(false);

  // Modals for State, Data Sources, and Templates
  const [isStateModalOpen, setIsStateModalOpen] = useState(false);
  const [isDataSourceModalOpen, setIsDataSourceModalOpen] = useState(false);
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [isRolesModalOpen, setIsRolesModalOpen] = useState(false);

  // Undo/Redo history stack
  const [history, setHistory] = useState<PageDefinition[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const { data, isLoading, error } = useQuery<PageDetail, Error>({
    queryKey: ["page", tenantId, id],
    queryFn: () => fetchPage(tenantId, id!),
    enabled: Boolean(id),
  });

  useEffect(() => {
    if (data && !draft) {
      setPageDetail(data);
      setDraft(data.draft);
      setHistory([data.draft]);
      setHistoryIndex(0);
      setSelectedNodeId(data.draft.root?.id || null);
    }
  }, [data, draft]);

  // Update draft with undo/redo history tracking
  const pushDraftUpdate = useCallback(
    (newDraft: PageDefinition) => {
      setDraft(newDraft);
      setHistory((prev) => {
        const truncated = prev.slice(0, historyIndex + 1);
        return [...truncated, newDraft];
      });
      setHistoryIndex((prev) => prev + 1);
    },
    [historyIndex],
  );

  const handleUndo = () => {
    if (historyIndex > 0) {
      const prevDraft = history[historyIndex - 1];
      setDraft(prevDraft);
      setHistoryIndex(historyIndex - 1);
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const nextDraft = history[historyIndex + 1];
      setDraft(nextDraft);
      setHistoryIndex(historyIndex + 1);
    }
  };

  // Debounced auto-save
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (!draft || !pageDetail) return;
    if (JSON.stringify(draft) === JSON.stringify(pageDetail.draft)) return;

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      handleSaveDraft();
    }, 1500);

    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [draft]);

  // Change detection: is draft modified vs DB draft, and does draft differ from live published
  const isDraftDirty = Boolean(
    draft && pageDetail && stableStringify(draft) !== stableStringify(pageDetail.draft)
  );

  const hasUnpublishedChanges = Boolean(
    draft &&
      (!pageDetail?.published ||
        stableStringify(draft) !== stableStringify(pageDetail.published))
  );

  // Prevent accidental loss of unsaved changes if closing/reloading window
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDraftDirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDraftDirty]);

  const handleSaveDraft = async () => {
    if (!draft || !pageDetail) return;
    setIsSaving(true);
    try {
      const updated = await updatePage(tenantId, pageDetail.id, {
        draft,
        expectedVersion: pageDetail.version,
      });
      setPageDetail(updated);
      setSaveStatus("Draft saved");
      setTimeout(() => setSaveStatus(null), 2500);
      queryClient.invalidateQueries({ queryKey: ["pages", tenantId] });
      return updated;
    } catch (err: any) {
      setSaveStatus(`Save error: ${err.message}`);
      throw err;
    } finally {
      setIsSaving(false);
    }
  };

  const publishMut = useMutation({
    mutationFn: () => publishPage(tenantId, pageDetail?.id || id!),
    onSuccess: (updated) => {
      setPageDetail(updated);
      setSaveStatus("Published successfully!");
      setTimeout(() => setSaveStatus(null), 3000);
      queryClient.invalidateQueries({ queryKey: ["pages", tenantId] });
      queryClient.invalidateQueries({
        queryKey: ["published-pages", tenantId],
      });
    },
    onError: (err: any) => setSaveStatus(`Publish error: ${err.message}`),
  });

  const handlePublish = async () => {
    if (!pageDetail || publishMut.isPending || !hasUnpublishedChanges) return;
    // If user edited but debounced save hasn't run yet, save draft first to avoid losing changes
    if (isDraftDirty) {
      try {
        await handleSaveDraft();
      } catch {
        return;
      }
    }
    publishMut.mutate();
  };

  // DnD Sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !draft) return;

    if (draft.root.children) {
      const oldIndex = draft.root.children.findIndex((c) => c.id === active.id);
      const newIndex = draft.root.children.findIndex((c) => c.id === over.id);

      if (oldIndex !== -1 && newIndex !== -1) {
        const newChildren = [...draft.root.children];
        const [moved] = newChildren.splice(oldIndex, 1);
        newChildren.splice(newIndex, 0, moved);

        pushDraftUpdate({
          ...draft,
          root: { ...draft.root, children: newChildren },
        });
      }
    }
  };

  // Add component from palette
  const handleAddComponent = (type: NodeType) => {
    if (!draft) return;
    const newId = `${type}_${Math.random().toString(36).substring(2, 7)}`;
    let newProps: Record<string, any> = {};

    const firstEntity = entities[0];
    const firstCols = (firstEntity?.columns || []).filter(
      (c) => !["id", "created_at", "updated_at"].includes(c.id),
    );
    const firstDs = draft.dataSources?.[0];

    switch (type) {
      case "text":
        newProps = { value: "New text heading", variant: "body" };
        break;
      case "button":
        newProps = { label: "Click Me", variant: "primary", onClick: [] };
        break;
      case "table":
        newProps = firstDs
          ? {
              source: firstDs.id,
              columns: firstCols.slice(0, 3).map((c) => ({ fieldId: c.id })),
              pageSize: 10,
            }
          : {
              entityId: firstEntity?.id || "",
              columns: firstCols.slice(0, 3).map((c) => ({ fieldId: c.id })),
              pageSize: 10,
            };
        break;
      case "form":
        newProps = {
          entityId: firstEntity?.id || "",
          fields: firstCols.slice(0, 3).map((c) => ({ fieldId: c.id })),
          mode: "create",
        };
        break;
      case "stack":
        newProps = { direction: "vertical", gap: 16 };
        break;
      case "grid":
        newProps = { columns: 2, gap: 16, responsiveCollapse: true };
        break;
      case "card":
        newProps = { title: "Card Title", subtitle: "" };
        break;
      case "tabs":
        newProps = {
          tabs: [
            { id: "tab1", label: "Tab 1" },
            { id: "tab2", label: "Tab 2" },
          ],
          defaultTab: "tab1",
        };
        break;
      case "stat":
        newProps = {
          entityId: firstEntity?.id || "",
          op: "count",
          label: `Total ${firstEntity?.label || "Items"}`,
        };
        break;
      case "chart":
        newProps = firstDs
          ? {
              source: firstDs.id,
              type: "bar",
              title: `${firstEntity?.label || "Data"} Chart`,
              groupByFieldId: firstCols[0]?.id || "id",
              aggregateOp: "count",
            }
          : {
              entityId: firstEntity?.id || "",
              type: "bar",
              title: `${firstEntity?.label || "Data"} Chart`,
              groupByFieldId: firstCols[0]?.id || "id",
              aggregateOp: "count",
            };
        break;
      case "modal":
        newProps = { title: "Modal Window", openStateKey: "isModalOpen" };
        break;
      case "select":
        newProps = {
          label: "Select Option",
          valueKey: "selectedValue",
          options: [{ label: "Option 1", value: "opt1" }],
        };
        break;
      case "input":
        newProps = {
          label: "Input Field",
          placeholder: "Enter value...",
          type: "text",
          valueKey: "inputValue",
        };
        break;
      case "details":
        newProps = firstDs
          ? {
              source: firstDs.id,
              recordId: "{{ state.selectedId }}",
              fields: firstCols.slice(0, 4).map((c) => ({ fieldId: c.id })),
            }
          : {
              entityId: firstEntity?.id || "",
              recordId: "{{ state.selectedId }}",
              fields: firstCols.slice(0, 4).map((c) => ({ fieldId: c.id })),
            };
        break;
    }

    const isContainer = ["stack", "modal", "grid", "card", "tabs"].includes(
      type,
    );
    const newNode: NodeDefinition = {
      id: newId,
      type,
      props: newProps,
      children: isContainer ? [] : undefined,
    };

    const selected = selectedNodeId
      ? findNode(draft.root, selectedNodeId)
      : null;
    const canAcceptChildren =
      selected &&
      ["stack", "modal", "grid", "card", "tabs"].includes(selected.type);

    let updatedRoot: NodeDefinition;
    if (canAcceptChildren) {
      updatedRoot = insertNodeIntoTree(draft.root, selected.id, newNode);
    } else {
      updatedRoot = insertNodeIntoTree(draft.root, draft.root.id, newNode);
    }

    pushDraftUpdate({
      ...draft,
      root: updatedRoot,
    });
    setSelectedNodeId(newId);
  };

  const handleDeleteNode = (nodeId: string) => {
    if (!draft || nodeId === draft.root.id) return;
    const updatedRoot = removeNodeFromTree(draft.root, nodeId);
    pushDraftUpdate({
      ...draft,
      root: updatedRoot,
    });
    if (selectedNodeId === nodeId) {
      setSelectedNodeId(draft.root.id);
    }
  };

  const handleDuplicateNode = (nodeId: string) => {
    if (!draft || nodeId === draft.root.id) return;
    const target = findNode(draft.root, nodeId);
    if (!target) return;
    const clone = cloneNodeWithNewIds(target);
    const updatedRoot = insertNodeIntoTree(draft.root, draft.root.id, clone);
    pushDraftUpdate({
      ...draft,
      root: updatedRoot,
    });
    setSelectedNodeId(clone.id);
  };

  // Keyboard shortcuts: Delete removes selected node, Cmd/Ctrl+Z/Shift+Z undo/redo, Cmd/Ctrl+D duplicates
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }

      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const isCmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      if (isCmdOrCtrl && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }

      if (isCmdOrCtrl && e.key.toLowerCase() === "y") {
        e.preventDefault();
        handleRedo();
        return;
      }

      if (isCmdOrCtrl && e.key.toLowerCase() === "d") {
        e.preventDefault();
        if (selectedNodeId && selectedNodeId !== draft?.root.id) {
          handleDuplicateNode(selectedNodeId);
        }
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedNodeId && selectedNodeId !== draft?.root.id) {
          e.preventDefault();
          handleDeleteNode(selectedNodeId);
        }
        return;
      }

      if (e.key === "Escape") {
        if (selectedNodeId) {
          e.preventDefault();
          setSelectedNodeId(null);
        }
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [draft, selectedNodeId, historyIndex, history]);

  const handleUpdateProps = (newProps: Record<string, any>) => {
    if (!draft || !selectedNodeId) return;
    const updatedRoot = updateNodeInTree(
      draft.root,
      selectedNodeId,
      (node) => ({
        ...node,
        props: newProps,
      }),
    );
    pushDraftUpdate({
      ...draft,
      root: updatedRoot,
    });
  };

  const handleUpdateNode = (
    updater: (node: NodeDefinition) => NodeDefinition,
  ) => {
    if (!draft || !selectedNodeId) return;
    const updatedRoot = updateNodeInTree(draft.root, selectedNodeId, updater);
    pushDraftUpdate({
      ...draft,
      root: updatedRoot,
    });
  };

  if (isLoading || (!error && (!pageDetail || !draft))) {
    return (
      <div
        style={{
          padding: "2rem",
          textAlign: "center",
          color: "var(--text-muted)",
        }}
      >
        Loading page builder...
      </div>
    );
  }

  if (error || !pageDetail || !draft) {
    return (
      <div style={{ padding: "2rem", color: "var(--danger)" }}>
        Failed to load page: {error?.message || "Page not found"}
      </div>
    );
  }

  const selectedNode = selectedNodeId
    ? findNode(draft.root, selectedNodeId)
    : null;
  const brokenBindings = pageDetail.brokenBindings || [];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
      }}
      className="main-height"
    >
      {/* Builder Top Bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0.5rem 1rem",
          borderBottom: "1px solid var(--border)",
          backgroundColor: "var(--surface)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => navigate("/studio/pages")}
            style={{
              padding: "0.25rem 0.5rem",
              display: "inline-flex",
              alignItems: "center",
              gap: "0.25rem",
            }}
          >
            <ArrowLeft size={16} /> Pages
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontWeight: 600, fontSize: "var(--font-size-sm)" }}>
              {pageDetail.name}
            </span>
            <span style={{ color: "var(--text-muted)", fontSize: "var(--font-size-sm)" }}>
              {pageDetail.route}
            </span>
            <span className="badge" style={{ fontSize: "var(--font-size-xs)" }}>
              v{pageDetail.version}
            </span>

            {/* Publication / Change Status Badge */}
            {hasUnpublishedChanges ? (
              <span
                data-testid="status-unpublished-badge"
                style={{
                  fontSize: "var(--font-size-xs)",
                  padding: "0.15rem var(--space-2)",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "var(--warning-subtle)",
                  color: "var(--warning)",
                  border: "var(--border-width) solid var(--warning)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "var(--space-1)",
                  fontWeight: 600,
                  letterSpacing: "0.01em",
                }}
                title="Draft has changes that have not been published live yet"
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "var(--radius-full)",
                    backgroundColor: "var(--warning)",
                  }}
                />
                Unpublished Changes
              </span>
            ) : (
              <span
                data-testid="status-uptodate-badge"
                style={{
                  fontSize: "var(--font-size-xs)",
                  padding: "0.15rem var(--space-2)",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "var(--success-subtle)",
                  color: "var(--success)",
                  border: "var(--border-width) solid var(--success)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "var(--space-1)",
                  fontWeight: 600,
                }}
                title="All draft changes are published and live"
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "var(--radius-full)",
                    backgroundColor: "var(--success)",
                  }}
                />
                Up to Date
              </span>
            )}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {saveStatus && (
            <span style={{ fontSize: "var(--font-size-xs)", color: "var(--text-muted)" }}>
              {saveStatus}
            </span>
          )}

          {/* Undo / Redo */}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={handleUndo}
            disabled={historyIndex <= 0}
            title="Undo"
            aria-label="Undo"
            style={{ padding: "0.25rem 0.5rem" }}
          >
            <Undo2 size={16} />
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={handleRedo}
            disabled={historyIndex >= history.length - 1}
            title="Redo"
            aria-label="Redo"
            style={{ padding: "0.25rem 0.5rem" }}
          >
            <Redo2 size={16} />
          </button>

          {/* State & Data Sources Buttons */}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setIsStateModalOpen(true)}
            style={{
              fontSize: "var(--font-size-xs)",
              padding: "0.375rem 0.625rem",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <Sliders size={13} /> State ({Object.keys(draft.state || {}).length}
            )
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setIsDataSourceModalOpen(true)}
            style={{
              fontSize: "var(--font-size-xs)",
              padding: "0.375rem 0.625rem",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <Database size={13} /> Data Sources (
            {(draft.dataSources || []).length})
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setIsTemplateModalOpen(true)}
            style={{
              fontSize: "var(--font-size-xs)",
              padding: "0.375rem 0.625rem",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <LayoutTemplate size={13} /> Templates
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setIsRolesModalOpen(true)}
            style={{
              fontSize: "var(--font-size-xs)",
              padding: "0.375rem 0.625rem",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <Shield size={13} /> Allowed Roles (
            {draft.allowedRoles && draft.allowedRoles.length > 0
              ? draft.allowedRoles.length
              : "All"}
            )
          </button>

          {/* Validation Status Indicator */}
          <div style={{ position: "relative" }}>
            <button
              type="button"
              onClick={() => setShowValidationPopover(!showValidationPopover)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.25rem",
                padding: "0.25rem 0.5rem",
                borderRadius: "var(--radius-sm)",
                fontSize: "var(--font-size-xs)",
                cursor: "pointer",
                backgroundColor:
                  brokenBindings.length === 0
                    ? "var(--success-bg)"
                    : "var(--warning-bg)",
                color:
                  brokenBindings.length === 0
                    ? "var(--success)"
                    : "var(--warning)",
                border: `1px solid ${brokenBindings.length === 0 ? "transparent" : "var(--warning-border)"}`,
              }}
            >
              {brokenBindings.length === 0 ? (
                <>
                  <Check size={14} /> Valid
                </>
              ) : (
                <>
                  <AlertTriangle size={14} /> {brokenBindings.length} broken
                </>
              )}
            </button>

            {showValidationPopover && (
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  right: 0,
                  marginTop: "0.375rem",
                  width: "320px",
                  backgroundColor: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius)",
                  padding: "0.75rem",
                  boxShadow: "var(--shadow-md)",
                  zIndex: 50,
                  fontSize: "var(--font-size-xs)",
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: "var(--space-1)" }}>
                  Binding Validation
                </div>
                {brokenBindings.length === 0 ? (
                  <p style={{ color: "var(--success)" }}>
                    All entity and field bindings are intact.
                  </p>
                ) : (
                  <ul
                    style={{
                      paddingLeft: "var(--space-5)",
                      color: "var(--danger)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "var(--space-1)",
                    }}
                  >
                    {brokenBindings.map((msg, i) => (
                      <li key={i}>{msg}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* Preview Published toggle */}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setIsPreviewPublished(!isPreviewPublished)}
            style={{ fontSize: "var(--font-size-xs)", padding: "var(--space-1) var(--space-3)" }}
            title={
              pageDetail.published
                ? isPreviewPublished
                  ? "Return to interactive draft canvas"
                  : "Preview the live published page"
                : "Page has not been published yet"
            }
          >
            {isPreviewPublished ? "View Draft" : "Preview Published"}
          </button>

          {/* Save Draft Button */}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleSaveDraft}
            disabled={isSaving || !isDraftDirty}
            style={{
              fontSize: "var(--font-size-xs)",
              padding: "var(--space-1) var(--space-3)",
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--space-1)",
              opacity: !isDraftDirty && !isSaving ? 0.65 : 1,
            }}
            title={isDraftDirty ? "Save changes to draft" : "Draft is already saved"}
          >
            {isSaving ? (
              "Saving..."
            ) : isDraftDirty ? (
              <>
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "var(--radius-full)",
                    backgroundColor: "var(--warning)",
                  }}
                />
                Save Draft
              </>
            ) : (
              <>
                <Check size={13} style={{ color: "var(--success)" }} />
                Draft Saved
              </>
            )}
          </button>

          {/* Publish Button */}
          <button
            type="button"
            aria-label="Publish"
            data-testid="publish-btn"
            className={hasUnpublishedChanges ? "btn btn-primary" : "btn btn-secondary"}
            onClick={handlePublish}
            disabled={publishMut.isPending || !hasUnpublishedChanges}
            style={{
              fontSize: "var(--font-size-xs)",
              padding: "var(--space-1) var(--space-3)",
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--space-1)",
              fontWeight: 600,
              boxShadow: hasUnpublishedChanges
                ? "var(--shadow-sm)"
                : "none",
              opacity: !hasUnpublishedChanges && !publishMut.isPending ? 0.65 : 1,
              cursor: !hasUnpublishedChanges && !publishMut.isPending ? "not-allowed" : "pointer",
            }}
            title={
              hasUnpublishedChanges
                ? "Pending changes to publish. Click to make live."
                : "No unpublished changes. Page is up to date."
            }
          >
            {publishMut.isPending ? (
              "Publishing..."
            ) : hasUnpublishedChanges ? (
              <>
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "var(--radius-full)",
                    backgroundColor: "var(--accent-contrast)",
                  }}
                />
                Publish
              </>
            ) : (
              <>
                <Check size={13} />
                Published
              </>
            )}
          </button>
        </div>
      </div>

      {/* Three-pane layout */}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          flex: 1,
          overflow: "hidden",
        }}
      >
        {/* Left Pane: Palette + Tree View */}
        <div
          style={{
            // width: "260px",
            minWidth: "260px",
            // maxWidth: "260px",
            flexShrink: 0,
            borderRight: "1px solid var(--border)",
            backgroundColor: "var(--surface)",
            display: "flex",
            flexDirection: "column",
            overflowY: "auto",
            boxSizing: "border-box",
          }}
        >
          {/* Palette */}
          <div
            style={{
              padding: "0.875rem",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <div
              style={{
                fontSize: "var(--font-size-xs)",
                fontWeight: 600,
                color: "var(--text-muted)",
                textTransform: "uppercase",
                marginBottom: "0.5rem",
              }}
            >
              Add Component
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "0.375rem",
              }}
            >
              {(
                [
                  "stack",
                  "grid",
                  "card",
                  "tabs",
                  "text",
                  "button",
                  "table",
                  "form",
                  "stat",
                  "chart",
                  "modal",
                  "select",
                  "input",
                  "details",
                ] as NodeType[]
              ).map((type) => (
                <button
                  key={type}
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => handleAddComponent(type)}
                  aria-label={`+ ${type}`}
                  style={{
                    padding: "0.375rem 0.5rem",
                    fontSize: "var(--font-size-xs)",
                    textTransform: "capitalize",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.25rem",
                    justifyContent: "center",
                  }}
                >
                  <Plus size={12} /> {type}
                </button>
              ))}
            </div>
          </div>

          {/* Tree View */}
          <div style={{ padding: "0.875rem", flex: 1 }}>
            <div
              style={{
                fontSize: "var(--font-size-xs)",
                fontWeight: 600,
                color: "var(--text-muted)",
                textTransform: "uppercase",
                marginBottom: "0.5rem",
              }}
            >
              Component Tree
            </div>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={(draft.root.children || []).map((c) => c.id)}
                strategy={verticalListSortingStrategy}
              >
                <SortableTreeItem
                  node={draft.root}
                  selectedId={selectedNodeId}
                  hoveredId={hoveredNodeId}
                  onSelect={setSelectedNodeId}
                  onHover={setHoveredNodeId}
                  onDelete={handleDeleteNode}
                  onDuplicate={handleDuplicateNode}
                />
              </SortableContext>
            </DndContext>
          </div>
        </div>

        {/* Center Pane: Live Preview with real runtime renderer & PageRuntimeProvider */}
        <div
          onClick={(e) => {
            const target = e.target as HTMLElement;
            if (
              !target.closest("[data-node-id]") &&
              !target.closest("button") &&
              !target.closest("input") &&
              !target.closest("select")
            ) {
              setSelectedNodeId(null);
            }
          }}
          style={{
            backgroundColor: "var(--bg)",
            overflow: "auto",
            display: "flex",
            justifyContent: "center",
            flex: 1,
            margin: "var(--spacing-1)",
          }}
        >
          <div
            ref={previewContainerRef}
            style={{
              width: "100%",
              overflow: "auto",
              position: "relative",
              // backgroundColor: "var(--surface)",
              // border: "1px solid var(--border)",
              // borderRadius: "var(--radius)",
              padding: "var(--spacing-8)",
              boxShadow: "var(--shadow-sm)",
            }}
          >
            <PageRuntimeProvider
              tenantId={tenantId}
              page={isPreviewPublished ? pageDetail.published || draft : draft}
            >
              {isPreviewPublished ? (
                pageDetail.published ? (
                  <>
                    {hasUnpublishedChanges && (
                      <div
                        style={{
                          backgroundColor: "var(--warning-subtle)",
                          border: "1px solid var(--warning)",
                          borderRadius: "var(--radius-sm)",
                          padding: "var(--spacing-2) var(--spacing-3)",
                          marginBottom: "var(--spacing-5)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          fontSize: "var(--font-size-sm)",
                          color: "var(--warning)",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "0.5rem",
                          }}
                        >
                          <AlertTriangle size={15} />
                          <span>
                            Viewing live published version. You have unpublished
                            changes in your draft.
                          </span>
                        </div>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => setIsPreviewPublished(false)}
                          style={{
                            fontSize: "var(--font-size-xs)",
                            padding: "0.2rem 0.5rem",
                          }}
                        >
                          Return to Draft
                        </button>
                      </div>
                    )}
                    {renderNode(pageDetail.published.root)}
                  </>
                ) : (
                  <div
                    style={{
                      textAlign: "center",
                      padding: "3rem",
                      color: "var(--text-muted)",
                    }}
                  >
                    This page has not been published yet. Click "Publish" to
                    publish the draft.
                  </div>
                )
              ) : (
                <>
                  <div
                    onClickCapture={(e) => {
                      const target = e.target as HTMLElement;
                      const nodeElem = target.closest("[data-node-id]");
                      if (nodeElem) {
                        const id = nodeElem.getAttribute("data-node-id");
                        if (id) setSelectedNodeId(id);
                      } else {
                        setSelectedNodeId(null);
                      }
                    }}
                    onMouseMoveCapture={(e) => {
                      const target = e.target as HTMLElement;
                      const nodeElem = target.closest("[data-node-id]");
                      const id = nodeElem?.getAttribute("data-node-id") || null;
                      if (id !== hoveredNodeId) {
                        setHoveredNodeId(id);
                      }
                    }}
                    onMouseLeave={() => setHoveredNodeId(null)}
                  >
                    {renderNode(draft.root, { attachNodeId: true })}
                  </div>
                  <ComponentOverlay
                    containerRef={previewContainerRef}
                    selectedNodeId={selectedNodeId}
                    hoveredNodeId={hoveredNodeId}
                    draft={draft}
                  />
                </>
              )}
            </PageRuntimeProvider>
          </div>
        </div>

        {/* Right Pane: Property Panel generated from component propsSchema */}
        <div
          style={{
            width: "340px",
            minWidth: "340px",
            maxWidth: "340px",
            flexShrink: 0,
            borderLeft: "1px solid var(--border)",
            backgroundColor: "var(--surface)",
            padding: "1rem",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: "1rem",
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              borderBottom: "1px solid var(--border)",
              paddingBottom: "0.5rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div>
              <h3 style={{ fontSize: "var(--font-size-sm)", fontWeight: 600 }}>
                Properties
              </h3>
              {selectedNode ? (
                <div
                  style={{
                    fontSize: "var(--font-size-xs)",
                    color: "var(--text-muted)",
                    fontFamily: "monospace",
                  }}
                >
                  {selectedNode.type} (#{selectedNode.id})
                </div>
              ) : (
                <div
                  style={{
                    fontSize: "var(--font-size-xs)",
                    color: "var(--text-muted)",
                  }}
                >
                  No component selected
                </div>
              )}
            </div>
            {selectedNode && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setSelectedNodeId(null)}
                style={{
                  fontSize: "var(--font-size-xs)",
                  padding: "0.25rem 0.5rem",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.25rem",
                  color: "var(--text-muted)",
                }}
                title="Deselect (Esc)"
              >
                <X size={12} /> Deselect
              </button>
            )}
          </div>

          {selectedNode ? (
            <div
              style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
            >
              {/* Visibility expression on every node */}
              <div
                style={{
                  paddingBottom: "0.75rem",
                  borderBottom: "1px dashed var(--border)",
                }}
              >
                <ExpressionInput
                  label="Visible If"
                  value={selectedNode.visibleIf || ""}
                  placeholder="e.g. {{ state.showExtra == true }}"
                  onChange={(expr) =>
                    handleUpdateNode((node) => ({
                      ...node,
                      visibleIf: expr || undefined,
                    }))
                  }
                />
              </div>

              {/* Table Properties */}
              {selectedNode.type === "table" && (
                <>
                  <div>
                    <label className="form-label">Data Source or Entity</label>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.5rem",
                      }}
                    >
                      {(draft.dataSources || []).length > 0 && (
                        <div>
                          <label
                            className="form-label"
                            style={{
                              fontSize: "var(--font-size-xs)",
                              color: "var(--text-muted)",
                            }}
                            htmlFor="prop-table-source"
                          >
                            Data Source
                          </label>
                          <select
                            id="prop-table-source"
                            aria-label="Table Data Source"
                            className="form-select"
                            value={selectedNode.props?.source || ""}
                            onChange={(e) => {
                              const src = e.target.value;
                              handleUpdateProps({
                                ...selectedNode.props,
                                source: src || undefined,
                                entityId: src
                                  ? undefined
                                  : selectedNode.props?.entityId,
                                columns: [],
                              });
                            }}
                          >
                            <option value="">None (Use direct Entity)</option>
                            {(draft.dataSources || []).map((ds) => (
                              <option key={ds.id} value={ds.id}>
                                {ds.id} ({ds.entityId})
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {!selectedNode.props?.source && (
                        <div>
                          <label
                            className="form-label"
                            htmlFor="prop-table-entity"
                          >
                            Data Entity
                          </label>
                          <select
                            id="prop-table-entity"
                            aria-label="Data Entity"
                            className="form-select"
                            value={selectedNode.props?.entityId || ""}
                            onChange={(e) => {
                              const newEntityId = e.target.value;
                              handleUpdateProps({
                                ...selectedNode.props,
                                entityId: newEntityId,
                                source: undefined,
                                columns: [],
                              });
                            }}
                          >
                            <option value="">Select Entity</option>
                            {entities.map((ent) => (
                              <option key={ent.id} value={ent.id}>
                                {ent.label} ({ent.name})
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="form-label">Columns (Pick & Order)</label>
                    {(() => {
                      let activeEntityId = selectedNode.props?.entityId;
                      if (selectedNode.props?.source) {
                        const matchedDs = (draft.dataSources || []).find(
                          (d) => d.id === selectedNode.props?.source,
                        );
                        activeEntityId = matchedDs?.entityId;
                      }

                      const entity = entities.find(
                        (e) => e.id === activeEntityId,
                      );
                      if (!entity)
                        return (
                          <div
                            style={{
                              fontSize: "var(--font-size-xs)",
                              color: "var(--text-muted)",
                            }}
                          >
                            Select an entity or data source first
                          </div>
                        );

                      const selectedCols = (selectedNode.props?.columns ||
                        []) as Array<{ fieldId: string }>;
                      const selectedFieldIds = new Set(
                        selectedCols.map((c) => c.fieldId),
                      );

                      return (
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "0.375rem",
                          }}
                        >
                          {(entity.columns || []).map((col) => {
                            const isChecked = selectedFieldIds.has(col.id);
                            return (
                              <label
                                key={col.id}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "0.5rem",
                                  fontSize: "var(--font-size-sm)",
                                  cursor: "pointer",
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={(e) => {
                                    let newCols = [...selectedCols];
                                    if (e.target.checked) {
                                      newCols.push({ fieldId: col.id });
                                    } else {
                                      newCols = newCols.filter(
                                        (c) => c.fieldId !== col.id,
                                      );
                                    }
                                    handleUpdateProps({
                                      ...selectedNode.props,
                                      columns: newCols,
                                    });
                                  }}
                                />
                                <span>{col.label}</span>
                                <span
                                  style={{
                                    color: "var(--text-muted)",
                                    fontSize: "var(--font-size-xs)",
                                  }}
                                >
                                  ({col.type})
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>

                  <div>
                    <label className="form-label" htmlFor="prop-table-pagesize">
                      Page Size
                    </label>
                    <input
                      id="prop-table-pagesize"
                      type="number"
                      min={1}
                      max={100}
                      className="form-input"
                      value={selectedNode.props?.pageSize || 10}
                      onChange={(e) => {
                        const val = Math.max(
                          1,
                          Math.min(100, Number(e.target.value) || 10),
                        );
                        handleUpdateProps({
                          ...selectedNode.props,
                          pageSize: val,
                        });
                      }}
                    />
                    <span
                      style={{
                        fontSize: "var(--font-size-xs)",
                        color: "var(--text-muted)",
                      }}
                    >
                      Capped at maximum 100 records per page
                    </span>
                  </div>

                  <ActionEditor
                    label="On Row Click Actions"
                    actions={selectedNode.props?.onRowClick || []}
                    onChange={(actions) =>
                      handleUpdateProps({
                        ...selectedNode.props,
                        onRowClick: actions,
                      })
                    }
                  />
                </>
              )}

              {/* Details Component Properties */}
              {selectedNode.type === "details" && (
                <>
                  <div>
                    <label className="form-label">Data Source or Entity</label>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.5rem",
                      }}
                    >
                      {(draft.dataSources || []).length > 0 && (
                        <div>
                          <label
                            className="form-label"
                            style={{
                              fontSize: "var(--font-size-xs)",
                              color: "var(--text-muted)",
                            }}
                          >
                            Data Source
                          </label>
                          <select
                            className="form-select"
                            value={selectedNode.props?.source || ""}
                            onChange={(e) => {
                              const src = e.target.value;
                              handleUpdateProps({
                                ...selectedNode.props,
                                source: src || undefined,
                                entityId: src
                                  ? undefined
                                  : selectedNode.props?.entityId,
                                fields: [],
                              });
                            }}
                          >
                            <option value="">None (Use direct Entity)</option>
                            {(draft.dataSources || []).map((ds) => (
                              <option key={ds.id} value={ds.id}>
                                {ds.id} ({ds.entityId})
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {!selectedNode.props?.source && (
                        <div>
                          <label
                            className="form-label"
                            style={{
                              fontSize: "var(--font-size-xs)",
                              color: "var(--text-muted)",
                            }}
                          >
                            Direct Entity
                          </label>
                          <select
                            className="form-select"
                            value={selectedNode.props?.entityId || ""}
                            onChange={(e) => {
                              const newEntityId = e.target.value;
                              handleUpdateProps({
                                ...selectedNode.props,
                                entityId: newEntityId,
                                source: undefined,
                                fields: [],
                              });
                            }}
                          >
                            <option value="">Select Entity</option>
                            {entities.map((ent) => (
                              <option key={ent.id} value={ent.id}>
                                {ent.label} ({ent.name})
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  </div>

                  <ExpressionInput
                    label="Record ID"
                    value={String(selectedNode.props?.recordId || "")}
                    placeholder="e.g. {{ state.selectedId }}"
                    onChange={(val) =>
                      handleUpdateProps({
                        ...selectedNode.props,
                        recordId: val,
                      })
                    }
                  />

                  <div>
                    <label className="form-label">Fields to Display</label>
                    {(() => {
                      let activeEntityId = selectedNode.props?.entityId;
                      if (selectedNode.props?.source) {
                        const matchedDs = (draft.dataSources || []).find(
                          (d) => d.id === selectedNode.props?.source,
                        );
                        activeEntityId = matchedDs?.entityId;
                      }

                      const entity = entities.find(
                        (e) => e.id === activeEntityId,
                      );
                      if (!entity)
                        return (
                          <div
                            style={{
                              fontSize: "var(--font-size-xs)",
                              color: "var(--text-muted)",
                            }}
                          >
                            Select an entity or data source first
                          </div>
                        );

                      const selectedFields = (selectedNode.props?.fields ||
                        []) as Array<{ fieldId: string }>;
                      const selectedFieldIds = new Set(
                        selectedFields.map((f) => f.fieldId),
                      );

                      return (
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "0.375rem",
                          }}
                        >
                          {(entity.columns || []).map((col) => {
                            const isChecked = selectedFieldIds.has(col.id);
                            return (
                              <label
                                key={col.id}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "0.5rem",
                                  fontSize: "var(--font-size-sm)",
                                  cursor: "pointer",
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={(e) => {
                                    let newFields = [...selectedFields];
                                    if (e.target.checked) {
                                      newFields.push({ fieldId: col.id });
                                    } else {
                                      newFields = newFields.filter(
                                        (f) => f.fieldId !== col.id,
                                      );
                                    }
                                    handleUpdateProps({
                                      ...selectedNode.props,
                                      fields: newFields,
                                    });
                                  }}
                                />
                                <span>{col.label}</span>
                                <span
                                  style={{
                                    color: "var(--text-muted)",
                                    fontSize: "var(--font-size-xs)",
                                  }}
                                >
                                  ({col.type})
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                </>
              )}

              {/* Form Properties */}
              {selectedNode.type === "form" && (
                <>
                  <div>
                    <label className="form-label" htmlFor="prop-form-mode">
                      Form Mode
                    </label>
                    <select
                      id="prop-form-mode"
                      className="form-select"
                      value={selectedNode.props?.mode || "create"}
                      onChange={(e) =>
                        handleUpdateProps({
                          ...selectedNode.props,
                          mode: e.target.value as "create" | "edit",
                        })
                      }
                    >
                      <option value="create">Create (POST)</option>
                      <option value="edit">Edit (PATCH)</option>
                    </select>
                  </div>

                  {selectedNode.props?.mode === "edit" && (
                    <ExpressionInput
                      id="prop-form-recordid"
                      label="Record ID"
                      value={String(selectedNode.props?.recordId || "")}
                      placeholder="e.g. {{ state.selectedId }}"
                      onChange={(val) =>
                        handleUpdateProps({
                          ...selectedNode.props,
                          recordId: val,
                        })
                      }
                    />
                  )}

                  <div>
                    <label className="form-label" htmlFor="prop-form-entity">
                      Target Entity
                    </label>
                    <select
                      id="prop-form-entity"
                      className="form-select"
                      value={selectedNode.props?.entityId || ""}
                      onChange={(e) => {
                        const newEntityId = e.target.value;
                        handleUpdateProps({
                          ...selectedNode.props,
                          entityId: newEntityId,
                          fields: [],
                        });
                      }}
                    >
                      <option value="">Select Entity</option>
                      {entities.map((ent) => (
                        <option key={ent.id} value={ent.id}>
                          {ent.label} ({ent.name})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="form-label">
                      Form Fields & Overrides
                    </label>
                    {(() => {
                      const entity = entities.find(
                        (e) => e.id === selectedNode.props?.entityId,
                      );
                      if (!entity)
                        return (
                          <div
                            style={{
                              fontSize: "var(--font-size-xs)",
                              color: "var(--text-muted)",
                            }}
                          >
                            Select an entity first
                          </div>
                        );

                      const selectedFields = (selectedNode.props?.fields ||
                        []) as Array<{
                        fieldId: string;
                        label?: string;
                        helpText?: string;
                        readOnly?: boolean;
                        hidden?: boolean;
                      }>;
                      const selectedFieldMap = new Map(
                        selectedFields.map((f) => [f.fieldId, f]),
                      );

                      return (
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "0.5rem",
                          }}
                        >
                          {(entity.columns || [])
                            .filter(
                              (c) =>
                                !["id", "created_at", "updated_at"].includes(
                                  c.id,
                                ),
                            )
                            .map((col) => {
                              const isChecked = selectedFieldMap.has(col.id);
                              const fieldConfig = selectedFieldMap.get(col.id);

                              return (
                                <div
                                  key={col.id}
                                  style={{
                                    border: "1px solid var(--border)",
                                    borderRadius: "var(--radius-sm)",
                                    padding: "0.5rem",
                                    backgroundColor: isChecked
                                      ? "var(--surface)"
                                      : "var(--muted-bg)",
                                  }}
                                >
                                  <label
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: "0.5rem",
                                      fontSize: "var(--font-size-sm)",
                                      cursor: "pointer",
                                      fontWeight: isChecked ? 600 : 400,
                                    }}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={(e) => {
                                        let newFields = [...selectedFields];
                                        if (e.target.checked) {
                                          newFields.push({ fieldId: col.id });
                                        } else {
                                          newFields = newFields.filter(
                                            (f) => f.fieldId !== col.id,
                                          );
                                        }
                                        handleUpdateProps({
                                          ...selectedNode.props,
                                          fields: newFields,
                                        });
                                      }}
                                    />
                                    <span>{col.label}</span>
                                    {col.required && (
                                      <span style={{ color: "var(--danger)" }}>
                                        *
                                      </span>
                                    )}
                                    <span
                                      style={{
                                        color: "var(--text-muted)",
                                        fontSize: "var(--font-size-xs)",
                                      }}
                                    >
                                      ({col.type})
                                    </span>
                                  </label>

                                  {isChecked && fieldConfig && (
                                    <div
                                      style={{
                                        marginTop: "0.5rem",
                                        paddingLeft: "1.25rem",
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: "0.375rem",
                                        fontSize: "var(--font-size-xs)",
                                      }}
                                    >
                                      <div>
                                        <label
                                          style={{
                                            color: "var(--text-muted)",
                                            display: "block",
                                            marginBottom: 2,
                                          }}
                                        >
                                          Label Override
                                        </label>
                                        <input
                                          type="text"
                                          className="form-input"
                                          placeholder={col.label}
                                          value={fieldConfig.label || ""}
                                          onChange={(e) => {
                                            const newFields =
                                              selectedFields.map((f) =>
                                                f.fieldId === col.id
                                                  ? {
                                                      ...f,
                                                      label:
                                                        e.target.value ||
                                                        undefined,
                                                    }
                                                  : f,
                                              );
                                            handleUpdateProps({
                                              ...selectedNode.props,
                                              fields: newFields,
                                            });
                                          }}
                                          style={{
                                            fontSize: "var(--font-size-xs)",
                                            padding: "0.25rem 0.5rem",
                                          }}
                                        />
                                      </div>
                                      <div>
                                        <label
                                          style={{
                                            color: "var(--text-muted)",
                                            display: "block",
                                            marginBottom: 2,
                                          }}
                                        >
                                          Help Text
                                        </label>
                                        <input
                                          type="text"
                                          className="form-input"
                                          placeholder="Helper text..."
                                          value={fieldConfig.helpText || ""}
                                          onChange={(e) => {
                                            const newFields =
                                              selectedFields.map((f) =>
                                                f.fieldId === col.id
                                                  ? {
                                                      ...f,
                                                      helpText:
                                                        e.target.value ||
                                                        undefined,
                                                    }
                                                  : f,
                                              );
                                            handleUpdateProps({
                                              ...selectedNode.props,
                                              fields: newFields,
                                            });
                                          }}
                                          style={{
                                            fontSize: "var(--font-size-xs)",
                                            padding: "0.25rem 0.5rem",
                                          }}
                                        />
                                      </div>
                                      <div
                                        style={{
                                          display: "flex",
                                          gap: "1rem",
                                          marginTop: 2,
                                        }}
                                      >
                                        <label
                                          style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "0.25rem",
                                            cursor: "pointer",
                                          }}
                                        >
                                          <input
                                            type="checkbox"
                                            checked={Boolean(
                                              fieldConfig.readOnly,
                                            )}
                                            onChange={(e) => {
                                              const newFields =
                                                selectedFields.map((f) =>
                                                  f.fieldId === col.id
                                                    ? {
                                                        ...f,
                                                        readOnly:
                                                          e.target.checked ||
                                                          undefined,
                                                      }
                                                    : f,
                                                );
                                              handleUpdateProps({
                                                ...selectedNode.props,
                                                fields: newFields,
                                              });
                                            }}
                                          />
                                          <span>Read-only</span>
                                        </label>
                                        <label
                                          style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "0.25rem",
                                            cursor: "pointer",
                                          }}
                                        >
                                          <input
                                            type="checkbox"
                                            checked={Boolean(
                                              fieldConfig.hidden,
                                            )}
                                            onChange={(e) => {
                                              const newFields =
                                                selectedFields.map((f) =>
                                                  f.fieldId === col.id
                                                    ? {
                                                        ...f,
                                                        hidden:
                                                          e.target.checked ||
                                                          undefined,
                                                      }
                                                    : f,
                                                );
                                              handleUpdateProps({
                                                ...selectedNode.props,
                                                fields: newFields,
                                              });
                                            }}
                                          />
                                          <span>Hidden</span>
                                        </label>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                        </div>
                      );
                    })()}
                  </div>

                  <ActionEditor
                    label="On Success Actions"
                    actions={selectedNode.props?.onSuccess || []}
                    onChange={(actions) =>
                      handleUpdateProps({
                        ...selectedNode.props,
                        onSuccess: actions,
                      })
                    }
                  />

                  <ActionEditor
                    label="On Error Actions"
                    actions={selectedNode.props?.onError || []}
                    onChange={(actions) =>
                      handleUpdateProps({
                        ...selectedNode.props,
                        onError: actions,
                      })
                    }
                  />

                  <ActionEditor
                    label="On Submit Actions"
                    actions={selectedNode.props?.onSubmit || []}
                    onChange={(actions) =>
                      handleUpdateProps({
                        ...selectedNode.props,
                        onSubmit: actions,
                      })
                    }
                  />
                </>
              )}

              {/* Text Properties */}
              {selectedNode.type === "text" && (
                <>
                  <ExpressionInput
                    id="prop-text-value"
                    label="Text Content"
                    value={selectedNode.props?.value || ""}
                    placeholder="e.g. Total: {{ state.totalCount }}"
                    onChange={(val) =>
                      handleUpdateProps({ ...selectedNode.props, value: val })
                    }
                  />
                  <div>
                    <label className="form-label" htmlFor="prop-text-variant">
                      Variant
                    </label>
                    <select
                      id="prop-text-variant"
                      className="form-select"
                      value={selectedNode.props?.variant || "body"}
                      onChange={(e) =>
                        handleUpdateProps({
                          ...selectedNode.props,
                          variant: e.target.value,
                        })
                      }
                    >
                      <option value="h1">Heading 1 (h1)</option>
                      <option value="h2">Heading 2 (h2)</option>
                      <option value="h3">Heading 3 (h3)</option>
                      <option value="body">Body</option>
                      <option value="muted">Muted</option>
                      <option value="caption">Caption</option>
                    </select>
                  </div>
                </>
              )}

              {/* Button Properties */}
              {selectedNode.type === "button" && (
                <>
                  <ExpressionInput
                    id="prop-button-label"
                    label="Button Label"
                    value={selectedNode.props?.label || ""}
                    placeholder="e.g. Save {{ state.itemName }}"
                    onChange={(val) =>
                      handleUpdateProps({ ...selectedNode.props, label: val })
                    }
                  />
                  <div>
                    <label className="form-label" htmlFor="prop-button-variant">
                      Variant
                    </label>
                    <select
                      id="prop-button-variant"
                      className="form-select"
                      value={selectedNode.props?.variant || "primary"}
                      onChange={(e) =>
                        handleUpdateProps({
                          ...selectedNode.props,
                          variant: e.target.value,
                        })
                      }
                    >
                      <option value="primary">Primary</option>
                      <option value="secondary">Secondary</option>
                      <option value="danger">Danger</option>
                      <option value="ghost">Ghost</option>
                    </select>
                  </div>
                  <ActionEditor
                    label="On Click Actions"
                    actions={selectedNode.props?.onClick || []}
                    onChange={(actions) =>
                      handleUpdateProps({
                        ...selectedNode.props,
                        onClick: actions,
                      })
                    }
                  />
                </>
              )}

              {/* Input Component Properties */}
              {selectedNode.type === "input" && (
                <>
                  <div>
                    <label className="form-label">Label</label>
                    <input
                      type="text"
                      className="form-input"
                      value={selectedNode.props?.label || ""}
                      onChange={(e) =>
                        handleUpdateProps({
                          ...selectedNode.props,
                          label: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className="form-label">State Key (valueKey)</label>
                    <input
                      type="text"
                      className="form-input"
                      value={selectedNode.props?.valueKey || ""}
                      placeholder="e.g. filterText"
                      onChange={(e) =>
                        handleUpdateProps({
                          ...selectedNode.props,
                          valueKey: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className="form-label">Placeholder</label>
                    <input
                      type="text"
                      className="form-input"
                      value={selectedNode.props?.placeholder || ""}
                      onChange={(e) =>
                        handleUpdateProps({
                          ...selectedNode.props,
                          placeholder: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className="form-label">Input Type</label>
                    <select
                      className="form-select"
                      value={selectedNode.props?.type || "text"}
                      onChange={(e) =>
                        handleUpdateProps({
                          ...selectedNode.props,
                          type: e.target.value,
                        })
                      }
                    >
                      <option value="text">Text</option>
                      <option value="number">Number</option>
                    </select>
                  </div>
                  <ActionEditor
                    label="On Change Actions"
                    actions={selectedNode.props?.onChangeAction || []}
                    onChange={(actions) =>
                      handleUpdateProps({
                        ...selectedNode.props,
                        onChangeAction: actions,
                      })
                    }
                  />
                </>
              )}

              {/* Select Component Properties */}
              {selectedNode.type === "select" && (
                <>
                  <div>
                    <label className="form-label">Label</label>
                    <input
                      type="text"
                      className="form-input"
                      value={selectedNode.props?.label || ""}
                      onChange={(e) =>
                        handleUpdateProps({
                          ...selectedNode.props,
                          label: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className="form-label">State Key (valueKey)</label>
                    <input
                      type="text"
                      className="form-input"
                      value={selectedNode.props?.valueKey || ""}
                      placeholder="e.g. selectedCategory"
                      onChange={(e) =>
                        handleUpdateProps({
                          ...selectedNode.props,
                          valueKey: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className="form-label">
                      Options (JSON array of label/value)
                    </label>
                    <textarea
                      className="form-input"
                      rows={4}
                      value={
                        typeof selectedNode.props?.options === "string"
                          ? selectedNode.props?.options
                          : JSON.stringify(
                              selectedNode.props?.options || [],
                              null,
                              2,
                            )
                      }
                      onChange={(e) => {
                        try {
                          const parsed = JSON.parse(e.target.value);
                          handleUpdateProps({
                            ...selectedNode.props,
                            options: parsed,
                          });
                        } catch {
                          handleUpdateProps({
                            ...selectedNode.props,
                            options: e.target.value,
                          });
                        }
                      }}
                    />
                  </div>
                  <ActionEditor
                    label="On Change Actions"
                    actions={selectedNode.props?.onChangeAction || []}
                    onChange={(actions) =>
                      handleUpdateProps({
                        ...selectedNode.props,
                        onChangeAction: actions,
                      })
                    }
                  />
                </>
              )}

              {/* Modal Component Properties */}
              {selectedNode.type === "modal" && (
                <>
                  <div>
                    <label className="form-label">Modal Title</label>
                    <input
                      type="text"
                      className="form-input"
                      value={selectedNode.props?.title || ""}
                      onChange={(e) =>
                        handleUpdateProps({
                          ...selectedNode.props,
                          title: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className="form-label">Open State Key</label>
                    <input
                      type="text"
                      className="form-input"
                      value={selectedNode.props?.openStateKey || ""}
                      placeholder="e.g. isDetailsOpen"
                      onChange={(e) =>
                        handleUpdateProps({
                          ...selectedNode.props,
                          openStateKey: e.target.value,
                        })
                      }
                    />
                  </div>
                </>
              )}

              {/* Stack Properties */}
              {selectedNode.type === "stack" && (
                <>
                  <div>
                    <label
                      className="form-label"
                      htmlFor="prop-stack-direction"
                    >
                      Direction
                    </label>
                    <select
                      id="prop-stack-direction"
                      className="form-select"
                      value={selectedNode.props?.direction || "vertical"}
                      onChange={(e) =>
                        handleUpdateProps({
                          ...selectedNode.props,
                          direction: e.target.value,
                        })
                      }
                    >
                      <option value="vertical">Vertical</option>
                      <option value="horizontal">Horizontal</option>
                    </select>
                  </div>
                  <div>
                    <label className="form-label" htmlFor="prop-stack-gap">
                      Gap (px)
                    </label>
                    <input
                      id="prop-stack-gap"
                      type="number"
                      className="form-input"
                      value={selectedNode.props?.gap ?? 16}
                      onChange={(e) =>
                        handleUpdateProps({
                          ...selectedNode.props,
                          gap: Number(e.target.value),
                        })
                      }
                    />
                  </div>
                  <div>
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                        fontSize: "var(--font-size-sm)",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedNode.props?.wrap ?? false}
                        onChange={(e) =>
                          handleUpdateProps({
                            ...selectedNode.props,
                            wrap: e.target.checked,
                          })
                        }
                      />
                      <span>Wrap items (flex-wrap)</span>
                    </label>
                  </div>
                </>
              )}

              {/* Grid Properties */}
              {selectedNode.type === "grid" && (
                <>
                  <div>
                    <label className="form-label" htmlFor="prop-grid-columns">
                      Columns (1 - 12)
                    </label>
                    <input
                      id="prop-grid-columns"
                      type="number"
                      min={1}
                      max={12}
                      className="form-input"
                      value={selectedNode.props?.columns ?? 2}
                      onChange={(e) =>
                        handleUpdateProps({
                          ...selectedNode.props,
                          columns: Math.max(
                            1,
                            Math.min(12, Number(e.target.value) || 1),
                          ),
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className="form-label" htmlFor="prop-grid-gap">
                      Gap (px)
                    </label>
                    <input
                      id="prop-grid-gap"
                      type="number"
                      min={0}
                      className="form-input"
                      value={selectedNode.props?.gap ?? 16}
                      onChange={(e) =>
                        handleUpdateProps({
                          ...selectedNode.props,
                          gap: Number(e.target.value) || 0,
                        })
                      }
                    />
                  </div>
                  <div>
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                        fontSize: "var(--font-size-sm)",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedNode.props?.responsiveCollapse ?? true}
                        onChange={(e) =>
                          handleUpdateProps({
                            ...selectedNode.props,
                            responsiveCollapse: e.target.checked,
                          })
                        }
                      />
                      <span>Responsive Collapse (stack on mobile)</span>
                    </label>
                  </div>
                </>
              )}

              {/* Card Properties */}
              {selectedNode.type === "card" && (
                <>
                  <div>
                    <label className="form-label" htmlFor="prop-card-title">
                      Title
                    </label>
                    <input
                      id="prop-card-title"
                      type="text"
                      className="form-input"
                      value={selectedNode.props?.title || ""}
                      onChange={(e) =>
                        handleUpdateProps({
                          ...selectedNode.props,
                          title: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className="form-label" htmlFor="prop-card-subtitle">
                      Subtitle
                    </label>
                    <input
                      id="prop-card-subtitle"
                      type="text"
                      className="form-input"
                      value={selectedNode.props?.subtitle || ""}
                      onChange={(e) =>
                        handleUpdateProps({
                          ...selectedNode.props,
                          subtitle: e.target.value,
                        })
                      }
                    />
                  </div>
                </>
              )}

              {/* Tabs Properties */}
              {selectedNode.type === "tabs" && (
                <>
                  <div>
                    <label className="form-label">Tabs</label>
                    {(() => {
                      const tabs = (selectedNode.props?.tabs || []) as Array<{
                        id: string;
                        label: string;
                      }>;
                      return (
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "0.5rem",
                          }}
                        >
                          {tabs.map((tab, idx) => (
                            <div
                              key={idx}
                              style={{
                                display: "flex",
                                gap: "0.375rem",
                                alignItems: "center",
                              }}
                            >
                              <input
                                type="text"
                                className="form-input"
                                placeholder="Tab ID"
                                value={tab.id}
                                onChange={(e) => {
                                  const updated = [...tabs];
                                  updated[idx] = { ...tab, id: e.target.value };
                                  handleUpdateProps({
                                    ...selectedNode.props,
                                    tabs: updated,
                                  });
                                }}
                                style={{
                                  width: "40%",
                                  fontSize: "var(--font-size-xs)",
                                  padding: "0.25rem 0.5rem",
                                }}
                              />
                              <input
                                type="text"
                                className="form-input"
                                placeholder="Tab Label"
                                value={tab.label}
                                onChange={(e) => {
                                  const updated = [...tabs];
                                  updated[idx] = {
                                    ...tab,
                                    label: e.target.value,
                                  };
                                  handleUpdateProps({
                                    ...selectedNode.props,
                                    tabs: updated,
                                  });
                                }}
                                style={{
                                  flex: 1,
                                  fontSize: "var(--font-size-xs)",
                                  padding: "0.25rem 0.5rem",
                                }}
                              />
                              <button
                                type="button"
                                className="btn btn-ghost"
                                onClick={() => {
                                  const updated = tabs.filter(
                                    (_, i) => i !== idx,
                                  );
                                  handleUpdateProps({
                                    ...selectedNode.props,
                                    tabs: updated,
                                  });
                                }}
                                style={{ padding: "0.25rem" }}
                              >
                                <X size={14} />
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => {
                              const newTabId = `tab_${tabs.length + 1}`;
                              handleUpdateProps({
                                ...selectedNode.props,
                                tabs: [
                                  ...tabs,
                                  {
                                    id: newTabId,
                                    label: `Tab ${tabs.length + 1}`,
                                  },
                                ],
                              });
                            }}
                            style={{
                              fontSize: "var(--font-size-xs)",
                              padding: "0.25rem 0.5rem",
                              alignSelf: "flex-start",
                            }}
                          >
                            + Add Tab
                          </button>
                        </div>
                      );
                    })()}
                  </div>
                  <div>
                    <label className="form-label" htmlFor="prop-tabs-default">
                      Default Tab ID
                    </label>
                    <input
                      id="prop-tabs-default"
                      type="text"
                      className="form-input"
                      value={selectedNode.props?.defaultTab || ""}
                      onChange={(e) =>
                        handleUpdateProps({
                          ...selectedNode.props,
                          defaultTab: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className="form-label" htmlFor="prop-tabs-statekey">
                      Active Tab State Key
                    </label>
                    <input
                      id="prop-tabs-statekey"
                      type="text"
                      className="form-input"
                      placeholder="e.g. currentTab"
                      value={selectedNode.props?.activeTabStateKey || ""}
                      onChange={(e) =>
                        handleUpdateProps({
                          ...selectedNode.props,
                          activeTabStateKey: e.target.value,
                        })
                      }
                    />
                  </div>
                </>
              )}

              {/* Stat Properties */}
              {selectedNode.type === "stat" && (
                <>
                  <div>
                    <label className="form-label" htmlFor="prop-stat-entity">
                      Data Entity
                    </label>
                    <select
                      id="prop-stat-entity"
                      className="form-select"
                      value={selectedNode.props?.entityId || ""}
                      onChange={(e) =>
                        handleUpdateProps({
                          ...selectedNode.props,
                          entityId: e.target.value,
                          fieldId: undefined,
                        })
                      }
                    >
                      <option value="">Select Entity</option>
                      {entities.map((ent) => (
                        <option key={ent.id} value={ent.id}>
                          {ent.label} ({ent.name})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="form-label" htmlFor="prop-stat-op">
                      Operation
                    </label>
                    <select
                      id="prop-stat-op"
                      className="form-select"
                      value={selectedNode.props?.op || "count"}
                      onChange={(e) =>
                        handleUpdateProps({
                          ...selectedNode.props,
                          op: e.target.value,
                        })
                      }
                    >
                      <option value="count">Count</option>
                      <option value="sum">Sum</option>
                      <option value="avg">Average</option>
                      <option value="min">Minimum</option>
                      <option value="max">Maximum</option>
                    </select>
                  </div>
                  {selectedNode.props?.op !== "count" && (
                    <div>
                      <label className="form-label" htmlFor="prop-stat-field">
                        Aggregate Field
                      </label>
                      <select
                        id="prop-stat-field"
                        className="form-select"
                        value={selectedNode.props?.fieldId || ""}
                        onChange={(e) =>
                          handleUpdateProps({
                            ...selectedNode.props,
                            fieldId: e.target.value,
                          })
                        }
                      >
                        <option value="">Select Field</option>
                        {(() => {
                          const ent = entities.find(
                            (e) => e.id === selectedNode.props?.entityId,
                          );
                          return (ent?.columns || []).map((col) => (
                            <option key={col.id} value={col.id}>
                              {col.label} ({col.type})
                            </option>
                          ));
                        })()}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className="form-label" htmlFor="prop-stat-label">
                      Label
                    </label>
                    <input
                      id="prop-stat-label"
                      type="text"
                      className="form-input"
                      value={selectedNode.props?.label || ""}
                      onChange={(e) =>
                        handleUpdateProps({
                          ...selectedNode.props,
                          label: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "0.5rem",
                    }}
                  >
                    <div>
                      <label className="form-label" htmlFor="prop-stat-prefix">
                        Prefix
                      </label>
                      <input
                        id="prop-stat-prefix"
                        type="text"
                        className="form-input"
                        placeholder="e.g. $"
                        value={selectedNode.props?.prefix || ""}
                        onChange={(e) =>
                          handleUpdateProps({
                            ...selectedNode.props,
                            prefix: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div>
                      <label className="form-label" htmlFor="prop-stat-suffix">
                        Suffix
                      </label>
                      <input
                        id="prop-stat-suffix"
                        type="text"
                        className="form-input"
                        placeholder="e.g. units"
                        value={selectedNode.props?.suffix || ""}
                        onChange={(e) =>
                          handleUpdateProps({
                            ...selectedNode.props,
                            suffix: e.target.value,
                          })
                        }
                      />
                    </div>
                  </div>
                </>
              )}

              {/* Chart Properties */}
              {selectedNode.type === "chart" && (
                <>
                  <div>
                    <label className="form-label">Data Source or Entity</label>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.5rem",
                      }}
                    >
                      {(draft.dataSources || []).length > 0 && (
                        <div>
                          <label
                            className="form-label"
                            style={{
                              fontSize: "var(--font-size-xs)",
                              color: "var(--text-muted)",
                            }}
                            htmlFor="prop-chart-source"
                          >
                            Data Source
                          </label>
                          <select
                            id="prop-chart-source"
                            className="form-select"
                            value={selectedNode.props?.source || ""}
                            onChange={(e) => {
                              const src = e.target.value;
                              handleUpdateProps({
                                ...selectedNode.props,
                                source: src || undefined,
                                entityId: src
                                  ? undefined
                                  : selectedNode.props?.entityId,
                              });
                            }}
                          >
                            <option value="">None (Use direct Entity)</option>
                            {(draft.dataSources || []).map((ds) => (
                              <option key={ds.id} value={ds.id}>
                                {ds.id} ({ds.entityId})
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                      {!selectedNode.props?.source && (
                        <div>
                          <label
                            className="form-label"
                            htmlFor="prop-chart-entity"
                          >
                            Data Entity
                          </label>
                          <select
                            id="prop-chart-entity"
                            className="form-select"
                            value={selectedNode.props?.entityId || ""}
                            onChange={(e) =>
                              handleUpdateProps({
                                ...selectedNode.props,
                                entityId: e.target.value,
                              })
                            }
                          >
                            <option value="">Select Entity</option>
                            {entities.map((ent) => (
                              <option key={ent.id} value={ent.id}>
                                {ent.label} ({ent.name})
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="form-label" htmlFor="prop-chart-title">
                      Chart Title
                    </label>
                    <input
                      id="prop-chart-title"
                      type="text"
                      className="form-input"
                      value={selectedNode.props?.title || ""}
                      onChange={(e) =>
                        handleUpdateProps({
                          ...selectedNode.props,
                          title: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className="form-label" htmlFor="prop-chart-type">
                      Chart Type
                    </label>
                    <select
                      id="prop-chart-type"
                      className="form-select"
                      value={selectedNode.props?.type || "bar"}
                      onChange={(e) =>
                        handleUpdateProps({
                          ...selectedNode.props,
                          type: e.target.value,
                        })
                      }
                    >
                      <option value="bar">Bar</option>
                      <option value="line">Line</option>
                    </select>
                  </div>
                  <div>
                    <label className="form-label" htmlFor="prop-chart-groupby">
                      Group By Field
                    </label>
                    <select
                      id="prop-chart-groupby"
                      className="form-select"
                      value={selectedNode.props?.groupByFieldId || ""}
                      onChange={(e) =>
                        handleUpdateProps({
                          ...selectedNode.props,
                          groupByFieldId: e.target.value,
                        })
                      }
                    >
                      <option value="">Select Field</option>
                      {(() => {
                        let activeEntityId = selectedNode.props?.entityId;
                        if (selectedNode.props?.source) {
                          const ds = (draft.dataSources || []).find(
                            (d) => d.id === selectedNode.props?.source,
                          );
                          activeEntityId = ds?.entityId;
                        }
                        const ent = entities.find(
                          (e) => e.id === activeEntityId,
                        );
                        return (ent?.columns || []).map((col) => (
                          <option key={col.id} value={col.id}>
                            {col.label} ({col.name})
                          </option>
                        ));
                      })()}
                    </select>
                  </div>
                  <div>
                    <label className="form-label" htmlFor="prop-chart-aggop">
                      Aggregate Operation
                    </label>
                    <select
                      id="prop-chart-aggop"
                      className="form-select"
                      value={selectedNode.props?.aggregateOp || "count"}
                      onChange={(e) =>
                        handleUpdateProps({
                          ...selectedNode.props,
                          aggregateOp: e.target.value,
                        })
                      }
                    >
                      <option value="count">Count</option>
                      <option value="sum">Sum</option>
                      <option value="avg">Average</option>
                      <option value="min">Minimum</option>
                      <option value="max">Maximum</option>
                    </select>
                  </div>
                  {selectedNode.props?.aggregateOp !== "count" && (
                    <div>
                      <label
                        className="form-label"
                        htmlFor="prop-chart-aggfield"
                      >
                        Aggregate Field
                      </label>
                      <select
                        id="prop-chart-aggfield"
                        className="form-select"
                        value={selectedNode.props?.aggregateFieldId || ""}
                        onChange={(e) =>
                          handleUpdateProps({
                            ...selectedNode.props,
                            aggregateFieldId: e.target.value,
                          })
                        }
                      >
                        <option value="">Select Field</option>
                        {(() => {
                          let activeEntityId = selectedNode.props?.entityId;
                          if (selectedNode.props?.source) {
                            const ds = (draft.dataSources || []).find(
                              (d) => d.id === selectedNode.props?.source,
                            );
                            activeEntityId = ds?.entityId;
                          }
                          const ent = entities.find(
                            (e) => e.id === activeEntityId,
                          );
                          return (ent?.columns || []).map((col) => (
                            <option key={col.id} value={col.id}>
                              {col.label} ({col.type})
                            </option>
                          ));
                        })()}
                      </select>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-muted)",
                fontSize: "var(--font-size-sm)",
                textAlign: "center",
                padding: "3.5rem 1rem",
                gap: "0.75rem",
                flex: 1,
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "var(--bg)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--text-muted)",
                  border: "1px solid var(--border)",
                }}
              >
                <MousePointerClick size={20} />
              </div>
              <div style={{ fontWeight: 600, color: "var(--text)" }}>
                No Component Selected
              </div>
              <div
                style={{
                  fontSize: "var(--font-size-xs)",
                  lineHeight: 1.5,
                  maxWidth: "220px",
                }}
              >
                Click any component in the preview or tree to configure its
                properties.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* State & Data Source Modals */}
      <StateEditorModal
        isOpen={isStateModalOpen}
        onClose={() => setIsStateModalOpen(false)}
        state={draft.state || {}}
        onSave={(newState) => {
          pushDraftUpdate({
            ...draft,
            state: newState,
          });
        }}
      />

      <DataSourceEditorModal
        isOpen={isDataSourceModalOpen}
        onClose={() => setIsDataSourceModalOpen(false)}
        dataSources={draft.dataSources || []}
        entities={entities}
        onSave={(newDataSources) => {
          pushDraftUpdate({
            ...draft,
            dataSources: newDataSources,
          });
        }}
      />

      <TemplatePickerModal
        isOpen={isTemplateModalOpen}
        onClose={() => setIsTemplateModalOpen(false)}
        entities={entities}
        onApply={(template, entity) => {
          if (!pageDetail) return;
          const newDraft = createTemplatePage(
            template,
            pageDetail.id,
            pageDetail.route,
            entity,
          );
          pushDraftUpdate(newDraft);
          setSelectedNodeId(newDraft.root.id);
          setSaveStatus(`Applied ${template} template`);
          setTimeout(() => setSaveStatus(null), 3000);
        }}
      />

      {isRolesModalOpen && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "var(--overlay-bg)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            backdropFilter: "blur(2px)",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "480px",
              backgroundColor: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-lg)",
              padding: "var(--spacing-6)",
              boxShadow: "var(--shadow-xl)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "1rem",
              }}
            >
              <div
                style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
              >
                <Shield size={18} style={{ color: "var(--accent)" }} />
                <h3 style={{ fontSize: "var(--font-size-lg)", fontWeight: 600 }}>
                  Page Access Permissions
                </h3>
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setIsRolesModalOpen(false)}
                style={{ padding: "0.25rem" }}
              >
                <X size={16} />
              </button>
            </div>
            <p
              style={{
                fontSize: "var(--font-size-sm)",
                color: "var(--text-muted)",
                marginBottom: "1.25rem",
              }}
            >
              Control which signed-in roles are allowed to access this published
              page. If no roles are selected, all authenticated roles have
              access by default.
            </p>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem",
                marginBottom: "1.5rem",
              }}
            >
              {(["owner", "admin", "builder", "editor", "viewer"] as const).map(
                (r) => {
                  const currentRoles = (draft.allowedRoles || []) as string[];
                  const isChecked = currentRoles.includes(r);
                  return (
                    <label
                      key={r}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.75rem",
                        padding: "0.5rem 0.75rem",
                        borderRadius: "var(--radius-md, 8px)",
                        backgroundColor: isChecked
                          ? "var(--accent-subtle)"
                          : "var(--surface-subtle)",
                        border: `1px solid ${isChecked ? "var(--accent)" : "var(--border)"}`,
                        cursor: "pointer",
                        fontSize: "var(--font-size-sm)",
                        textTransform: "capitalize",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          let newRoles: string[];
                          if (e.target.checked) {
                            newRoles = [...currentRoles, r];
                          } else {
                            newRoles = currentRoles.filter((x) => x !== r);
                          }
                          pushDraftUpdate({
                            ...draft,
                            allowedRoles:
                              newRoles.length > 0 ? newRoles : undefined,
                          });
                        }}
                      />
                      <span style={{ fontWeight: 500 }}>{r}</span>
                    </label>
                  );
                },
              )}
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "0.5rem",
              }}
            >
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  pushDraftUpdate({
                    ...draft,
                    allowedRoles: undefined,
                  });
                }}
                style={{ fontSize: "var(--font-size-sm)" }}
              >
                Reset to All Roles
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setIsRolesModalOpen(false)}
                style={{ fontSize: "var(--font-size-sm)" }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
