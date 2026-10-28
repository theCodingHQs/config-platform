/**
 * At the right of the status bar, for whoever is signed in: is the device online, does the app's
 * server answer, and are the live connections up. Each is an icon in its state's colour (live: a
 * dot split by how many connections are up); clicking one shows what's behind it.
 */
import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw, Server, ServerCrash, Wifi, WifiOff } from "lucide-react";
import { useOptionalAuth } from "../context/auth-context";
import { useOnline } from "./use-online";
import { useServerHealth, type ServerHealth } from "./use-server-health";
import { useLiveHealth, type LiveHealth } from "./use-live-health";

type Tone = "ok" | "warn" | "bad" | "idle";
type Panel = "internet" | "server" | "live";

const time = (at: number | null) => (at ? new Date(at).toLocaleTimeString() : "—");

function serverLook(h: ServerHealth): { tone: Tone; label: string } {
  if (h.state === "ok") return { tone: "ok", label: `Server: answering (${h.latencyMs} ms)` };
  if (h.state === "slow") return { tone: "warn", label: `Server: slow (${h.latencyMs} ms)` };
  if (h.state === "down") return { tone: "bad", label: "Server: not answering" };
  return { tone: "idle", label: "Server: checking" };
}

function liveLabel(h: LiveHealth): string {
  if (h.socket === "closed") return "Live data: link lost, reconnecting";
  if (h.socket !== "open") return "Live data: linking";
  return `Live connections: ${h.counts.connected} of ${h.total} connected`;
}

/**
 * The live dot: solid green when every connection is up; otherwise split like a pie into
 * connected (green), connecting (amber) and down (red); grey while linking, red when the link is lost.
 */
function liveDotFill(h: LiveHealth): string {
  if (h.socket === "closed") return "var(--danger)";
  if (h.socket !== "open" || h.total === 0) return "var(--border)";
  const up = (h.counts.connected / h.total) * 360;
  const waiting = up + (h.counts.connecting / h.total) * 360;
  if (up === 360) return "var(--success)";
  return `conic-gradient(var(--success) 0deg ${up}deg, var(--warning) ${up}deg ${waiting}deg, var(--danger) ${waiting}deg 360deg)`;
}

const STATE_WORDS = { connecting: "Connecting…", disconnected: "Reconnecting", error: "Not connected", disabled: "Off", connected: "Connected" } as const;

function Indicator({ label, open, onClick, children }: { label: string; open: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className="app-status-indicator" aria-expanded={open} aria-label={label} title={label} onClick={onClick}>
      {children}
    </button>
  );
}

function Details({ which, online, server, live, canManageLive }: { which: Panel; online: boolean; server: ServerHealth; live: LiveHealth; canManageLive: boolean }) {
  if (which === "internet") {
    return (
      <p>
        {online
          ? "This device is connected to a network."
          : "This device has no network connection. Changes can't be saved, and live values stop until it's back."}
      </p>
    );
  }
  if (which === "server") {
    return (
      <>
        <p>
          {server.state === "down"
            ? `The app's server isn't answering. It last answered at ${time(server.lastOkAt)}.`
            : server.state === "checking"
              ? "Checking the app's server…"
              : `The app's server answered in ${server.latencyMs} ms${server.state === "slow" ? ", which is slow" : ""}.`}
        </p>
        <p className="app-status-panel-muted">Checked at {time(server.checkedAt)}, and every 20 seconds while this tab is open.</p>
        <button type="button" className="btn btn-secondary btn-sm" onClick={server.recheck}>
          <RefreshCw size="1em" /> Check now
        </button>
      </>
    );
  }
  return (
    <>
      <p>
        {live.socket === "open"
          ? live.total === 0
            ? "Linked for live data. There are no live connections you can see."
            : `${live.counts.connected} of ${live.total} live connections are connected.`
          : live.socket === "closed"
            ? "The live data link to the server dropped; it reconnects on its own. Live values show their last reading until then."
            : "Linking for live data…"}
      </p>
      {live.socket === "open" && live.problems.length > 0 && (
        <ul className="app-status-panel-list">
          {live.problems.map((p) => (
            <li key={p.id}>
              <strong>{p.name}</strong>: {STATE_WORDS[p.state]}
              {p.error && <span className="app-status-panel-muted"> · {p.error}</span>}
            </li>
          ))}
        </ul>
      )}
      {canManageLive && (
        <Link to="/studio/live" className="app-status-panel-link">
          Open Studio → Live
        </Link>
      )}
    </>
  );
}

export function StatusIndicators() {
  const user = useOptionalAuth();
  const signedIn = Boolean(user);
  const online = useOnline();
  const server = useServerHealth(signedIn, online);
  const live = useLiveHealth(signedIn);
  const [open, setOpen] = useState<Panel | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Click elsewhere or Escape closes the details
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!signedIn) return null;
  const toggle = (which: Panel) => setOpen((cur) => (cur === which ? null : which));
  const serverShown = serverLook(server);
  const ServerIcon = server.state === "down" ? ServerCrash : Server;
  // A workspace without live connections needn't see the indicator, unless the link itself is down
  const showLive = live.total > 0 || live.socket === "closed";
  const canManageLive = ["builder", "admin", "owner"].includes(user?.role ?? "");

  return (
    <div ref={ref} className="app-statusbar-indicators" role="group" aria-label="Connection status">
      <Indicator label={online ? "Internet: online" : "Internet: offline"} open={open === "internet"} onClick={() => toggle("internet")}>
        {online ? <Wifi className="app-status-icon-ok" size="1.15em" aria-hidden="true" /> : <WifiOff className="app-status-icon-bad" size="1.15em" aria-hidden="true" />}
      </Indicator>
      <Indicator label={serverShown.label} open={open === "server"} onClick={() => toggle("server")}>
        <ServerIcon className={`app-status-icon-${serverShown.tone}`} size="1.15em" aria-hidden="true" />
      </Indicator>
      {showLive && (
        <Indicator label={liveLabel(live)} open={open === "live"} onClick={() => toggle("live")}>
          <span className="app-status-dot" style={{ background: liveDotFill(live) }} aria-hidden="true" />
        </Indicator>
      )}
      {open && (
        <div className="app-status-panel" role="dialog" aria-label={{ internet: "Internet", server: "Server", live: "Live connections" }[open]}>
          <Details which={open} online={online} server={server} live={live} canManageLive={canManageLive} />
        </div>
      )}
    </div>
  );
}
