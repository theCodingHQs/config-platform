/**
 * Copy and paste between visuals (and browser tabs) through the system clipboard. Copied shapes
 * travel as JSON with a marker, so pasting other text does nothing.
 */
import { VisualNodeSchema, type VisualNode } from "@config-platform/schema";

const MARKER = "config-platform/visual-nodes@1";

export async function copyNodes(nodes: readonly VisualNode[]): Promise<void> {
  const text = JSON.stringify({ [MARKER]: nodes });
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard blocked (e.g. not focused): keep a copy for pasting in this tab
  }
  memory = text;
}

let memory: string | null = null;

/** Shapes on the clipboard, or null when it holds something else */
export async function readNodes(): Promise<VisualNode[] | null> {
  let text: string | null = null;
  try {
    text = await navigator.clipboard.readText();
  } catch {
    text = memory;
  }
  return parseNodes(text ?? memory);
}

export function parseNodes(text: string | null): VisualNode[] | null {
  if (!text?.includes(MARKER)) return null;
  try {
    const raw = (JSON.parse(text) as Record<string, unknown>)[MARKER];
    if (!Array.isArray(raw)) return null;
    const nodes = raw.map((n) => VisualNodeSchema.safeParse(n)).filter((r) => r.success).map((r) => r.data as VisualNode);
    return nodes.length ? nodes : null;
  } catch {
    return null;
  }
}
