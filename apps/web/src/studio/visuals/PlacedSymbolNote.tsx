/** Under a placed symbol in the inspector: where the symbol comes from, and how to change it */
import React from "react";
import { Link } from "react-router-dom";
import { CopyPlus, ExternalLink } from "lucide-react";
import { isSharedRef } from "@config-platform/schema";
import { isBuiltinRef } from "@config-platform/schema/visual-library";
import { useCopySymbol } from "./use-copy-symbol";

const note = { margin: 0, fontSize: "var(--font-size-xs)", color: "var(--text-muted)" } as const;
const inline = { display: "inline-flex", alignItems: "center", gap: "var(--space-1)" } as const;

/** `onUseCopy` points this placed copy at the new symbol */
export function PlacedSymbolNote({ symbolId, onUseCopy }: { symbolId: string; onUseCopy: (id: string) => void }) {
  const copy = useCopySymbol((saved) => onUseCopy(saved.id));

  const fixed = isBuiltinRef(symbolId) ? "built-in" : isSharedRef(symbolId) ? "shared" : null;
  if (!fixed) {
    return (
      <p style={note}>
        A copy of a symbol: set or bind its inputs below.{" "}
        <Link to={`/studio/visuals/${symbolId}`} target="_blank" rel="noreferrer" style={inline}>
          Edit the symbol <ExternalLink size="1em" />
        </Link>
      </p>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
      <p style={note}>
        A {fixed} symbol: set or bind its inputs below. {fixed === "built-in" ? "Built-in symbols" : "Shared symbols"} can't be changed here; to change this one, make your own copy and this shape will use it.{" "}
        <Link to={`/studio/visuals/${symbolId}`} target="_blank" rel="noreferrer" style={inline}>
          About it <ExternalLink size="1em" />
        </Link>
      </p>
      <button type="button" className="btn btn-secondary" style={{ alignSelf: "flex-start" }} disabled={copy.isPending} onClick={() => copy.mutate(symbolId)}>
        <CopyPlus size="1em" /> {copy.isPending ? "Copying…" : "Make my own copy"}
      </button>
      {copy.error && <p style={{ ...note, color: "var(--danger)" }}>{(copy.error as Error).message}</p>}
    </div>
  );
}
