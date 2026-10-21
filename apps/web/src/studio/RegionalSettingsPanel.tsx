import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isValidTimeZone, type WorkspaceDateSettings } from "@config-platform/schema";
import { fetchWorkspaceDateSettings, updateWorkspaceDateSettings } from "../api/client";
import { useStatusNotify } from "../context/app-bar-context";
import { WORKSPACE_DATE_SETTINGS_KEY } from "../context/date-settings-provider";
import { DateSettingsFields, type DateSettingsValue } from "./DateSettingsFields";

/** Settings → Regional: the workspace's date & time defaults (admins and owners edit them). */
export function RegionalSettingsPanel({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient();
  const notify = useStatusNotify();
  const { data: saved, isLoading } = useQuery({
    queryKey: WORKSPACE_DATE_SETTINGS_KEY,
    queryFn: fetchWorkspaceDateSettings,
  });
  const [draft, setDraft] = useState<DateSettingsValue | null>(null);
  useEffect(() => {
    if (saved) setDraft(saved);
  }, [saved]);

  const save = useMutation({
    mutationFn: (settings: WorkspaceDateSettings) => updateWorkspaceDateSettings(settings),
    onSuccess: (next) => {
      queryClient.setQueryData(WORKSPACE_DATE_SETTINGS_KEY, next);
      notify("success", "Regional settings saved. Dates now follow them everywhere.");
    },
    onError: (err: Error) => notify("error", err.message || "Failed to save regional settings"),
  });

  if (isLoading || !draft) return <p style={{ color: "var(--text-muted)" }}>Loading regional settings…</p>;

  const changed = JSON.stringify(draft) !== JSON.stringify(saved);
  const valid = Boolean(draft.timeZone && isValidTimeZone(draft.timeZone));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", maxWidth: "56rem" }}>
      <div>
        <h3 style={{ margin: 0, fontSize: "var(--font-size-base)", fontWeight: 600 }}>Date & time</h3>
        <p style={{ margin: "var(--space-1) 0 0", fontSize: "var(--font-size-sm)", color: "var(--text-muted)" }}>
          Defaults for everyone in this workspace. People can override the format and time zone for
          themselves under <strong>Date & time preferences</strong> in the top bar. Stored dates never
          change, only how they are written.
        </p>
      </div>
      <DateSettingsFields mode="workspace" value={draft} onChange={setDraft} disabled={!canEdit} />
      {canEdit ? (
        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!changed || !valid || save.isPending}
            onClick={() => save.mutate(draft as WorkspaceDateSettings)}
          >
            {save.isPending ? "Saving…" : "Save regional settings"}
          </button>
          {changed && (
            <button type="button" className="btn btn-secondary" onClick={() => setDraft(saved ?? null)}>
              Discard changes
            </button>
          )}
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: "var(--font-size-xs)", color: "var(--text-muted)" }}>
          Only admins and owners can change workspace defaults.
        </p>
      )}
    </div>
  );
}
