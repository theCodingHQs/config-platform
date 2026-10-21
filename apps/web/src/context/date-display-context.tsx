import { createContext, useContext } from "react";
import type { DateDisplayPrefs } from "@config-platform/schema";

/**
 * How dates are shown to the current viewer (format, 12/24-hour, locale, time zone).
 * Empty = the browser's locale and time zone. Every component that shows or edits a date
 * reads it here, so user and workspace preferences apply everywhere at once.
 */
const DateDisplayContext = createContext<DateDisplayPrefs>({});

export const DateDisplayProvider = DateDisplayContext.Provider;

export function useDateDisplayPrefs(): DateDisplayPrefs {
  return useContext(DateDisplayContext);
}
