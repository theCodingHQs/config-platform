import React, { useEffect, useId, useState } from "react";
import { RotateCcw } from "lucide-react";
import { IconPicker } from "../components/icon-picker";
import type { PageNavFolder, PageSummary } from "../api/client";

/** Lowercase, hyphen-separated URL segment. */
export const slugify = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/** Route prefix for a group: its ancestors' slugs joined from the root. */
export function folderPath(folders: PageNavFolder[], folderId: string | null): string[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const path: string[] = [];
  let current = folderId ? byId.get(folderId) : undefined;
  while (current) {
    path.unshift(current.slug);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

// ─── Shared building blocks ──────────────────────────────────────────────────

function Dialog({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      style={{ position: "fixed", inset: 0, backgroundColor: "var(--overlay-bg)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: "var(--spacing-4)" }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ backgroundColor: "var(--surface)", borderRadius: "var(--radius-surface)", width: "520px", maxWidth: "100%", maxHeight: "calc(100vh - 2 * var(--spacing-4))", display: "flex", flexDirection: "column", border: "var(--border-width) solid var(--border)", boxShadow: "var(--shadow-xl)" }}
      >
        <h3 style={{ margin: 0, padding: "var(--space-5) var(--space-6) 0", fontSize: "var(--font-size-lg)", fontWeight: 600 }}>{title}</h3>
        <div style={{ padding: "var(--space-4) var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-4)", overflowY: "auto" }}>
          {children}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)", padding: "var(--space-4) var(--space-6)", borderTop: "var(--border-width-sm) solid var(--border)" }}>
          {footer}
        </div>
      </div>
    </div>
  );
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <label className="form-label" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <p style={{ margin: "var(--spacing-1) 0 0", fontSize: "var(--font-size-xs)", color: "var(--text-muted)" }}>{hint}</p>}
    </div>
  );
}

/** One on/off setting: off keeps the default, on overrides it. */
function SwitchField({
  label,
  title,
  description,
  checked,
  onChange,
}: {
  label: string;
  title: string;
  description: React.ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const inputId = useId();
  return (
    <div>
      <span className="form-label">{label}</span>
      <label
        htmlFor={inputId}
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "var(--spacing-2)",
          padding: "var(--spacing-2) var(--spacing-3)",
          borderRadius: "var(--radius-control)",
          border: "var(--border-width-sm) solid var(--border)",
          cursor: "pointer",
        }}
      >
        <input
          id={inputId}
          type="checkbox"
          role="switch"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          style={{ marginTop: "0.2em", flexShrink: 0 }}
        />
        <span>
          <span style={{ display: "block", fontWeight: 600, fontSize: "var(--font-size-sm)" }}>{title}</span>
          <span style={{ display: "block", fontSize: "var(--font-size-xs)", color: "var(--text-muted)" }}>{description}</span>
        </span>
      </label>
    </div>
  );
}

/** Icon override: empty = the automatic icon; Reset returns to it. */
function IconOverrideField({
  icon,
  onChange,
  automaticDescription,
}: {
  icon: string | null;
  onChange: (icon: string | null) => void;
  automaticDescription: string;
}) {
  const pickerId = useId();
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--spacing-2)" }}>
        <label className="form-label" htmlFor={pickerId}>Navigation Icon</label>
        {icon !== null && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => onChange(null)}
            style={{ marginBottom: "var(--spacing-1)" }}
          >
            <RotateCcw size="1em" /> Reset
          </button>
        )}
      </div>
      <IconPicker
        id={pickerId}
        label=""
        clearable
        value={icon ?? undefined}
        onChange={(next) => onChange(next ?? null)}
        placeholder="Automatic"
        clearLabel="Automatic icon"
      />
      <p style={{ margin: "var(--spacing-1) 0 0", fontSize: "var(--font-size-xs)", color: "var(--text-muted)" }}>
        {icon === null ? `Automatic: ${automaticDescription}. Pick an icon to override it.` : "Overrides the automatic icon."}
      </p>
    </div>
  );
}

// ─── Page settings (create + edit) ───────────────────────────────────────────

export interface PageSettingsValues {
  name: string;
  folderId: string | null;
  slug: string;
  width: "theme" | "full";
  icon: string | null;
}

export function PageSettingsDialog({
  page,
  folders,
  saving,
  onSubmit,
  onClose,
}: {
  /** Absent = create a new page. */
  page?: PageSummary;
  folders: PageNavFolder[];
  saving: boolean;
  onSubmit: (values: PageSettingsValues) => void;
  onClose: () => void;
}) {
  const isEdit = !!page;
  const [name, setName] = useState(page?.name ?? "");
  const [folderId, setFolderId] = useState<string | null>(page?.folderId ?? null);
  const [slug, setSlug] = useState(page ? page.route.split("/").filter(Boolean).pop() ?? "" : "");
  // New pages derive the slug from the title until the slug is edited by hand
  const [slugTouched, setSlugTouched] = useState(isEdit);
  const [width, setWidth] = useState<"theme" | "full">(page?.width === "full" ? "full" : "theme");
  const [icon, setIcon] = useState<string | null>(page?.icon ?? null);

  const route = `/${[...folderPath(folders, folderId), slug].filter(Boolean).join("/")}`;
  const slugValid = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
  const canSubmit = name.trim().length > 0 && slugValid && !saving;

  return (
    <Dialog
      title={isEdit ? "Page Settings" : "Create Page"}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canSubmit}
            onClick={() => onSubmit({ name: name.trim(), folderId, slug, width, icon })}
          >
            {isEdit ? "Save Changes" : "Create Page"}
          </button>
        </>
      }
    >
      <Field label="Page Title" htmlFor="page-settings-name">
        <input
          id="page-settings-name"
          type="text"
          className="form-input"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!slugTouched) setSlug(slugify(e.target.value));
          }}
          placeholder="e.g. Inventory Dashboard"
          autoFocus
        />
      </Field>
      <Field label="Navigation Group" htmlFor="page-settings-group">
        <select id="page-settings-group" className="form-input" value={folderId ?? ""} onChange={(e) => setFolderId(e.target.value || null)}>
          <option value="">Root level</option>
          {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
        </select>
      </Field>
      <Field
        label="URL Slug"
        htmlFor="page-settings-slug"
        hint={slugValid || !slug ? <>Route: <code>{route}</code></> : <span style={{ color: "var(--danger)" }}>Use lowercase letters, numbers and single hyphens.</span>}
      >
        <input
          id="page-settings-slug"
          type="text"
          className={`form-input${slug && !slugValid ? " is-invalid" : ""}`}
          value={slug}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(e.target.value.toLowerCase());
          }}
          placeholder="inventory"
          style={{ fontFamily: "var(--font-mono)" }}
        />
      </Field>
      <SwitchField
        label="Page Width"
        title="Always full width"
        description={width === "full"
          ? "Uses the whole window, e.g. wide tables and dashboards."
          : "Off: follows the content width in Theme → Layout."}
        checked={width === "full"}
        onChange={(full) => setWidth(full ? "full" : "theme")}
      />
      <IconOverrideField
        icon={icon}
        onChange={setIcon}
        automaticDescription="from the page's data entity, or its name"
      />
      {isEdit && page?.hasPublished && (
        <p style={{ margin: 0, fontSize: "var(--font-size-xs)", color: "var(--text-muted)" }}>
          These settings apply to the live page immediately; no republish needed.
        </p>
      )}
    </Dialog>
  );
}

// ─── Group (create + edit) ───────────────────────────────────────────────────

export interface GroupValues {
  name: string;
  parentId: string | null;
  icon: string | null;
}

export function GroupDialog({
  folder,
  defaultParentId = null,
  folders,
  saving,
  onSubmit,
  onClose,
}: {
  /** Absent = create a new group. */
  folder?: PageNavFolder;
  defaultParentId?: string | null;
  /** Groups this one may be placed under (already excludes itself and its descendants when editing). */
  folders: PageNavFolder[];
  saving: boolean;
  onSubmit: (values: GroupValues) => void;
  onClose: () => void;
}) {
  const isEdit = !!folder;
  const [name, setName] = useState(folder?.name ?? "");
  const [parentId, setParentId] = useState<string | null>(folder ? folder.parentId : defaultParentId);
  const [icon, setIcon] = useState<string | null>(folder?.icon ?? null);

  return (
    <Dialog
      title={isEdit ? "Group Settings" : "Create Navigation Group"}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!name.trim() || saving}
            onClick={() => onSubmit({ name: name.trim(), parentId, icon })}
          >
            {isEdit ? "Save Changes" : "Create Group"}
          </button>
        </>
      }
    >
      <Field
        label="Group Name"
        htmlFor="group-settings-name"
        hint={isEdit ? "Renaming changes the URL of every page in this group." : undefined}
      >
        <input id="group-settings-name" className="form-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sales" autoFocus />
      </Field>
      <Field label="Parent Group" htmlFor="group-settings-parent">
        <select id="group-settings-parent" className="form-input" value={parentId ?? ""} onChange={(e) => setParentId(e.target.value || null)}>
          <option value="">Root level</option>
          {folders.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
        </select>
      </Field>
      <IconOverrideField icon={icon} onChange={setIcon} automaticDescription="the standard folder icon" />
    </Dialog>
  );
}
