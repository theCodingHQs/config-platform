import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";

export type AppBarMessageType = "success" | "error" | "info";

type AppBarMessage = {
  type: AppBarMessageType;
  message: string;
};

/** A shown message; `id` changes for every new message so its entrance plays again. */
type ShownMessage = AppBarMessage & { id: number };

/** How long a status message stays before clearing itself (errors stay longer). */
export const STATUS_MESSAGE_DURATION_MS: Record<AppBarMessageType, number> = {
  success: 4000,
  info: 4000,
  error: 8000,
};

type AppBarContextValue = {
  setContent: (content: React.ReactNode, actions?: React.ReactNode) => void;
  clearContent: () => void;
  /** Shows a message until cleared (the caller manages its lifetime). */
  showMessage: (message: AppBarMessage) => void;
  clearMessage: () => void;
  /**
   * Shows action feedback ("Theme saved", "Delete failed: …") in the status bar and clears it
   * after a while (`durationMs: 0` keeps it until dismissed). Use this instead of banners
   * above the content, which push the page down when they appear.
   */
  notify: (type: AppBarMessageType, message: string, options?: { durationMs?: number }) => void;
};

const AppBarContext = createContext<AppBarContextValue | null>(null);

export function AppBarProvider({
  children,
  routeKey,
}: {
  children: React.ReactNode;
  routeKey?: string;
}) {
  const currentRoute = routeKey ?? "";
  const [content, setContentState] = useState<React.ReactNode>(null);
  const [actions, setActions] = useState<React.ReactNode>(null);
  const [message, setMessage] = useState<ShownMessage | null>(null);
  const nextIdRef = useRef(0);
  const show = useCallback((next: AppBarMessage) => {
    nextIdRef.current += 1;
    setMessage({ ...next, id: nextIdRef.current });
  }, []);
  const [previousRoute, setPreviousRoute] = useState(currentRoute);

  if (previousRoute !== currentRoute) {
    setPreviousRoute(currentRoute);
    setContentState(null);
    setActions(null);
    setMessage(null);
  }

  const setContent = useCallback(
    (nextContent: React.ReactNode, nextActions?: React.ReactNode) => {
      setContentState(nextContent);
      setActions(nextActions ?? null);
    },
    [],
  );
  const clearContent = useCallback(() => {
    setContentState(null);
    setActions(null);
  }, []);

  const timerRef = useRef<number | null>(null);
  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);
  useEffect(() => stopTimer, [stopTimer]);

  const showMessage = useCallback((nextMessage: AppBarMessage) => {
    stopTimer();
    show(nextMessage);
  }, [stopTimer, show]);
  const clearMessage = useCallback(() => {
    stopTimer();
    setMessage(null);
  }, [stopTimer]);
  const notify = useCallback<AppBarContextValue["notify"]>((type, text, options) => {
    stopTimer();
    show({ type, message: text });
    const duration = options?.durationMs ?? STATUS_MESSAGE_DURATION_MS[type];
    if (duration > 0) {
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        setMessage(null);
      }, duration);
    }
  }, [stopTimer, show]);

  const value = useMemo(
    () => ({ setContent, clearContent, showMessage, clearMessage, notify }),
    [setContent, clearContent, showMessage, clearMessage, notify],
  );
  const hasContent = content !== null && content !== undefined && content !== false;
  const hasActions = actions !== null && actions !== undefined && actions !== false;

  return (
    <AppBarContext.Provider value={value}>
      {children}
      {/* Always present at a fixed height: a message appearing never moves the page */}
      <footer className="app-statusbar" data-testid="app-bottom-bar">
        {hasContent && (
          <div className="app-statusbar-content">{content}</div>
        )}
        {hasActions && (
          <div className="app-statusbar-actions">{actions}</div>
        )}
        {message && (
          <StatusMessage key={message.id} message={message} onDismiss={clearMessage} />
        )}
      </footer>
    </AppBarContext.Provider>
  );
}

const MESSAGE_ICONS = {
  success: CircleCheck,
  error: CircleAlert,
  info: Info,
} as const;

/**
 * A status message filling the bar's height in its type's colour. It opens from zero to its
 * measured width (CSS can't transition to `width: auto`); reduced motion skips the animation.
 */
function StatusMessage({ message, onDismiss }: { message: ShownMessage; onDismiss: () => void }) {
  const innerRef = useRef<HTMLSpanElement | null>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;
    // Start at 0, then open to the content width on the next frame so the change animates
    const frame = window.requestAnimationFrame(() => setWidth(inner.scrollWidth));
    return () => window.cancelAnimationFrame(frame);
  }, [message.message]);

  const Icon = MESSAGE_ICONS[message.type];
  return (
    <output
      className={`app-statusbar-message app-statusbar-message-${message.type}`}
      data-testid="app-status-notification"
      aria-live={message.type === "error" ? "assertive" : "polite"}
      aria-atomic="true"
      style={{ width }}
    >
      <span ref={innerRef} className="app-statusbar-message-inner">
        <Icon className="app-statusbar-message-icon" size="1.15em" aria-hidden="true" />
        <span className="app-statusbar-message-text" title={message.message}>{message.message}</span>
        <button
          type="button"
          className="app-statusbar-dismiss"
          onClick={onDismiss}
          aria-label="Dismiss notification"
        >
          <X size="1.1em" />
        </button>
      </span>
    </output>
  );
}

export function useOptionalAppBar() {
  return useContext(AppBarContext);
}

/**
 * `notify` for components that may render outside the app shell (tests, auth pages):
 * there it does nothing, so callers don't need to check.
 */
export function useStatusNotify(): AppBarContextValue["notify"] {
  const appBar = useContext(AppBarContext);
  return appBar?.notify ?? noopNotify;
}

const noopNotify: AppBarContextValue["notify"] = () => {};
