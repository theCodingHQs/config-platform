/**
 * Default axis titles for page charts, derived from the chart's fields. Shared by the chart
 * component (what is drawn) and the Builder (shown as the "Auto" placeholder).
 */
export function defaultChartAxisTitles(
  groupFieldLabel: string | undefined,
  aggregateOp: string | undefined,
  aggregateFieldLabel: string | undefined,
): { x: string; y: string } {
  const field = aggregateFieldLabel || "value";
  const y = (() => {
    switch (aggregateOp ?? "count") {
      case "sum":
        return `Total ${field}`;
      case "avg":
        return `Average ${field}`;
      case "min":
        return `Minimum ${field}`;
      case "max":
        return `Maximum ${field}`;
      default:
        return "Number of records";
    }
  })();
  return { x: groupFieldLabel || "Category", y };
}
