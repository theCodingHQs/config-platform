import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { AlertCircle, Check, X } from "lucide-react";

type AppBarMessage = {
  type: "success" | "error";
  message: string;
};

type AppBarContextValue = {
  setContent: (content: React.ReactNode, actions?: React.ReactNode) => void;
  clearContent: () => void;
  showMessage: (message: AppBarMessage) => void;
  clearMessage: () => void;
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
  const [message, setMessage] = useState<AppBarMessage | null>(null);
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
  const showMessage = useCallback((nextMessage: AppBarMessage) => {
    setMessage(nextMessage);
  }, []);
  const clearMessage = useCallback(() => setMessage(null), []);

  const value = useMemo(
    () => ({ setContent, clearContent, showMessage, clearMessage }),
    [setContent, clearContent, showMessage, clearMessage],
  );
  const hasContent = content !== null && content !== undefined && content !== false;
  const hasActions = actions !== null && actions !== undefined && actions !== false;

  return (
    <AppBarContext.Provider value={value}>
      {children}
      {(hasContent || hasActions || message) && (
        <footer className="app-statusbar" data-testid="app-bottom-bar">
          {hasContent && (
            <div className="app-statusbar-content">{content}</div>
          )}
          {hasActions && (
            <div className="app-statusbar-actions">{actions}</div>
          )}
          {message && (
            <output
              className={`app-statusbar-message app-statusbar-message-${message.type}`}
              data-testid="app-status-notification"
              aria-live={message.type === "error" ? "assertive" : "polite"}
              aria-atomic="true"
            >
              <span className="app-statusbar-message-icon" aria-hidden="true">
                {message.type === "success" ? (
                  <Check size={13} />
                ) : (
                  <AlertCircle size={13} />
                )}
              </span>
              <span className="app-statusbar-message-text">{message.message}</span>
              <button
                type="button"
                className="app-statusbar-dismiss"
                onClick={clearMessage}
                aria-label="Dismiss notification"
              >
                <X size={13} />
              </button>
            </output>
          )}
        </footer>
      )}
    </AppBarContext.Provider>
  );
}

export function useOptionalAppBar() {
  return useContext(AppBarContext);
}
