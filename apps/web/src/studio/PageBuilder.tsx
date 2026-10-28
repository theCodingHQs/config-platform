import React, { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  closestCenter,
  pointerWithin,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
  type CollisionDetection,
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
  CopyPlus,
  ClipboardPaste,
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
import { ShareButton } from "../library/ShareButton";
import { ComponentOverlay } from "./ComponentOverlay";
import { defaultChartAxisTitles } from "../components/chart-axis-titles";
import { ContentLayoutFields, ContentLayoutSection } from "./ContentLayoutFields";
import { IconPicker } from "../components/icon-picker";
import { VisualPropsEditor } from "./VisualPropsEditor";
import { createTemplatePage, type TemplateType } from "./templates";
import {
  fetchPage,
  updatePage,
  publishPage,
  listExportTemplates,
  type PageDetail,
} from "../api/client";
import type { PageRole,
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
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k]))
      .join(",") +
    "}"
  );
}

// Helper tree functions
const CONTAINER_TYPES: NodeType[] = ["stack", "modal", "grid", "card", "tabs"];

function isContainerNode(node: NodeDefinition): boolean {
  return CONTAINER_TYPES.includes(node.type) || Boolean(node.children);
}

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

function findParentNode(
  root: NodeDefinition,
  targetId: string,
): { parent: NodeDefinition; index: number } | null {
  if (root.id === targetId || !root.children) return null;
  const index = root.children.findIndex((c) => c.id === targetId);
  if (index !== -1) {
    return { parent: root, index };
  }
  for (const child of root.children) {
    const res = findParentNode(child, targetId);
    if (res) return res;
  }
  return null;
}

function isDescendant(
  root: NodeDefinition,
  ancestorId: string,
  checkId: string,
): boolean {
  if (ancestorId === checkId) return true;
  const ancestor = findNode(root, ancestorId);
  if (!ancestor) return false;
  return Boolean(findNode(ancestor, checkId));
}

function getAllNodeIds(root: NodeDefinition): string[] {
  const ids: string[] = [root.id];
  function collect(node: NodeDefinition) {
    if (node.children) {
      for (const child of node.children) {
        ids.push(child.id);
        collect(child);
      }
    }
  }
  collect(root);
  return ids;
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
  targetIndex?: number,
): NodeDefinition {
  if (root.id === targetParentId) {
    const existing = [...(root.children || [])];
    if (
      targetIndex !== undefined &&
      targetIndex >= 0 &&
      targetIndex <= existing.length
    ) {
      existing.splice(targetIndex, 0, newNode);
    } else {
      existing.push(newNode);
    }
    return {
      ...root,
      children: existing,
    };
  }
  if (!root.children) return root;

  return {
    ...root,
    children: root.children.map((child) =>
      insertNodeIntoTree(child, targetParentId, newNode, targetIndex),
    ),
  };
}

function insertNodeSibling(
  root: NodeDefinition,
  targetId: string,
  newNode: NodeDefinition,
  position: "before" | "after" = "after",
): NodeDefinition {
  const parentInfo = findParentNode(root, targetId);
  if (!parentInfo) {
    return insertNodeIntoTree(root, root.id, newNode);
  }
  const targetIndex =
    position === "before" ? parentInfo.index : parentInfo.index + 1;
  return insertNodeIntoTree(root, parentInfo.parent.id, newNode, targetIndex);
}


/** Toolbar icons scale with the button text (theme text size). */
const TOOLBAR_ICON_SIZE = "1.15em";
const STATUS_DOT_SIZE = "0.45em";

export function moveNodeInTree(
  root: NodeDefinition,
  activeId: string,
  targetParentId: string,
  targetIndex?: number,
): NodeDefinition {
  if (activeId === targetParentId) return root;
  if (isDescendant(root, activeId, targetParentId)) return root;

  const nodeToMove = findNode(root, activeId);
  if (!nodeToMove) return root;

  const parentInfo = findParentNode(root, activeId);

  // Moving within the same parent
  if (
    parentInfo &&
    parentInfo.parent.id === targetParentId &&
    targetIndex !== undefined
  ) {
    const oldIndex = parentInfo.index;
    if (oldIndex === targetIndex) return root;
    let adjustedIndex = targetIndex;
    if (oldIndex < targetIndex) {
      adjustedIndex = targetIndex - 1;
    }
    const rootWithoutActive = removeNodeFromTree(root, activeId);
    return insertNodeIntoTree(
      rootWithoutActive,
      targetParentId,
      nodeToMove,
      adjustedIndex,
    );
  }

  // Moving to a different parent
  const rootWithoutActive = removeNodeFromTree(root, activeId);
  return insertNodeIntoTree(
    rootWithoutActive,
    targetParentId,
    nodeToMove,
    targetIndex,
  );
}

export function computeDropTarget(
  root: NodeDefinition,
  activeId: string,
  overId: string,
): { targetParentId: string; targetIndex: number | undefined } | null {
  const activeNode = findNode(root, activeId);
  const overNode = findNode(root, overId);
  if (!activeNode || !overNode) return null;

  const allNodeIds = getAllNodeIds(root);
  const activeIndex = allNodeIds.indexOf(activeId);
  const overIndex = allNodeIds.indexOf(overId);
  const isDraggingUp =
    activeIndex !== -1 && overIndex !== -1 ? activeIndex > overIndex : false;

  if (overNode.id === root.id) {
    return {
      targetParentId: root.id,
      targetIndex: isDraggingUp ? 0 : root.children ? root.children.length : 0,
    };
  }

  const isContainer = isContainerNode(overNode);
  const isEmptyContainer =
    isContainer && (!overNode.children || overNode.children.length === 0);

  if (isEmptyContainer) {
    // Drop inside the empty container
    return {
      targetParentId: overNode.id,
      targetIndex: 0,
    };
  }

  if (isContainer) {
    if (isDraggingUp) {
      // Dragging UP over container: place BEFORE container in its parent (matching SortableContext visual preview)
      const parentInfo = findParentNode(root, overNode.id);
      return {
        targetParentId: parentInfo ? parentInfo.parent.id : root.id,
        targetIndex: parentInfo ? parentInfo.index : 0,
      };
    } else {
      // Dragging DOWN over container: place as FIRST child inside container
      return {
        targetParentId: overNode.id,
        targetIndex: 0,
      };
    }
  }

  // Over a leaf node: place before if dragging up, after if dragging down
  const parentInfo = findParentNode(root, overNode.id);
  if (!parentInfo) {
    return {
      targetParentId: root.id,
      targetIndex: 0,
    };
  }
  return {
    targetParentId: parentInfo.parent.id,
    targetIndex: isDraggingUp ? parentInfo.index : parentInfo.index + 1,
  };
}

function cloneNodeWithNewIds(node: NodeDefinition): NodeDefinition {
  const newId = `${node.type}_${Math.random().toString(36).substring(2, 7)}`;
  return {
    ...node,
    id: newId,
    props: node.props ? JSON.parse(JSON.stringify(node.props)) : {},
    children: node.children
      ? node.children.map(cloneNodeWithNewIds)
      : undefined,
  };
}

/**
 * Where a container's children go in the component tree: one fixed step in, whatever the depth,
 * with a line down the left showing which container they belong to.
 */
const TREE_CHILDREN_STYLE: React.CSSProperties = {
  marginLeft: "0.875rem", // the line runs under the container's drag handle
  paddingLeft: "var(--space-1)",
  borderLeft: "var(--border-width-sm) solid var(--border)",
};

// Tree view item component
const SortableTreeItem: React.FC<{
  node: NodeDefinition;
  depth?: number;
  selectedId: string | null;
  hoveredId: string | null;
  activeDragId: string | null;
  overDragId: string | null;
  copiedNode: NodeDefinition | null;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onCopy: (node: NodeDefinition) => void;
  onPaste: (targetId: string) => void;
}> = ({
  node,
  depth = 0,
  selectedId,
  hoveredId,
  activeDragId,
  overDragId,
  copiedNode,
  onSelect,
  onHover,
  onDelete,
  onDuplicate,
  onCopy,
  onPaste,
}) => {
  const isRoot = depth === 0;
  const isContainer = isContainerNode(node);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: node.id,
    disabled: isRoot,
  });

  const isSelected = selectedId === node.id;
  const isHovered = hoveredId === node.id;
  const isOver = overDragId === node.id && activeDragId !== node.id;

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition || "all 0.12s ease",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "var(--space-3)",
    whiteSpace: "nowrap",
    // As wide as its own content when that's wider than the panel (deep nesting), so the
    // hover/selection box holds the whole row; the panel then scrolls sideways
    width: "max-content",
    minWidth: "100%",
    boxSizing: "border-box",
    padding: "0.375rem 0.5rem",
    borderRadius: "var(--radius-control)",
    backgroundColor: isDragging
      ? "var(--surface-2)"
      : isOver
        ? "var(--accent-subtle)"
        : isSelected
          ? "var(--accent-subtle)"
          : isHovered
            ? "var(--surface-2)"
            : "transparent",
    border: isOver
      ? "1px dashed var(--accent)"
      : isSelected
        ? "1px solid var(--accent)"
        : isHovered
          ? "1px dashed var(--accent)"
          : "1px solid transparent",
    cursor: "pointer",
    fontSize: "var(--font-size-xs)",
    marginBottom: "var(--spacing-1)",
    opacity: isDragging ? 0.35 : 1,
  };

  return (
    <div>
      <div
        ref={setNodeRef}
        style={style}
        onClick={() => onSelect(isSelected ? null : node.id)}
        onMouseEnter={(e) => {
          e.stopPropagation();
          onHover(node.id);
        }}
        onMouseLeave={(e) => {
          e.stopPropagation();
          onHover(null);
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
          }}
        >
          {!isRoot ? (
            <span
              {...attributes}
              {...listeners}
              style={{
                cursor: isDragging ? "grabbing" : "grab",
                color: isDragging ? "var(--accent)" : "var(--muted)",
                display: "inline-flex",
                alignItems: "center",
                touchAction: "none",
              }}
              title="Drag to reorder or move anywhere"
            >
              <GripVertical size={13} />
            </span>
          ) : (
            <span
              style={{
                color: "var(--muted)",
                opacity: 0.5,
                display: "inline-flex",
                alignItems: "center",
              }}
              title="Root container"
            >
              <GripVertical size={13} />
            </span>
          )}
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

        <div style={{ display: "flex", alignItems: "center" }}>
          {/* Copy configuration button */}
          <button
            type="button"
            className="btn btn-ghost"
            style={{
              padding: "0.125rem 0.25rem",
              display: "inline-flex",
              alignItems: "center",
              color: copiedNode?.id === node.id ? "var(--accent)" : undefined,
            }}
            onClick={(e) => {
              e.stopPropagation();
              onCopy(node);
            }}
            title={`Copy "${node.id}" configuration`}
            aria-label="Copy"
          >
            <Copy size={12} />
          </button>

          {/* Duplicate button */}
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
            <CopyPlus size={12} />
          </button>

          {/* Paste button if node is copied */}
          {copiedNode && (
            <button
              type="button"
              className="btn btn-ghost"
              style={{
                padding: "0.125rem 0.25rem",
                color: "var(--accent)",
                display: "inline-flex",
                alignItems: "center",
              }}
              onClick={(e) => {
                e.stopPropagation();
                onPaste(node.id);
              }}
              title={
                isContainer
                  ? `Paste "${copiedNode.type}" inside this container`
                  : `Paste "${copiedNode.type}" after this component`
              }
              aria-label="Paste"
            >
              <ClipboardPaste size={12} />
            </button>
          )}

          {/* Delete button (not for root) */}
          {!isRoot && (
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

      {/* Children: one fixed step in from their container, with a line marking its area */}
      {node.children && node.children.length > 0 && (
        <div style={TREE_CHILDREN_STYLE}>
          {node.children.map((child) => (
            <SortableTreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              hoveredId={hoveredId}
              activeDragId={activeDragId}
              overDragId={overDragId}
              copiedNode={copiedNode}
              onSelect={onSelect}
              onHover={onHover}
              onDelete={onDelete}
              onDuplicate={onDuplicate}
              onCopy={onCopy}
              onPaste={onPaste}
            />
          ))}
        </div>
      )}

      {/* Empty container indicator */}
      {isContainer && (!node.children || node.children.length === 0) && (
        <div style={TREE_CHILDREN_STYLE}>
          <div
            style={{
              padding: "var(--space-1) var(--space-2)",
              fontSize: "var(--font-size-xs)",
              color: "var(--muted)",
              fontStyle: "italic",
              border: "1px dashed var(--border)",
              borderRadius: "var(--radius-control)",
              marginBottom: "var(--spacing-1)",
              backgroundColor: isOver ? "var(--accent-subtle)" : "transparent",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span>Empty {node.type}</span>
            {copiedNode && (
              <button
                type="button"
                className="btn btn-ghost"
                style={{
                  padding: "0.1rem var(--space-1)",
                  fontSize: "var(--font-size-xs)",
                  color: "var(--accent)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "var(--space-1)",
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onPaste(node.id);
                }}
              >
                <ClipboardPaste size={10} /> Paste inside
              </button>
            )}
          </div>
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
  const [copiedNode, setCopiedNode] = useState<NodeDefinition | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [overDragId, setOverDragId] = useState<string | null>(null);
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

  const { data: exportTemplates = [] } = useQuery({
    queryKey: ["export-templates", tenantId],
    queryFn: () => listExportTemplates(),
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
      // The toolbar shows a failed auto-save; nothing else awaits it
      handleSaveDraft().catch(() => {});
    }, 1500);

    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [draft]);

  // Change detection: is draft modified vs DB draft, and does draft differ from live published
  const isDraftDirty = Boolean(
    draft &&
    pageDetail &&
    stableStringify(draft) !== stableStringify(pageDetail.draft),
  );

  const hasUnpublishedChanges = Boolean(
    draft &&
    (!pageDetail?.published ||
      stableStringify(draft) !== stableStringify(pageDetail.published)),
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

  // Saves run one at a time, each with the latest draft and the version the previous save
  // returned. Overlapping saves (auto-save + Save Draft) used to send a stale version and
  // fail with a version conflict.
  const latestDraftRef = useRef(draft);
  latestDraftRef.current = draft;
  const latestPageRef = useRef(pageDetail);
  latestPageRef.current = pageDetail;
  const saveInFlightRef = useRef<Promise<PageDetail | undefined> | null>(null);
  const saveQueuedRef = useRef(false);

  const runSave = async (): Promise<PageDetail | undefined> => {
    const currentDraft = latestDraftRef.current;
    const currentPage = latestPageRef.current;
    if (!currentDraft || !currentPage) return undefined;
    const updated = await updatePage(tenantId, currentPage.id, {
      draft: currentDraft,
      expectedVersion: currentPage.version,
    });
    latestPageRef.current = updated;
    setPageDetail(updated);
    return updated;
  };

  const handleSaveDraft = async (): Promise<PageDetail | undefined> => {
    if (!draft || !pageDetail) return undefined;
    if (saveInFlightRef.current) {
      // Save again (with whatever changed meanwhile) once the running save finishes
      saveQueuedRef.current = true;
      return saveInFlightRef.current;
    }
    setIsSaving(true);
    const saving = (async () => {
      try {
        let updated = await runSave();
        while (saveQueuedRef.current) {
          saveQueuedRef.current = false;
          updated = (await runSave()) ?? updated;
        }
        setSaveStatus("Draft saved");
        setTimeout(() => setSaveStatus(null), 2500);
        queryClient.invalidateQueries({ queryKey: ["pages", tenantId] });
        return updated;
      } catch (err: any) {
        saveQueuedRef.current = false;
        setSaveStatus(`Save error: ${err.message}`);
        throw err;
      } finally {
        saveInFlightRef.current = null;
        setIsSaving(false);
      }
    })();
    saveInFlightRef.current = saving;
    return saving;
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

  // DnD Sensors & collision detection
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const treeCollisionDetection: CollisionDetection = useCallback((args) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions && pointerCollisions.length > 0) {
      return pointerCollisions;
    }
    return closestCenter(args);
  }, []);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  };

  const handleDragOver = (event: DragOverEvent) => {
    setOverDragId(event.over ? String(event.over.id) : null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragId(null);
    setOverDragId(null);

    if (!over || active.id === over.id || !draft) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    // Root cannot be moved
    if (activeId === draft.root.id) return;

    // Cannot move into own descendant
    if (isDescendant(draft.root, activeId, overId)) return;

    const dropTarget = computeDropTarget(draft.root, activeId, overId);
    if (!dropTarget) return;

    const updatedRoot = moveNodeInTree(
      draft.root,
      activeId,
      dropTarget.targetParentId,
      dropTarget.targetIndex,
    );

    pushDraftUpdate({
      ...draft,
      root: updatedRoot,
    });
    setSelectedNodeId(activeId);
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
      case "exportButton":
        newProps = {
          label: "Export",
          template: exportTemplates[0]?.id || "",
          format: "xlsx",
          variant: "secondary",
          size: "md",
          icon: "Download",
        };
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
      case "visual":
        newProps = {};
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
    const updatedRoot = insertNodeSibling(draft.root, nodeId, clone, "after");
    pushDraftUpdate({
      ...draft,
      root: updatedRoot,
    });
    setSelectedNodeId(clone.id);
    setSaveStatus(`Duplicated "${target.type}" (${clone.id})`);
    setTimeout(() => {
      try {
        if (typeof window !== "undefined") setSaveStatus(null);
      } catch {}
    }, 2500);
  };

  const handleCopyNode = (node: NodeDefinition) => {
    setCopiedNode(node);
    setSaveStatus(`Copied "${node.type}" (${node.id})`);
    setTimeout(() => {
      try {
        if (typeof window !== "undefined") setSaveStatus(null);
      } catch {}
    }, 2500);
  };

  const handlePasteNode = (targetNodeId?: string) => {
    if (!draft || !copiedNode) return;
    const targetId = targetNodeId || selectedNodeId || draft.root.id;
    const targetNode = findNode(draft.root, targetId) || draft.root;
    const clone = cloneNodeWithNewIds(copiedNode);

    let updatedRoot: NodeDefinition;
    if (isContainerNode(targetNode)) {
      updatedRoot = insertNodeIntoTree(draft.root, targetNode.id, clone);
    } else {
      updatedRoot = insertNodeSibling(
        draft.root,
        targetNode.id,
        clone,
        "after",
      );
    }

    pushDraftUpdate({
      ...draft,
      root: updatedRoot,
    });
    setSelectedNodeId(clone.id);
    setSaveStatus(`Pasted "${clone.type}" (${clone.id})`);
    setTimeout(() => setSaveStatus(null), 2500);
  };

  // Keyboard shortcuts: Delete removes selected node, Cmd/Ctrl+Z/Shift+Z undo/redo, Cmd/Ctrl+D duplicates, Cmd/Ctrl+C copies, Cmd/Ctrl+V pastes
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

      if (isCmdOrCtrl && e.key.toLowerCase() === "c") {
        if (selectedNodeId && draft) {
          const nodeToCopy = findNode(draft.root, selectedNodeId);
          if (nodeToCopy) {
            e.preventDefault();
            handleCopyNode(nodeToCopy);
          }
        }
        return;
      }

      if (isCmdOrCtrl && e.key.toLowerCase() === "v") {
        if (copiedNode && draft) {
          e.preventDefault();
          handlePasteNode();
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
  }, [draft, selectedNodeId, historyIndex, history, copiedNode]);

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
  const activeDragNode = activeDragId
    ? findNode(draft.root, activeDragId)
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
      {/* Builder Top Bar (wraps to two rows on narrow windows instead of overlapping) */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-2) var(--space-3)",
          padding: "var(--space-2) var(--space-4)",
          borderBottom: "var(--border-width-sm) solid var(--border)",
          backgroundColor: "var(--surface)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", minWidth: 0, flex: "1 1 18rem" }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => navigate("/studio/pages")}
            style={{ flexShrink: 0, whiteSpace: "nowrap" }}
          >
            <ArrowLeft size={TOOLBAR_ICON_SIZE} /> Pages
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", minWidth: 0 }}>
            {/* On a narrow window the name and route shorten (route first); the badges never wrap */}
            <span
              title={pageDetail.name}
              style={{ fontWeight: 600, fontSize: "var(--font-size-sm)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: "3rem" }}
            >
              {pageDetail.name}
            </span>
            <span
              title={pageDetail.route}
              style={{
                color: "var(--text-muted)",
                fontSize: "var(--font-size-sm)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                minWidth: 0,
                flexShrink: 3,
              }}
            >
              {pageDetail.route}
            </span>
            <span className="badge" style={{ fontSize: "var(--font-size-xs)", flexShrink: 0 }}>
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
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
                title="Draft has changes that have not been published live yet"
              >
                <span
                  style={{
                    width: STATUS_DOT_SIZE,
                    height: STATUS_DOT_SIZE,
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
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
                title="All draft changes are published and live"
              >
                <span
                  style={{
                    width: STATUS_DOT_SIZE,
                    height: STATUS_DOT_SIZE,
                    borderRadius: "var(--radius-full)",
                    backgroundColor: "var(--success)",
                  }}
                />
                Up to Date
              </span>
            )}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexShrink: 0 }}>
          {saveStatus && (
            <span
              role={saveStatus.startsWith("Save error") ? "alert" : "status"}
              style={{
                fontSize: "var(--font-size-xs)",
                color: saveStatus.startsWith("Save error") ? "var(--danger)" : "var(--text-muted)",
              }}
            >
              {saveStatus}
            </span>
          )}

          {/* Undo / Redo */}
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-icon"
            onClick={handleUndo}
            disabled={historyIndex <= 0}
            title="Undo"
            aria-label="Undo"
          >
            <Undo2 size={TOOLBAR_ICON_SIZE} />
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-icon"
            onClick={handleRedo}
            disabled={historyIndex >= history.length - 1}
            title="Redo"
            aria-label="Redo"
          >
            <Redo2 size={TOOLBAR_ICON_SIZE} />
          </button>

          <span className="toolbar-separator" aria-hidden="true" />

          {/* State & Data Sources Buttons */}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setIsStateModalOpen(true)}
          >
            <Sliders size={TOOLBAR_ICON_SIZE} /> State ({Object.keys(draft.state || {}).length})
          </button>

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setIsDataSourceModalOpen(true)}
          >
            <Database size={TOOLBAR_ICON_SIZE} /> Data Sources ({(draft.dataSources || []).length})
          </button>

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setIsTemplateModalOpen(true)}
          >
            <LayoutTemplate size={TOOLBAR_ICON_SIZE} /> Templates
          </button>

          {pageDetail && (
            <ShareButton
              kind="page-template"
              sourceId={pageDetail.id}
              dirty={isDraftDirty}
              className="btn btn-secondary btn-sm"
              onMessage={(_tone, text) => {
                setSaveStatus(text);
                setTimeout(() => setSaveStatus(null), 5000);
              }}
            />
          )}

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setIsRolesModalOpen(true)}
          >
            <Shield size={TOOLBAR_ICON_SIZE} /> Allowed Roles (
            {draft.allowedRoles && draft.allowedRoles.length > 0
              ? draft.allowedRoles.length
              : "All"}
            )
          </button>

          <span className="toolbar-separator" aria-hidden="true" />

          {/* Validation Status Indicator */}
          <div style={{ position: "relative" }}>
            <button
              type="button"
              className="btn btn-sm"
              aria-expanded={showValidationPopover}
              onClick={() => setShowValidationPopover(!showValidationPopover)}
              style={{
                backgroundColor:
                  brokenBindings.length === 0
                    ? "var(--success-bg)"
                    : "var(--warning-bg)",
                color:
                  brokenBindings.length === 0
                    ? "var(--success)"
                    : "var(--warning)",
                borderColor: brokenBindings.length === 0 ? "transparent" : "var(--warning-border)",
              }}
            >
              {brokenBindings.length === 0 ? (
                <>
                  <Check size={TOOLBAR_ICON_SIZE} /> Valid
                </>
              ) : (
                <>
                  <AlertTriangle size={TOOLBAR_ICON_SIZE} /> {brokenBindings.length} broken
                </>
              )}
            </button>

            {showValidationPopover && (
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  right: 0,
                  marginTop: "var(--space-1)",
                  width: "320px",
                  backgroundColor: "var(--surface)",
                  border: "var(--border-width-sm) solid var(--border)",
                  borderRadius: "var(--radius-surface)",
                  padding: "var(--space-3)",
                  boxShadow: "var(--shadow-md)",
                  zIndex: 50,
                  fontSize: "var(--font-size-xs)",
                }}
              >
                <div
                  style={{ fontWeight: 600, marginBottom: "var(--space-1)" }}
                >
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

          <span className="toolbar-separator" aria-hidden="true" />

          {/* Preview Published toggle */}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setIsPreviewPublished(!isPreviewPublished)}
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
            aria-label="Save Draft"
            data-testid="save-draft-btn"
            className="btn btn-secondary btn-sm"
            onClick={() => handleSaveDraft().catch(() => {})}
            disabled={isSaving || !isDraftDirty}
            title={
              isDraftDirty ? "Save changes to draft" : "Draft is already saved"
            }
          >
            {isSaving ? (
              "Saving..."
            ) : isDraftDirty ? (
              <>
                <span
                  style={{
                    width: STATUS_DOT_SIZE,
                    height: STATUS_DOT_SIZE,
                    borderRadius: "var(--radius-full)",
                    backgroundColor: "var(--warning)",
                  }}
                />
                Save Draft
              </>
            ) : (
              <>
                <Check size={TOOLBAR_ICON_SIZE} style={{ color: "var(--success)" }} />
                Draft Saved
              </>
            )}
          </button>

          {/* Publish Button */}
          <button
            type="button"
            aria-label="Publish"
            data-testid="publish-btn"
            className={
              hasUnpublishedChanges ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm"
            }
            onClick={handlePublish}
            disabled={publishMut.isPending || !hasUnpublishedChanges}
            style={{ fontWeight: 600 }}
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
                    width: STATUS_DOT_SIZE,
                    height: STATUS_DOT_SIZE,
                    borderRadius: "var(--radius-full)",
                    backgroundColor: "var(--accent-contrast)",
                  }}
                />
                Publish
              </>
            ) : (
              <>
                <Check size={TOOLBAR_ICON_SIZE} />
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
              borderBottom: "1px solid var(--border)",
              overflowY: "auto",
              maxWidth: "360px",
            }}
          >
            <div
              style={{
                fontSize: "var(--font-size-xs)",
                fontWeight: 600,
                color: "var(--text-muted)",
                textTransform: "uppercase",
                marginBottom: "0.5rem",
                padding: "0.3rem 0.575rem",
                position: "sticky",
                top: "0",
                left: "0",
                backgroundColor: "var(--bg)",
                zIndex: "1",
              }}
            >
              Add Component
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "0.375rem",
                padding: "0.5rem",
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
                  "exportButton",
                  "table",
                  "form",
                  "stat",
                  "chart",
                  "visual",
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
                  <Plus size={12} /> {type === "exportButton" ? "Export" : type}
                </button>
              ))}
            </div>
          </div>

          {/* Tree View */}
          <div style={{ flex: 1, overflowY: "auto", maxWidth: "360px" }}>
            <div
              style={{
                fontSize: "var(--font-size-xs)",
                fontWeight: 600,
                color: "var(--text-muted)",
                textTransform: "uppercase",
                padding: "0.3rem 0.575rem",
                position: "sticky",
                top: "0",
                left: '0',
                backgroundColor: "var(--bg)",
                zIndex: "1",
              }}
            >
              Component Tree
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "0.5rem",
              }}
            >
              {copiedNode && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => handlePasteNode()}
                  style={{
                    padding: "0.2rem var(--space-2)",
                    fontSize: "var(--font-size-xs)",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "var(--space-1)",
                  }}
                  title={`Paste ${copiedNode.type} into selected container or root`}
                  aria-label="Paste copied component"
                >
                  <ClipboardPaste size={12} /> Paste {copiedNode.type}
                </button>
              )}
            </div>
            <DndContext
              sensors={sensors}
              collisionDetection={treeCollisionDetection}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={getAllNodeIds(draft.root)}
                strategy={verticalListSortingStrategy}
              >
                <SortableTreeItem
                  node={draft.root}
                  selectedId={selectedNodeId}
                  hoveredId={hoveredNodeId}
                  activeDragId={activeDragId}
                  overDragId={overDragId}
                  copiedNode={copiedNode}
                  onSelect={setSelectedNodeId}
                  onHover={setHoveredNodeId}
                  onDelete={handleDeleteNode}
                  onDuplicate={handleDuplicateNode}
                  onCopy={handleCopyNode}
                  onPaste={handlePasteNode}
                />
              </SortableContext>
              <DragOverlay>
                {activeDragNode ? (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--space-2)",
                      padding: "0.375rem 0.5rem",
                      borderRadius: "var(--radius-control)",
                      backgroundColor: "var(--surface)",
                      border: "1px solid var(--accent)",
                      boxShadow: "var(--shadow-md)",
                      fontSize: "var(--font-size-xs)",
                      cursor: "grabbing",
                    }}
                  >
                    <GripVertical
                      size={13}
                      style={{ color: "var(--accent)" }}
                    />
                    <span style={{ fontWeight: 600, color: "var(--accent)" }}>
                      {activeDragNode.type}
                    </span>
                    <span
                      style={{
                        color: "var(--muted)",
                        fontFamily: "var(--font-mono)",
                      }}
                    >
                      {activeDragNode.id}
                    </span>
                  </div>
                ) : null}
              </DragOverlay>
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
                          borderRadius: "var(--radius-surface)",
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
                    <div className={`page-width-preview${pageDetail.published.width === "full" ? " page-width-preview-full" : ""}`}>
                      {renderNode(pageDetail.published.root)}
                    </div>
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
                    className={`page-width-preview${draft.width === "full" ? " page-width-preview-full" : ""}`}
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

                  <div>
                    <label className="form-label" htmlFor="prop-table-empty">
                      Empty Message
                    </label>
                    <input
                      id="prop-table-empty"
                      type="text"
                      className="form-input"
                      placeholder="No records found"
                      value={selectedNode.props?.emptyMessage || ""}
                      onChange={(e) =>
                        handleUpdateProps({
                          ...selectedNode.props,
                          emptyMessage: e.target.value || undefined,
                        })
                      }
                    />
                  </div>

                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "0.75rem",
                      paddingTop: "0.25rem",
                    }}
                  >
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
                        checked={Boolean(selectedNode.props?.striped)}
                        onChange={(e) =>
                          handleUpdateProps({
                            ...selectedNode.props,
                            striped: e.target.checked,
                          })
                        }
                      />
                      <span>Striped</span>
                    </label>
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
                        checked={Boolean(selectedNode.props?.compact)}
                        onChange={(e) =>
                          handleUpdateProps({
                            ...selectedNode.props,
                            compact: e.target.checked,
                          })
                        }
                      />
                      <span>Compact</span>
                    </label>
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
                        checked={selectedNode.props?.bordered !== false}
                        onChange={(e) =>
                          handleUpdateProps({
                            ...selectedNode.props,
                            bordered: e.target.checked,
                          })
                        }
                      />
                      <span>Bordered</span>
                    </label>
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
                    <label className="form-label" htmlFor="prop-details-cols">
                      Columns Layout
                    </label>
                    <select
                      id="prop-details-cols"
                      className="form-select"
                      value={selectedNode.props?.columns || 1}
                      onChange={(e) =>
                        handleUpdateProps({
                          ...selectedNode.props,
                          columns: Number(e.target.value) || 1,
                        })
                      }
                    >
                      <option value={1}>1 Column (Stacked)</option>
                      <option value={2}>2 Columns</option>
                      <option value={3}>3 Columns</option>
                      <option value={4}>4 Columns</option>
                    </select>
                  </div>

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
                        icon?: string;
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
                                    borderRadius: "var(--radius-control)",
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
                                      <div>
                                        <IconPicker
                                          clearable
                                          label="Custom Icon (Optional)"
                                          placeholder="Default icon"
                                          value={fieldConfig.icon}
                                          onChange={(icon) => {
                                            const newFields =
                                              selectedFields.map((f) =>
                                                f.fieldId === col.id
                                                  ? { ...f, icon }
                                                  : f,
                                              );
                                            handleUpdateProps({
                                              ...selectedNode.props,
                                              fields: newFields,
                                            });
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

                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "var(--space-2)",
                      padding: "var(--space-3)",
                      backgroundColor: "var(--surface-subtle)",
                      borderRadius: "var(--radius-control)",
                    }}
                  >
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "var(--space-2)",
                        cursor: "pointer",
                        fontSize: "var(--font-size-xs)",
                        fontWeight: 600,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedNode.props?.showFooter !== false}
                        onChange={(e) =>
                          handleUpdateProps({
                            ...selectedNode.props,
                            showFooter: e.target.checked,
                          })
                        }
                      />
                      <span>Show Footer Actions</span>
                    </label>

                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "var(--space-2)",
                        cursor: "pointer",
                        fontSize: "var(--font-size-xs)",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(selectedNode.props?.showCancel)}
                        onChange={(e) =>
                          handleUpdateProps({
                            ...selectedNode.props,
                            showCancel: e.target.checked,
                          })
                        }
                      />
                      <span>Show Cancel Button</span>
                    </label>

                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "var(--space-2)",
                        cursor: "pointer",
                        fontSize: "var(--font-size-xs)",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(selectedNode.props?.showDelete)}
                        onChange={(e) =>
                          handleUpdateProps({
                            ...selectedNode.props,
                            showDelete: e.target.checked,
                          })
                        }
                      />
                      <span>Show Delete Button</span>
                    </label>
                  </div>

                  <ActionEditor
                    label="On Cancel Actions"
                    actions={selectedNode.props?.onCancel || []}
                    onChange={(actions) =>
                      handleUpdateProps({
                        ...selectedNode.props,
                        onCancel: actions,
                      })
                    }
                  />

                  <ActionEditor
                    label="On Delete Actions"
                    actions={selectedNode.props?.onDelete || []}
                    onChange={(actions) =>
                      handleUpdateProps({
                        ...selectedNode.props,
                        onDelete: actions,
                      })
                    }
                  />

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
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "0.5rem",
                    }}
                  >
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
                    <div>
                      <label className="form-label" htmlFor="prop-text-align">
                        Alignment
                      </label>
                      <select
                        id="prop-text-align"
                        className="form-select"
                        value={selectedNode.props?.align || "left"}
                        onChange={(e) =>
                          handleUpdateProps({
                            ...selectedNode.props,
                            align: e.target.value,
                          })
                        }
                      >
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                        <option value="right">Right</option>
                        <option value="justify">Justify</option>
                      </select>
                    </div>
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "0.5rem",
                    }}
                  >
                    <div>
                      <label className="form-label" htmlFor="prop-text-weight">
                        Font Weight
                      </label>
                      <select
                        id="prop-text-weight"
                        className="form-select"
                        value={selectedNode.props?.weight || ""}
                        onChange={(e) =>
                          handleUpdateProps({
                            ...selectedNode.props,
                            weight: e.target.value || undefined,
                          })
                        }
                      >
                        <option value="">Default</option>
                        <option value="normal">Normal</option>
                        <option value="medium">Medium</option>
                        <option value="semibold">Semibold</option>
                        <option value="bold">Bold</option>
                      </select>
                    </div>
                    <div>
                      <label className="form-label" htmlFor="prop-text-color">
                        Color Token
                      </label>
                      <select
                        id="prop-text-color"
                        className="form-select"
                        value={selectedNode.props?.color || "default"}
                        onChange={(e) =>
                          handleUpdateProps({
                            ...selectedNode.props,
                            color: e.target.value,
                          })
                        }
                      >
                        <option value="default">Default</option>
                        <option value="muted">Muted</option>
                        <option value="primary">Primary / Accent</option>
                        <option value="success">Success</option>
                        <option value="danger">Danger</option>
                        <option value="warning">Warning</option>
                      </select>
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.5rem",
                      paddingTop: "0.25rem",
                    }}
                  >
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
                        checked={Boolean(selectedNode.props?.noWrap)}
                        onChange={(e) =>
                          handleUpdateProps({
                            ...selectedNode.props,
                            noWrap: e.target.checked,
                          })
                        }
                      />
                      <span>Single line (prevent text wrap)</span>
                    </label>
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
                        checked={Boolean(selectedNode.props?.truncate)}
                        onChange={(e) =>
                          handleUpdateProps({
                            ...selectedNode.props,
                            truncate: e.target.checked,
                          })
                        }
                      />
                      <span>Truncate text with ellipsis (...)</span>
                    </label>
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
                        checked={
                          selectedNode.props?.flex === 1 ||
                          selectedNode.props?.flex === "1"
                        }
                        onChange={(e) =>
                          handleUpdateProps({
                            ...selectedNode.props,
                            flex: e.target.checked ? 1 : undefined,
                          })
                        }
                      />
                      <span>Fill remaining flex space (flex: 1)</span>
                    </label>
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
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "0.5rem",
                    }}
                  >
                    <div>
                      <label
                        className="form-label"
                        htmlFor="prop-button-variant"
                      >
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
                    <div>
                      <label className="form-label" htmlFor="prop-button-size">
                        Size
                      </label>
                      <select
                        id="prop-button-size"
                        className="form-select"
                        value={selectedNode.props?.size || "md"}
                        onChange={(e) =>
                          handleUpdateProps({
                            ...selectedNode.props,
                            size: e.target.value,
                          })
                        }
                      >
                        <option value="sm">Small</option>
                        <option value="md">Medium</option>
                        <option value="lg">Large</option>
                      </select>
                    </div>
                  </div>
                  <IconPicker
                    clearable
                    id="prop-button-icon"
                    label="Button Icon (optional)"
                    value={selectedNode.props?.icon}
                    onChange={(icon) =>
                      handleUpdateProps({ ...selectedNode.props, icon })
                    }
                  />
                  {selectedNode.props?.icon && (
                    <div>
                      <label
                        className="form-label"
                        htmlFor="prop-button-icon-pos"
                      >
                        Icon Position
                      </label>
                      <select
                        id="prop-button-icon-pos"
                        className="form-select"
                        value={selectedNode.props?.iconPosition || "left"}
                        onChange={(e) =>
                          handleUpdateProps({
                            ...selectedNode.props,
                            iconPosition: e.target.value,
                          })
                        }
                      >
                        <option value="left">Left</option>
                        <option value="right">Right</option>
                      </select>
                    </div>
                  )}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "1rem",
                      paddingTop: "0.25rem",
                    }}
                  >
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
                        checked={Boolean(selectedNode.props?.fullWidth)}
                        onChange={(e) =>
                          handleUpdateProps({
                            ...selectedNode.props,
                            fullWidth: e.target.checked,
                          })
                        }
                      />
                      <span>Full Width</span>
                    </label>
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
                        checked={Boolean(selectedNode.props?.disabled)}
                        onChange={(e) =>
                          handleUpdateProps({
                            ...selectedNode.props,
                            disabled: e.target.checked,
                          })
                        }
                      />
                      <span>Disabled</span>
                    </label>
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

              {/* Export Button Component Properties */}
              {selectedNode.type === "exportButton" && (
                <>
                  <ExpressionInput
                    id="prop-export-button-label"
                    label="Button Label"
                    value={selectedNode.props?.label || "Export"}
                    placeholder="e.g. Export Records"
                    onChange={(val) =>
                      handleUpdateProps({ ...selectedNode.props, label: val })
                    }
                  />

                  <div>
                    <label
                      className="form-label"
                      htmlFor="prop-export-button-template"
                    >
                      Export Template
                    </label>
                    <select
                      id="prop-export-button-template"
                      className="form-select"
                      value={selectedNode.props?.template || ""}
                      onChange={(e) =>
                        handleUpdateProps({
                          ...selectedNode.props,
                          template: e.target.value,
                        })
                      }
                    >
                      <option value="">Select a template...</option>
                      {exportTemplates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} (v{t.version || 1})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "0.5rem",
                    }}
                  >
                    <div>
                      <label
                        className="form-label"
                        htmlFor="prop-export-button-format"
                      >
                        Format
                      </label>
                      <select
                        id="prop-export-button-format"
                        className="form-select"
                        value={selectedNode.props?.format || "xlsx"}
                        onChange={(e) =>
                          handleUpdateProps({
                            ...selectedNode.props,
                            format: e.target.value,
                          })
                        }
                      >
                        <option value="xlsx">XLSX (Excel)</option>
                        <option value="csv">CSV</option>
                        <option value="pdf">PDF</option>
                      </select>
                    </div>

                    <div>
                      <label
                        className="form-label"
                        htmlFor="prop-export-button-variant"
                      >
                        Variant
                      </label>
                      <select
                        id="prop-export-button-variant"
                        className="form-select"
                        value={selectedNode.props?.variant || "secondary"}
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
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "0.5rem",
                    }}
                  >
                    <div>
                      <label
                        className="form-label"
                        htmlFor="prop-export-button-size"
                      >
                        Size
                      </label>
                      <select
                        id="prop-export-button-size"
                        className="form-select"
                        value={selectedNode.props?.size || "md"}
                        onChange={(e) =>
                          handleUpdateProps({
                            ...selectedNode.props,
                            size: e.target.value,
                          })
                        }
                      >
                        <option value="sm">Small</option>
                        <option value="md">Medium</option>
                        <option value="lg">Large</option>
                      </select>
                    </div>
                  </div>

                  <IconPicker
                    clearable
                    id="prop-export-button-icon"
                    label="Icon (optional)"
                    placeholder="Default icon"
                    value={selectedNode.props?.icon}
                    onChange={(icon) =>
                      handleUpdateProps({ ...selectedNode.props, icon })
                    }
                  />

                  <ExpressionInput
                    id="prop-export-button-parameters"
                    label="Parameters Expression (optional)"
                    value={
                      typeof selectedNode.props?.parameters === "string"
                        ? selectedNode.props.parameters
                        : selectedNode.props?.parameters
                          ? JSON.stringify(selectedNode.props.parameters)
                          : ""
                    }
                    placeholder="e.g. {{ state.exportParams }}"
                    onChange={(val) =>
                      handleUpdateProps({
                        ...selectedNode.props,
                        parameters: val || undefined,
                      })
                    }
                  />

                  <ExpressionInput
                    id="prop-export-button-filters"
                    label="Filters Expression (optional)"
                    value={
                      typeof selectedNode.props?.filters === "string"
                        ? selectedNode.props.filters
                        : selectedNode.props?.filters
                          ? JSON.stringify(selectedNode.props.filters)
                          : ""
                    }
                    placeholder="e.g. {{ state.exportFilters }}"
                    onChange={(val) =>
                      handleUpdateProps({
                        ...selectedNode.props,
                        filters: val || undefined,
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
                        <option value="email">Email</option>
                        <option value="password">Password</option>
                        <option value="search">Search</option>
                        <option value="url">URL</option>
                        <option value="date">Date</option>
                      </select>
                    </div>
                  </div>
                  <IconPicker
                    clearable
                    id="prop-input-prefix-icon"
                    label="Prefix Icon (optional)"
                    value={selectedNode.props?.prefixIcon}
                    onChange={(prefixIcon) =>
                      handleUpdateProps({ ...selectedNode.props, prefixIcon })
                    }
                  />
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
                    <label className="form-label">Help Text</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Optional helper text below input"
                      value={selectedNode.props?.helpText || ""}
                      onChange={(e) =>
                        handleUpdateProps({
                          ...selectedNode.props,
                          helpText: e.target.value || undefined,
                        })
                      }
                    />
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "1rem",
                      paddingTop: "0.25rem",
                    }}
                  >
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
                        checked={Boolean(selectedNode.props?.required)}
                        onChange={(e) =>
                          handleUpdateProps({
                            ...selectedNode.props,
                            required: e.target.checked,
                          })
                        }
                      />
                      <span>Required</span>
                    </label>
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
                        checked={Boolean(selectedNode.props?.disabled)}
                        onChange={(e) =>
                          handleUpdateProps({
                            ...selectedNode.props,
                            disabled: e.target.checked,
                          })
                        }
                      />
                      <span>Disabled</span>
                    </label>
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
                    <label className="form-label">Placeholder</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Select an option..."
                      value={selectedNode.props?.placeholder || ""}
                      onChange={(e) =>
                        handleUpdateProps({
                          ...selectedNode.props,
                          placeholder: e.target.value || undefined,
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className="form-label">Help Text</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Optional helper text below select"
                      value={selectedNode.props?.helpText || ""}
                      onChange={(e) =>
                        handleUpdateProps({
                          ...selectedNode.props,
                          helpText: e.target.value || undefined,
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
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "1rem",
                      paddingTop: "0.25rem",
                    }}
                  >
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
                        checked={Boolean(selectedNode.props?.clearable)}
                        onChange={(e) =>
                          handleUpdateProps({
                            ...selectedNode.props,
                            clearable: e.target.checked,
                          })
                        }
                      />
                      <span>Clearable</span>
                    </label>
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
                        checked={Boolean(selectedNode.props?.disabled)}
                        onChange={(e) =>
                          handleUpdateProps({
                            ...selectedNode.props,
                            disabled: e.target.checked,
                          })
                        }
                      />
                      <span>Disabled</span>
                    </label>
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
                  <IconPicker
                    clearable
                    id="prop-modal-icon"
                    label="Header Icon (optional)"
                    placeholder="Entity icon or none"
                    value={selectedNode.props?.icon}
                    onChange={(icon) =>
                      handleUpdateProps({ ...selectedNode.props, icon })
                    }
                  />
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
                  <div>
                    <label className="form-label">Modal Size</label>
                    <select
                      className="form-select"
                      value={selectedNode.props?.size || "md"}
                      onChange={(e) =>
                        handleUpdateProps({
                          ...selectedNode.props,
                          size: e.target.value,
                        })
                      }
                    >
                      <option value="sm">Small (400px)</option>
                      <option value="md">Medium (540px)</option>
                      <option value="lg">Large (720px)</option>
                      <option value="xl">Extra Large (960px)</option>
                      <option value="full">Full Width</option>
                    </select>
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
                        checked={selectedNode.props?.showCloseButton !== false}
                        onChange={(e) =>
                          handleUpdateProps({
                            ...selectedNode.props,
                            showCloseButton: e.target.checked,
                          })
                        }
                      />
                      <span>Show Close Button (X)</span>
                    </label>
                  </div>
                  <ContentLayoutSection>
                    <ContentLayoutFields
                      idPrefix="prop-modal"
                      value={selectedNode.props || {}}
                      onChange={(patch) =>
                        handleUpdateProps({ ...selectedNode.props, ...patch })
                      }
                    />
                  </ContentLayoutSection>
                </>
              )}

              {/* Stack Properties */}
              {selectedNode.type === "stack" && (
                <>
                  <ContentLayoutFields
                    idPrefix="prop-stack"
                    value={selectedNode.props || {}}
                    onChange={(patch) =>
                      handleUpdateProps({ ...selectedNode.props, ...patch })
                    }
                  />
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "0.5rem",
                    }}
                  >
                    <div>
                      <label
                        className="form-label"
                        htmlFor="prop-stack-padding"
                      >
                        Padding (px)
                      </label>
                      <input
                        id="prop-stack-padding"
                        type="number"
                        min={0}
                        placeholder="0"
                        className="form-input"
                        value={selectedNode.props?.padding ?? ""}
                        onChange={(e) =>
                          handleUpdateProps({
                            ...selectedNode.props,
                            padding:
                              e.target.value === ""
                                ? undefined
                                : Number(e.target.value),
                          })
                        }
                      />
                    </div>
                  </div>
                  <div>
                    <label className="form-label" htmlFor="prop-stack-bg">
                      Background Style
                    </label>
                    <select
                      id="prop-stack-bg"
                      className="form-select"
                      value={selectedNode.props?.background || "transparent"}
                      onChange={(e) =>
                        handleUpdateProps({
                          ...selectedNode.props,
                          background:
                            e.target.value === "transparent"
                              ? undefined
                              : e.target.value,
                        })
                      }
                    >
                      <option value="transparent">Transparent (None)</option>
                      <option value="surface">Surface</option>
                      <option value="surface-subtle">Subtle Surface</option>
                      <option value="surface-2">Elevated Surface (Card)</option>
                    </select>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "1rem",
                      paddingTop: "0.25rem",
                    }}
                  >
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
                        checked={Boolean(selectedNode.props?.border)}
                        onChange={(e) =>
                          handleUpdateProps({
                            ...selectedNode.props,
                            border: e.target.checked,
                          })
                        }
                      />
                      <span>Show Border</span>
                    </label>
                  </div>
                </>
              )}

              {/* Grid Properties */}
              {selectedNode.type === "grid" && (
                <>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "0.5rem",
                    }}
                  >
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
                  </div>
                  <div>
                    <label className="form-label" htmlFor="prop-grid-min-width">
                      Min Column Width (px, optional)
                    </label>
                    <input
                      id="prop-grid-min-width"
                      type="number"
                      min={0}
                      placeholder="e.g. 240 (auto-fit mode)"
                      className="form-input"
                      value={selectedNode.props?.minColWidth ?? ""}
                      onChange={(e) =>
                        handleUpdateProps({
                          ...selectedNode.props,
                          minColWidth:
                            e.target.value === ""
                              ? undefined
                              : Number(e.target.value),
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className="form-label" htmlFor="prop-grid-align">
                      Align Items
                    </label>
                    <select
                      id="prop-grid-align"
                      className="form-select"
                      value={selectedNode.props?.align || ""}
                      onChange={(e) =>
                        handleUpdateProps({
                          ...selectedNode.props,
                          align: e.target.value || undefined,
                        })
                      }
                    >
                      <option value="">Default (Stretch)</option>
                      <option value="stretch">Stretch</option>
                      <option value="start">Start (Top)</option>
                      <option value="center">Center</option>
                      <option value="end">End (Bottom)</option>
                    </select>
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
                  <IconPicker
                    clearable
                    id="prop-card-icon"
                    label="Header Icon (optional)"
                    value={selectedNode.props?.headerIcon}
                    onChange={(headerIcon) =>
                      handleUpdateProps({ ...selectedNode.props, headerIcon })
                    }
                  />
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "0.5rem",
                    }}
                  >
                    <div>
                      <label className="form-label" htmlFor="prop-card-variant">
                        Style Variant
                      </label>
                      <select
                        id="prop-card-variant"
                        className="form-select"
                        value={selectedNode.props?.variant || "default"}
                        onChange={(e) =>
                          handleUpdateProps({
                            ...selectedNode.props,
                            variant: e.target.value,
                          })
                        }
                      >
                        <option value="default">Default (Shadow)</option>
                        <option value="bordered">Bordered</option>
                        <option value="flat">Flat (Subtle)</option>
                        <option value="elevated">Elevated</option>
                      </select>
                    </div>
                    <div>
                      <label className="form-label" htmlFor="prop-card-padding">
                        Padding
                      </label>
                      <select
                        id="prop-card-padding"
                        className="form-select"
                        value={selectedNode.props?.padding || "md"}
                        onChange={(e) =>
                          handleUpdateProps({
                            ...selectedNode.props,
                            padding: e.target.value,
                          })
                        }
                      >
                        <option value="none">None (0)</option>
                        <option value="sm">Small</option>
                        <option value="md">Medium</option>
                        <option value="lg">Large</option>
                      </select>
                    </div>
                  </div>
                  <ContentLayoutSection>
                    <ContentLayoutFields
                      idPrefix="prop-card"
                      value={selectedNode.props || {}}
                      onChange={(patch) =>
                        handleUpdateProps({ ...selectedNode.props, ...patch })
                      }
                    />
                  </ContentLayoutSection>
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
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "0.5rem",
                    }}
                  >
                    <div>
                      <label className="form-label" htmlFor="prop-tabs-variant">
                        Tab Style
                      </label>
                      <select
                        id="prop-tabs-variant"
                        className="form-select"
                        value={selectedNode.props?.variant || "line"}
                        onChange={(e) =>
                          handleUpdateProps({
                            ...selectedNode.props,
                            variant: e.target.value,
                          })
                        }
                      >
                        <option value="line">Underline (Default)</option>
                        <option value="pills">Pills</option>
                        <option value="enclosed">Enclosed</option>
                      </select>
                    </div>
                    <div>
                      <label className="form-label" htmlFor="prop-tabs-size">
                        Size
                      </label>
                      <select
                        id="prop-tabs-size"
                        className="form-select"
                        value={selectedNode.props?.size || "md"}
                        onChange={(e) =>
                          handleUpdateProps({
                            ...selectedNode.props,
                            size: e.target.value,
                          })
                        }
                      >
                        <option value="sm">Small</option>
                        <option value="md">Medium</option>
                        <option value="lg">Large</option>
                      </select>
                    </div>
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
                  <IconPicker
                    clearable
                    id="prop-stat-icon"
                    label="Stat Icon (optional)"
                    value={selectedNode.props?.icon}
                    onChange={(icon) =>
                      handleUpdateProps({ ...selectedNode.props, icon })
                    }
                  />
                  <div>
                    <div>
                      <label className="form-label" htmlFor="prop-stat-color">
                        Accent Color
                      </label>
                      <select
                        id="prop-stat-color"
                        className="form-select"
                        value={selectedNode.props?.color || "default"}
                        onChange={(e) =>
                          handleUpdateProps({
                            ...selectedNode.props,
                            color: e.target.value,
                          })
                        }
                      >
                        <option value="default">Default</option>
                        <option value="primary">Primary</option>
                        <option value="success">Success</option>
                        <option value="danger">Danger</option>
                        <option value="warning">Warning</option>
                      </select>
                    </div>
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
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "0.5rem",
                    }}
                  >
                    <div>
                      <label className="form-label" htmlFor="prop-stat-trend">
                        Trend Direction
                      </label>
                      <select
                        id="prop-stat-trend"
                        className="form-select"
                        value={selectedNode.props?.trend || ""}
                        onChange={(e) =>
                          handleUpdateProps({
                            ...selectedNode.props,
                            trend: e.target.value || undefined,
                          })
                        }
                      >
                        <option value="">None</option>
                        <option value="up">Trending Up</option>
                        <option value="down">Trending Down</option>
                        <option value="neutral">Neutral</option>
                      </select>
                    </div>
                    <div>
                      <label
                        className="form-label"
                        htmlFor="prop-stat-trendval"
                      >
                        Trend Value
                      </label>
                      <input
                        id="prop-stat-trendval"
                        type="text"
                        className="form-input"
                        placeholder="e.g. +12.5%"
                        value={selectedNode.props?.trendValue || ""}
                        onChange={(e) =>
                          handleUpdateProps({
                            ...selectedNode.props,
                            trendValue: e.target.value || undefined,
                          })
                        }
                      />
                    </div>
                  </div>
                </>
              )}

              {selectedNode.type === "visual" && (
                <VisualPropsEditor props={selectedNode.props ?? {}} onChange={handleUpdateProps} />
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
                  <IconPicker
                    clearable
                    id="prop-chart-icon"
                    label="Title Icon (optional)"
                    value={selectedNode.props?.icon}
                    onChange={(icon) =>
                      handleUpdateProps({ ...selectedNode.props, icon })
                    }
                  />
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

                  {/* Axis titles: on by default, derived from the fields unless customised */}
                  {(() => {
                    let activeEntityId = selectedNode.props?.entityId;
                    if (selectedNode.props?.source) {
                      activeEntityId = (draft.dataSources || []).find(
                        (d) => d.id === selectedNode.props?.source,
                      )?.entityId;
                    }
                    const columns = entities.find((e) => e.id === activeEntityId)?.columns || [];
                    const labelOf = (id?: string) => columns.find((c) => c.id === id)?.label;
                    const auto = defaultChartAxisTitles(
                      labelOf(selectedNode.props?.groupByFieldId),
                      selectedNode.props?.aggregateOp,
                      labelOf(selectedNode.props?.aggregateFieldId),
                    );
                    const showAxisTitles = selectedNode.props?.showAxisTitles !== false;
                    return (
                      <div
                        style={{
                          borderTop: "1px solid var(--border)",
                          paddingTop: "0.75rem",
                          display: "flex",
                          flexDirection: "column",
                          gap: "0.625rem",
                        }}
                      >
                        <label
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "0.5rem",
                            fontSize: "var(--font-size-sm)",
                            fontWeight: 500,
                            cursor: "pointer",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={showAxisTitles}
                            onChange={(e) =>
                              handleUpdateProps({
                                ...selectedNode.props,
                                // Default is on, so only "off" is stored
                                showAxisTitles: e.target.checked ? undefined : false,
                              })
                            }
                          />
                          Show axis titles
                        </label>
                        {showAxisTitles && (
                          <>
                            <div>
                              <label className="form-label" htmlFor="prop-chart-xtitle">
                                X-axis title
                              </label>
                              <input
                                id="prop-chart-xtitle"
                                type="text"
                                className="form-input"
                                maxLength={120}
                                placeholder={`Auto: ${auto.x}`}
                                value={selectedNode.props?.xAxisTitle || ""}
                                onChange={(e) =>
                                  handleUpdateProps({
                                    ...selectedNode.props,
                                    xAxisTitle: e.target.value || undefined,
                                  })
                                }
                              />
                            </div>
                            <div>
                              <label className="form-label" htmlFor="prop-chart-ytitle">
                                Y-axis title
                              </label>
                              <input
                                id="prop-chart-ytitle"
                                type="text"
                                className="form-input"
                                maxLength={120}
                                placeholder={`Auto: ${auto.y}`}
                                value={selectedNode.props?.yAxisTitle || ""}
                                onChange={(e) =>
                                  handleUpdateProps({
                                    ...selectedNode.props,
                                    yAxisTitle: e.target.value || undefined,
                                  })
                                }
                              />
                            </div>
                            <p
                              style={{
                                margin: 0,
                                fontSize: "var(--font-size-xs)",
                                color: "var(--text-muted)",
                              }}
                            >
                              Leave empty to use the automatic title.
                            </p>
                          </>
                        )}
                      </div>
                    );
                  })()}
                </>
              )}

              {/* Universal Sizing & Flex Layout Properties */}
              {selectedNode.type !== "modal" && (
                <div
                  style={{
                    borderTop: "1px solid var(--border)",
                    paddingTop: "0.875rem",
                    marginTop: "0.5rem",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.75rem",
                  }}
                >
                  <div
                    style={{
                      fontSize: "var(--font-size-xs)",
                      fontWeight: 600,
                      color: "var(--text-muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      display: "flex",
                      alignItems: "center",
                      gap: "0.375rem",
                    }}
                  >
                    <Sliders size={13} /> Sizing & Flex Layout
                  </div>

                  <div>
                    <label className="form-label" htmlFor="prop-layout-flex">
                      Flex Child (Grow / Sizing)
                    </label>
                    <div
                      style={{
                        display: "flex",
                        gap: "0.375rem",
                        marginBottom: "0.375rem",
                      }}
                    >
                      <button
                        type="button"
                        className={`btn ${
                          selectedNode.props?.flex === 1 ||
                          selectedNode.props?.flex === "1"
                            ? "btn-primary"
                            : "btn-secondary"
                        }`}
                        style={{
                          fontSize: "var(--font-size-xs)",
                          padding: "0.2rem 0.5rem",
                          flex: 1,
                        }}
                        onClick={() =>
                          handleUpdateProps({
                            ...selectedNode.props,
                            flex: 1,
                          })
                        }
                      >
                        Fill (flex: 1)
                      </button>
                      <button
                        type="button"
                        className={`btn ${
                          selectedNode.props?.flex === "0 0 auto" ||
                          selectedNode.props?.flex === "none"
                            ? "btn-primary"
                            : "btn-secondary"
                        }`}
                        style={{
                          fontSize: "var(--font-size-xs)",
                          padding: "0.2rem 0.5rem",
                          flex: 1,
                        }}
                        onClick={() =>
                          handleUpdateProps({
                            ...selectedNode.props,
                            flex: "0 0 auto",
                          })
                        }
                      >
                        Fit (auto)
                      </button>
                      <button
                        type="button"
                        className={`btn ${
                          selectedNode.props?.flex === undefined
                            ? "btn-primary"
                            : "btn-secondary"
                        }`}
                        style={{
                          fontSize: "var(--font-size-xs)",
                          padding: "0.2rem 0.5rem",
                        }}
                        onClick={() =>
                          handleUpdateProps({
                            ...selectedNode.props,
                            flex: undefined,
                          })
                        }
                      >
                        Reset
                      </button>
                    </div>
                    <input
                      id="prop-layout-flex"
                      type="text"
                      className="form-input"
                      placeholder="e.g. 1, 0 0 auto, auto"
                      value={selectedNode.props?.flex ?? ""}
                      onChange={(e) => {
                        const val = e.target.value.trim();
                        handleUpdateProps({
                          ...selectedNode.props,
                          flex:
                            val === ""
                              ? undefined
                              : isNaN(Number(val))
                                ? val
                                : Number(val),
                        });
                      }}
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
                      <label className="form-label" htmlFor="prop-layout-width">
                        Width
                      </label>
                      <input
                        id="prop-layout-width"
                        type="text"
                        className="form-input"
                        placeholder="e.g. 100%, 240px, auto"
                        value={selectedNode.props?.width ?? ""}
                        onChange={(e) =>
                          handleUpdateProps({
                            ...selectedNode.props,
                            width: e.target.value.trim() || undefined,
                          })
                        }
                      />
                    </div>
                    <div>
                      <label
                        className="form-label"
                        htmlFor="prop-layout-alignself"
                      >
                        Align Self
                      </label>
                      <select
                        id="prop-layout-alignself"
                        className="form-select"
                        value={selectedNode.props?.alignSelf || ""}
                        onChange={(e) =>
                          handleUpdateProps({
                            ...selectedNode.props,
                            alignSelf: e.target.value || undefined,
                          })
                        }
                      >
                        <option value="">Default (Auto)</option>
                        <option value="flex-start">Start</option>
                        <option value="center">Center</option>
                        <option value="flex-end">End</option>
                        <option value="stretch">Stretch</option>
                        <option value="baseline">Baseline</option>
                      </select>
                    </div>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "0.5rem",
                    }}
                  >
                    <div>
                      <label
                        className="form-label"
                        htmlFor="prop-layout-minwidth"
                      >
                        Min Width
                      </label>
                      <input
                        id="prop-layout-minwidth"
                        type="text"
                        className="form-input"
                        placeholder="e.g. 0, 200px"
                        value={selectedNode.props?.minWidth ?? ""}
                        onChange={(e) =>
                          handleUpdateProps({
                            ...selectedNode.props,
                            minWidth: e.target.value.trim() || undefined,
                          })
                        }
                      />
                    </div>
                    <div>
                      <label
                        className="form-label"
                        htmlFor="prop-layout-maxwidth"
                      >
                        Max Width
                      </label>
                      <input
                        id="prop-layout-maxwidth"
                        type="text"
                        className="form-input"
                        placeholder="e.g. 600px"
                        value={selectedNode.props?.maxWidth ?? ""}
                        onChange={(e) =>
                          handleUpdateProps({
                            ...selectedNode.props,
                            maxWidth: e.target.value.trim() || undefined,
                          })
                        }
                      />
                    </div>
                  </div>
                </div>
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
        currentPageId={pageDetail?.id}
        onApplyDefinition={(definition, name, missingFields) => {
          if (!pageDetail) return;
          // The page keeps its own id, route, version and who may open it
          const newDraft = { ...definition, id: pageDetail.id, route: pageDetail.route, version: draft.version, allowedRoles: draft.allowedRoles };
          pushDraftUpdate(newDraft);
          setSelectedNodeId(newDraft.root.id);
          setSaveStatus(missingFields.length ? `Applied "${name}". Not in your entity: ${missingFields.join(", ")}` : `Applied "${name}"`);
          setTimeout(() => setSaveStatus(null), missingFields.length ? 10000 : 3000);
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
              borderRadius: "var(--radius-surface)",
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
                <h3
                  style={{ fontSize: "var(--font-size-lg)", fontWeight: 600 }}
                >
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
              Choose which roles can open this page. With none selected, every
              signed-in role can. Builders, admins and owners always have access.
              Changes take effect when the page is published.
            </p>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem",
                marginBottom: "1.5rem",
              }}
            >
              {(["editor", "viewer"] as const).map(
                (r) => {
                  const currentRoles: PageRole[] = draft.allowedRoles || [];
                  const isChecked = currentRoles.includes(r);
                  return (
                    <label
                      key={r}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.75rem",
                        padding: "0.5rem 0.75rem",
                        borderRadius: "var(--radius-control)",
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
                          let newRoles: PageRole[];
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
