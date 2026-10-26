/**
 * A text box for expressions that suggests what can come next as you type: live tags (with their
 * label, unit and value now), a symbol's inputs, functions. ↑/↓ choose, Enter or Tab take it,
 * Esc closes the list; Ctrl+Space opens it anywhere.
 */
import React, { useId, useRef, useState } from "react";
import { preview, suggest, type SuggestResult, type Suggestion } from "./suggest";
import { useSuggestionSources } from "./suggestions-context";

interface Props {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  placeholder?: string;
  "aria-label"?: string;
  style?: React.CSSProperties;
}

const KIND_MARK: Record<Suggestion["kind"], string> = { group: "▸", value: "•", function: "ƒ" };

export function ExpressionInput({ value, onChange, id, placeholder, style, ...aria }: Props) {
  const { entries, functions } = useSuggestionSources();
  const ref = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [result, setResult] = useState<SuggestResult | null>(null);
  const [active, setActive] = useState(0);

  /** `asked`: Ctrl+Space, which lists everything even between names */
  const refresh = (text: string, caret: number | null, asked = false) => {
    let r = caret === null ? null : suggest(text, caret, entries, functions);
    // On its own, the list only opens while a name is being typed (or the box is empty)
    if (r && !asked && r.start === caret && text.trim()) r = null;
    setResult(r);
    setActive(0);
  };

  const accept = (s: Suggestion) => {
    if (!result) return;
    const next = value.slice(0, result.start) + s.insert + value.slice(result.end);
    const caret = result.start + s.insert.length;
    onChange(next);
    // A group (live.area.) keeps the list open for its children
    refresh(next, s.kind === "group" ? caret : null);
    requestAnimationFrame(() => ref.current?.setSelectionRange(caret, caret));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === " " && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      return refresh(value, e.currentTarget.selectionStart, true);
    }
    if (!result) return;
    const n = result.items.length;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      accept(result.items[active]);
    } else if (e.key === "Escape") {
      // Closing the list shouldn't also leave the editor's selection
      e.stopPropagation();
      setResult(null);
    }
  };

  const open = Boolean(result?.items.length);
  return (
    <div style={{ position: "relative", ...style }}>
      <input
        ref={ref}
        id={id}
        className="form-input"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        aria-label={aria["aria-label"]}
        placeholder={placeholder}
        value={value}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => {
          onChange(e.target.value);
          refresh(e.target.value, e.target.selectionStart);
        }}
        onKeyDown={onKeyDown}
        onFocus={(e) => refresh(e.target.value, e.target.selectionStart)}
        onClick={(e) => refresh(e.currentTarget.value, e.currentTarget.selectionStart)}
        onBlur={() => setResult(null)}
        style={{ width: "100%", fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" }}
      />
      {open && result && (
        <ul
          id={listId}
          role="listbox"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 30,
            margin: "var(--space-1) 0 0",
            padding: "var(--space-1)",
            listStyle: "none",
            maxHeight: "14rem",
            overflowY: "auto",
            background: "var(--surface)",
            border: "var(--border-width-sm) solid var(--border)",
            borderRadius: "var(--radius-control)",
            boxShadow: "var(--shadow-md)",
          }}
        >
          {result.items.map((s, i) => {
            const now = preview(s.value);
            return (
              <li
                key={s.insert}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                // Keep focus in the input so the caret stays where it was
                onMouseDown={(e) => {
                  e.preventDefault();
                  accept(s);
                }}
                onMouseEnter={() => setActive(i)}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: "var(--space-2)",
                  padding: "var(--space-1) var(--space-2)",
                  borderRadius: "var(--radius-control)",
                  cursor: "pointer",
                  fontSize: "var(--font-size-xs)",
                  background: i === active ? "var(--accent-subtle)" : undefined,
                }}
              >
                <span aria-hidden="true" style={{ color: "var(--text-muted)", width: "0.8em", flex: "none" }}>
                  {KIND_MARK[s.kind]}
                </span>
                <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, whiteSpace: "nowrap" }}>{s.label}</span>
                <span style={{ flex: 1, minWidth: 0, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.detail}</span>
                {now !== undefined && <span style={{ fontFamily: "var(--font-mono)", color: "var(--accent)", whiteSpace: "nowrap" }}>{now}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
