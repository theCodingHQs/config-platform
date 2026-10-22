import React, { useState } from "react";
import { Send } from "lucide-react";
import { useAuth } from "../context/auth-context";

/**
 * "Send test to [address] [Send test email]": defaults to the signed-in person, but any address can
 * be typed (e.g. while an email service is in testing mode and only delivers to certain addresses).
 */
export function TestEmailControl({ disabled, pending, onSend }: { disabled?: boolean; pending: boolean; onSend: (to: string) => void }) {
  const { user } = useAuth();
  const [to, setTo] = useState(user?.email ?? "");
  return (
    <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", alignItems: "center", flex: "1 1 22rem" }}>
      <input
        type="email"
        className="form-input"
        style={{ flex: "1 1 14rem", width: "auto" }}
        value={to}
        aria-label="Send the test email to"
        placeholder="Send the test to…"
        onChange={(e) => setTo(e.target.value)}
      />
      <button
        type="button"
        className="btn btn-secondary"
        disabled={disabled || pending || !to.trim()}
        onClick={() => onSend(to.trim())}
        title={disabled ? "Save first" : "Sends a test message to this address"}
      >
        <Send size="1em" /> {pending ? "Sending…" : "Send test email"}
      </button>
    </div>
  );
}
