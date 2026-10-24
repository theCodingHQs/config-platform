import React from "react";
import { useQuery } from "@tanstack/react-query";
import { liveAgentsApi } from "../../../live/live-api";
import { Field } from "../Field";
import { LIVE_AGENTS_KEY } from "./AgentsPanel";

/** Where a connection runs: the app server, or an edge agent inside the factory network */
export function RunsOnField({ value, onChange, disabled }: { value: string | null; onChange: (agentId: string | null) => void; disabled?: boolean }) {
  const { data: agents = [] } = useQuery({ queryKey: LIVE_AGENTS_KEY, queryFn: liveAgentsApi.list });
  if (agents.length === 0 && !value) return null;
  const chosen = agents.find((a) => a.id === value);
  return (
    <Field
      label="Runs on"
      htmlFor="lc-runs-on"
      hint={chosen ? (chosen.online ? "The agent connects to the machine and sends what it reads." : "This agent is offline: the connection waits until it's back.") : "The app server connects to the machine itself."}
    >
      <select id="lc-runs-on" className="form-select" value={value ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">This app server</option>
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            Edge agent: {a.name} ({a.online ? "online" : "offline"})
          </option>
        ))}
      </select>
    </Field>
  );
}
