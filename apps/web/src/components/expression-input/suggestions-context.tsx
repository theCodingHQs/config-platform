/**
 * What expression inputs below this point can suggest: names (live tags, a symbol's inputs…) and
 * functions. Set once where the data is known, so every input picks it up without passing props.
 */
import React, { createContext, useContext } from "react";
import type { FunctionDoc, SuggestEntry } from "./suggest";

export interface SuggestionSources {
  entries: readonly SuggestEntry[];
  functions: readonly FunctionDoc[];
}

const SuggestionsContext = createContext<SuggestionSources>({ entries: [], functions: [] });

export const SuggestionsProvider = ({ value, children }: { value: SuggestionSources; children: React.ReactNode }) => (
  <SuggestionsContext.Provider value={value}>{children}</SuggestionsContext.Provider>
);

export const useSuggestionSources = () => useContext(SuggestionsContext);

/** The functions every expression can use (the shared expression language) */
export const COMMON_FUNCTIONS: readonly FunctionDoc[] = [
  { name: "concat", signature: "concat(a, b, …)", detail: "Joins values into text" },
  { name: "round", signature: "round(value, decimals)", detail: "Rounds a number" },
  { name: "formatNumber", signature: "formatNumber(value, decimals)", detail: "A number as text with fixed decimals" },
  { name: "min", signature: "min(a, b, …)", detail: "The smallest" },
  { name: "max", signature: "max(a, b, …)", detail: "The largest" },
  { name: "sum", signature: "sum(a, b, …)", detail: "Adds them up, skipping blanks" },
  { name: "avg", signature: "avg(a, b, …)", detail: "The average, skipping blanks" },
  { name: "abs", signature: "abs(value)", detail: "Without its minus sign" },
  { name: "floor", signature: "floor(value)", detail: "Rounds down" },
  { name: "ceil", signature: "ceil(value)", detail: "Rounds up" },
  { name: "upper", signature: "upper(text)", detail: "IN CAPITALS" },
  { name: "lower", signature: "lower(text)", detail: "in small letters" },
  { name: "default", signature: "default(value, fallback)", detail: "The fallback when there's no value" },
];
