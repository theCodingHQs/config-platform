import React from "react";
import { API_BASE_URL } from "../../../config";

const box: React.CSSProperties = {
  margin: 0,
  padding: "var(--space-2) var(--space-3)",
  background: "var(--surface-subtle)",
  borderRadius: "var(--radius-control)",
  fontFamily: "var(--font-mono)",
  fontSize: "var(--font-size-xs)",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
};

/** The app's address as this browser reaches it (what the agent connects to) */
export function appAddress(): string {
  return /^https?:\/\//i.test(API_BASE_URL) ? API_BASE_URL.replace(/\/api\/?$/, "") : window.location.origin;
}

/** The token, shown once, and how to run the agent with it */
export function AgentInstall({ token }: { token: string }) {
  const url = appAddress();
  return (
    <div role="note" style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", padding: "var(--space-3) var(--space-4)", border: "var(--border-width) solid var(--warning)", borderRadius: "var(--radius-surface)", background: "var(--warning-subtle)" }}>
      <div>
        <strong>Agent token</strong> <span style={{ fontSize: "var(--font-size-sm)" }}>(copy it now: it won't be shown again)</span>
        <pre style={{ ...box, marginTop: "var(--space-1)" }}>{token}</pre>
      </div>
      <div>
        <strong style={{ fontSize: "var(--font-size-sm)" }}>Run it with Docker</strong> <span style={{ fontSize: "var(--font-size-xs)", color: "var(--text-muted)" }}>on a computer in the factory network that can reach the machines</span>
        <pre style={{ ...box, marginTop: "var(--space-1)" }}>{`docker run -d --name configplatform-agent --restart unless-stopped \\
  -e CONFIG_PLATFORM_URL=${url} \\
  -e CONFIG_PLATFORM_AGENT_TOKEN=${token} \\
  configplatform/edge-agent`}</pre>
      </div>
      <div>
        <strong style={{ fontSize: "var(--font-size-sm)" }}>Or with Node.js 22+</strong>
        <pre style={{ ...box, marginTop: "var(--space-1)" }}>{`CONFIG_PLATFORM_URL=${url} CONFIG_PLATFORM_AGENT_TOKEN=${token} node dist/index.js`}</pre>
      </div>
      <p style={{ margin: 0, fontSize: "var(--font-size-xs)" }}>
        The agent only connects out to the app (HTTPS, port 443): no inbound ports or VPN. It shows as online here within a few seconds of starting.
      </p>
    </div>
  );
}
