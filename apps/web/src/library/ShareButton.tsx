/** Share one of the workspace's own items (a symbol, or a page or export as a template) as a fixed release, or publish its next release */
import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Share2 } from "lucide-react";
import type { SharedItem, SharedKind } from "@config-platform/schema";
import { SHARED_KEY, sharedApi, sharedListKey } from "./shared-api";

/** Solutions are shared from the template gallery instead */
type ShareableKind = Exclude<SharedKind, "solution">;

const WORDS: Record<ShareableKind, { what: string; placeholder: string; uses: string }> = {
  symbol: { what: "symbol", placeholder: "e.g. A lamp that lights while running", uses: "Drawings using the shared symbol" },
  "page-template": { what: "page as a template", placeholder: "e.g. A list with add and edit forms", uses: "New pages made from the template" },
  "export-template": { what: "export as a template", placeholder: "e.g. A weekly summary sheet", uses: "New exports made from the template" },
};

interface Props {
  kind: ShareableKind;
  sourceId: string;
  /** Unsaved changes: what's shared is the saved version, so save first */
  dirty: boolean;
  onMessage: (tone: "error" | "success", text: string) => void;
  onShared?: (item: SharedItem) => void;
  className?: string;
}

export function ShareButton({ kind, sourceId, dirty, onMessage, onShared, className = "btn btn-secondary" }: Props) {
  const queryClient = useQueryClient();
  const words = WORDS[kind];
  const [open, setOpen] = useState(false);
  const { data = [] } = useQuery({ queryKey: sharedListKey(kind), queryFn: () => sharedApi.list(kind) });
  const shared = data.find((s) => s.own && s.sourceId === sourceId);
  const [description, setDescription] = useState("");

  const publish = useMutation({
    mutationFn: () => sharedApi.publish({ kind, sourceId, description: description.trim() || shared?.description || "" }),
    onSuccess: (item) => {
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: SHARED_KEY });
      onShared?.(item);
      onMessage("success", item.version === 1 ? "Shared with the workspace" : `Shared release ${item.version}`);
    },
    onError: (err: Error) => onMessage("error", err.message),
  });

  const label = shared ? `Share changes (v${shared.version} now)` : "Share";
  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        className={className}
        disabled={dirty || publish.isPending}
        title={dirty ? "Save first: what's shared is the saved version" : shared ? "Publish what you've saved as the next release" : `Share this ${words.what} with everyone in the workspace, as a fixed release`}
        onClick={() => {
          setDescription(shared?.description ?? "");
          setOpen((o) => !o);
        }}
      >
        <Share2 size="1em" /> {publish.isPending ? "Sharing…" : label}
      </button>
      {open && (
        <form
          aria-label={`Share this ${words.what}`}
          onSubmit={(e) => {
            e.preventDefault();
            publish.mutate();
          }}
          style={{ position: "absolute", right: 0, top: "calc(100% + var(--space-1))", zIndex: 20, width: "20rem", padding: "var(--space-3)", background: "var(--surface)", border: "var(--border-width-sm) solid var(--border)", borderRadius: "var(--radius-surface)", display: "flex", flexDirection: "column", gap: "var(--space-2)", boxShadow: "var(--shadow-lg)", textAlign: "left" }}
        >
          <p style={{ margin: 0, fontSize: "var(--font-size-sm)", color: "var(--text)" }}>
            {shared
              ? `${words.uses} will get what you've saved now, as release ${shared.version + 1}.`
              : "Everyone in the workspace can then use it. Later changes are shared only when you share again."}
          </p>
          <label className="form-label" htmlFor={`share-description-${kind}`} style={{ fontSize: "var(--font-size-xs)", margin: 0 }}>
            What it is (optional)
          </label>
          <input id={`share-description-${kind}`} className="form-input" value={description} maxLength={300} placeholder={words.placeholder} onChange={(e) => setDescription(e.target.value)} />
          <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }}>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={publish.isPending}>
              {shared ? "Share changes" : "Share"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
