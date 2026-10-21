import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock } from "lucide-react";
import type { UserDatePreferences } from "@config-platform/schema";
import { fetchMe, fetchWorkspaceDateSettings, updateMyDatePreferences } from "../api/client";
import { useStatusNotify } from "../context/app-bar-context";
import { MY_DATE_PREFERENCES_KEY, WORKSPACE_DATE_SETTINGS_KEY } from "../context/date-settings-provider";
import { DateSettingsFields, type DateSettingsValue } from "../studio/DateSettingsFields";

/** Top-bar button: the signed-in user's own date & time display choices (any role). */
export function DatePreferencesButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="btn btn-ghost btn-sm btn-icon"
        onClick={() => setOpen(true)}
        title="Date & time preferences"
        aria-label="Date & time preferences"
      >
        <Clock size="1.15em" />
      </button>
      {open && <DatePreferencesDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function DatePreferencesDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const notify = useStatusNotify();
  const { data: workspace } = useQuery({ queryKey: WORKSPACE_DATE_SETTINGS_KEY, queryFn: fetchWorkspaceDateSettings });
  const { data: saved } = useQuery({
    queryKey: MY_DATE_PREFERENCES_KEY,
    queryFn: async () => (await fetchMe())?.datePreferences ?? {},
  });
  const [draft, setDraft] = useState<DateSettingsValue>({});
  useEffect(() => {
    if (saved) setDraft(saved);
  }, [saved]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = useMutation({
    // Only the choices the user made are stored; empty ones follow the workspace
    mutationFn: () =>
      updateMyDatePreferences(
        Object.fromEntries(Object.entries(draft).filter(([, v]) => v !== undefined && v !== "")) as UserDatePreferences,
      ),
    onSuccess: (next) => {
      queryClient.setQueryData(MY_DATE_PREFERENCES_KEY, next);
      notify("success", "Your date & time preferences are saved.");
      onClose();
    },
    onError: (err: Error) => notify("error", err.message || "Failed to save your preferences"),
  });

  return (
    <div
      style={{ position: "fixed", inset: 0, backgroundColor: "var(--overlay-bg)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "var(--space-4)" }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Date & time preferences"
        style={{ backgroundColor: "var(--surface)", color: "var(--text)", borderRadius: "var(--radius-surface)", border: "var(--border-width) solid var(--border)", boxShadow: "var(--shadow-xl)", width: "min(44rem, 100%)", maxHeight: "calc(100vh - 2 * var(--space-4))", overflowY: "auto", display: "flex", flexDirection: "column" }}
      >
        <div style={{ padding: "var(--space-5) var(--space-6) 0" }}>
          <h3 style={{ margin: 0, fontSize: "var(--font-size-lg)", fontWeight: 600 }}>Date & time preferences</h3>
          <p style={{ margin: "var(--space-1) 0 0", fontSize: "var(--font-size-sm)", color: "var(--text-muted)" }}>
            How dates and times are shown to you. Leave a setting on the workspace default to follow it.
          </p>
        </div>
        <div style={{ padding: "var(--space-4) var(--space-6)" }}>
          <DateSettingsFields mode="personal" value={draft} onChange={setDraft} workspaceDefaults={workspace} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-2)", padding: "var(--space-4) var(--space-6)", borderTop: "var(--border-width-sm) solid var(--border)" }}>
          <button type="button" className="btn btn-ghost" onClick={() => setDraft({})} disabled={Object.keys(draft).every((k) => (draft as any)[k] === undefined)}>
            Use workspace defaults
          </button>
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
