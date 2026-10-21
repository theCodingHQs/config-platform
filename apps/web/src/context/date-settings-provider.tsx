import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { resolveDateDisplayPrefs } from "@config-platform/schema";
import { fetchMe, fetchWorkspaceDateSettings } from "../api/client";
import { DateDisplayProvider } from "./date-display-context";

export const WORKSPACE_DATE_SETTINGS_KEY = ["workspace-date-settings"] as const;
export const MY_DATE_PREFERENCES_KEY = ["my-date-preferences"] as const;

/** The device's own locale and time zone (used for "Auto" choices). */
export function deviceDateContext(): { locale?: string; timeZone?: string } {
  const resolved = new Intl.DateTimeFormat().resolvedOptions();
  return {
    locale: typeof navigator !== "undefined" ? navigator.language || resolved.locale : resolved.locale,
    timeZone: resolved.timeZone,
  };
}

/**
 * Resolves how dates are shown to the signed-in user: their own choices, else the workspace
 * defaults, else their device. Everything below reads it through useDateDisplayPrefs().
 */
export function DateSettingsProvider({ children }: { children: React.ReactNode }) {
  const { data: workspace } = useQuery({
    queryKey: WORKSPACE_DATE_SETTINGS_KEY,
    queryFn: fetchWorkspaceDateSettings,
    staleTime: 5 * 60 * 1000,
  });
  const { data: mine } = useQuery({
    queryKey: MY_DATE_PREFERENCES_KEY,
    queryFn: async () => (await fetchMe())?.datePreferences ?? {},
    staleTime: 5 * 60 * 1000,
  });

  const prefs = useMemo(
    () => resolveDateDisplayPrefs(workspace, mine, deviceDateContext()),
    [workspace, mine],
  );
  return <DateDisplayProvider value={prefs}>{children}</DateDisplayProvider>;
}
