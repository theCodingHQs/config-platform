import React, { useEffect, useRef, useState } from "react";
import { Clock, LogOut, Monitor, Moon, MoreVertical, Sun } from "lucide-react";
import { useTheme } from "../context/theme-context";
import { DatePreferencesDialog } from "./date-preferences-dialog";

/**
 * Phones: the top bar can't fit date preferences, the theme switch and log out next to the
 * workspace, so they live in this "⋯" menu (shown only on narrow screens, see index.css).
 */
export function HeaderMobileMenu({ email, role, onLogout }: { email: string; role: string; onLogout: () => void }) {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [datePrefsOpen, setDatePrefsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const themes = [
    { value: "system", label: "System", icon: <Monitor size="1em" /> },
    { value: "light", label: "Light", icon: <Sun size="1em" /> },
    { value: "dark", label: "Dark", icon: <Moon size="1em" /> },
  ] as const;

  return (
    <div ref={rootRef} className="header-mobile-menu" style={{ position: "relative" }}>
      <button
        type="button"
        className="btn btn-ghost btn-sm btn-icon"
        aria-label="Menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreVertical size="1.2em" />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Account"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + var(--space-1))",
            zIndex: 40,
            width: "min(16rem, calc(100vw - 2 * var(--space-3)))",
            background: "var(--surface)",
            color: "var(--text)",
            border: "var(--border-width-sm) solid var(--border)",
            borderRadius: "var(--radius-surface)",
            boxShadow: "var(--shadow-lg)",
            padding: "var(--space-2)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-1)",
          }}
        >
          <div style={{ padding: "var(--space-1) var(--space-2)", fontSize: "var(--font-size-xs)", color: "var(--text-muted)", overflowWrap: "anywhere" }}>
            {email} · {role}
          </div>
          <button
            type="button"
            role="menuitem"
            className="btn btn-ghost"
            style={{ justifyContent: "flex-start" }}
            onClick={() => {
              setOpen(false);
              setDatePrefsOpen(true);
            }}
          >
            <Clock size="1.1em" /> Date & time preferences
          </button>
          <div role="group" aria-label="Theme" style={{ display: "flex", gap: "var(--space-1)", padding: "var(--space-1) 0" }}>
            {themes.map((t) => (
              <button
                key={t.value}
                type="button"
                role="menuitemradio"
                aria-checked={theme === t.value}
                className={`btn btn-sm ${theme === t.value ? "btn-primary" : "btn-secondary"}`}
                style={{ flex: 1 }}
                onClick={() => setTheme(t.value)}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>
          <button type="button" role="menuitem" className="btn btn-ghost" style={{ justifyContent: "flex-start" }} onClick={() => {
              setOpen(false);
              onLogout();
            }}>
            <LogOut size="1.1em" /> Log out
          </button>
        </div>
      )}
      {datePrefsOpen && <DatePreferencesDialog onClose={() => setDatePrefsOpen(false)} />}
    </div>
  );
}
