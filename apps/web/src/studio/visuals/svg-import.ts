/**
 * Turning an SVG file (or SVG copied from a browser's inspector) into editable shapes: groups,
 * rectangles, circles, ellipses, lines, polylines, polygons, paths, text and pictures, with their
 * colours, outlines, positions and gradients. Nothing in the file is run or loaded; parts this
 * editor can't show (patterns, filters other than shadows, <use>, CSS classes) are listed as skipped.
 */
import { MAX_VISUAL_NODES, type VisualAttrValue, type VisualNode, type VisualPaint, type VisualPaintStop } from "@config-platform/schema";
import { safeColor, safeImageHref } from "../../visuals/coerce";
import { decompose, multiply, parseTransform, IDENTITY, type Matrix } from "./svg-matrix";
import { nextId } from "./node-tree";

export interface SvgImport {
  nodes: VisualNode[];
  paints: VisualPaint[];
  /** The drawing's own size (from its viewBox or width/height) */
  width?: number;
  height?: number;
  /** What couldn't be brought in, by element name, with counts */
  skipped: Record<string, number>;
  count: number;
}

const SILENT = new Set(["defs", "title", "desc", "metadata", "style", "script", "linearGradient", "radialGradient", "stop", "clipPath", "mask", "pattern", "filter", "symbol", "marker"]);

const num = (v: string | null | undefined, d = 0) => {
  const n = parseFloat(v ?? "");
  return Number.isFinite(n) ? n : d;
};

/** A presentation attribute, from style="…" first (it wins in SVG), then the attribute */
function prop(el: Element, name: string): string | null {
  const style = el.getAttribute("style");
  if (style) {
    const m = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, "i").exec(style);
    if (m) return m[1].trim();
  }
  return el.getAttribute(name);
}

function fontFamily(v: string): string {
  if (/mono|consolas|menlo|courier/i.test(v)) return "monospace";
  if (/(^|[\s,'"])serif/i.test(v) && !/sans/i.test(v)) return "serif";
  return "inherit";
}

const WEIGHTS: Record<string, string> = { normal: "400", bold: "700", bolder: "800", lighter: "400" };

function lookOf(el: Element, paints: ReadonlySet<string>): Record<string, VisualAttrValue> {
  const out: Record<string, VisualAttrValue> = {};
  const color = (name: string, key: string) => {
    const v = prop(el, name);
    if (v === null) return;
    const ref = /^url\(\s*['"]?#([^'")]+)['"]?\s*\)/.exec(v);
    if (ref) {
      if (paints.has(ref[1])) out[key] = `url(#${ref[1]})`;
      return;
    }
    const c = safeColor(v);
    if (c !== null) out[key] = c;
  };
  color("fill", "fill");
  color("stroke", "stroke");
  const n = (name: string, key: string) => {
    const v = prop(el, name);
    if (v !== null && Number.isFinite(parseFloat(v))) out[key] = parseFloat(v);
  };
  n("stroke-width", "strokeWidth");
  n("fill-opacity", "fillOpacity");
  n("stroke-opacity", "strokeOpacity");
  n("opacity", "opacity");
  const dash = prop(el, "stroke-dasharray");
  if (dash && dash !== "none") out.strokeDasharray = dash.replace(/,/g, " ");
  const cap = prop(el, "stroke-linecap");
  if (cap && ["butt", "round", "square"].includes(cap)) out.strokeLinecap = cap;
  const join = prop(el, "stroke-linejoin");
  if (join && ["miter", "round", "bevel"].includes(join)) out.strokeLinejoin = join;
  if (/^url\(/.test(prop(el, "filter") ?? "")) out.shadow = true;
  return out;
}

function textOf(el: Element): Record<string, VisualAttrValue> {
  const out: Record<string, VisualAttrValue> = { text: (el.textContent ?? "").replace(/\s+/g, " ").trim() };
  const size = prop(el, "font-size");
  if (size) out.fontSize = num(size, 14);
  const weight = prop(el, "font-weight");
  if (weight) out.fontWeight = WEIGHTS[weight] ?? String(Math.min(800, Math.max(400, Math.round(num(weight, 400) / 100) * 100)));
  const family = prop(el, "font-family");
  if (family) out.fontFamily = fontFamily(family);
  const anchor = prop(el, "text-anchor");
  if (anchor && ["middle", "end"].includes(anchor)) out.textAnchor = anchor;
  const base = prop(el, "dominant-baseline") ?? prop(el, "alignment-baseline");
  if (base && ["middle", "central"].includes(base)) out.baseline = "middle";
  if (base && ["hanging", "text-before-edge"].includes(base)) out.baseline = "hanging";
  return out;
}

const fraction = (v: string | null, d: number) => {
  if (v === null) return d;
  return v.trim().endsWith("%") ? num(v) / 100 : num(v, d);
};

/** Gradients by id; stops can come from another gradient the first one points to (href) */
function readPaints(doc: Document): VisualPaint[] {
  const all = [...doc.querySelectorAll("linearGradient[id], radialGradient[id]")];
  const byId = new Map(all.map((g) => [g.id, g]));
  const stopsOf = (g: Element, depth = 0): VisualPaintStop[] => {
    const own = [...g.querySelectorAll(":scope > stop")];
    const href = (g.getAttribute("href") ?? g.getAttribute("xlink:href") ?? "").replace(/^#/, "");
    if (!own.length && href && depth < 4 && byId.has(href)) return stopsOf(byId.get(href)!, depth + 1);
    return own
      .map((s) => {
        const color = safeColor(prop(s, "stop-color") ?? "black");
        const opacity = prop(s, "stop-opacity");
        return color ? { offset: Math.min(1, Math.max(0, fraction(s.getAttribute("offset"), 0))), color, ...(opacity !== null ? { opacity: Math.min(1, Math.max(0, num(opacity, 1))) } : {}) } : null;
      })
      .filter((s): s is VisualPaintStop => Boolean(s))
      .slice(0, 20);
  };
  const paints: VisualPaint[] = [];
  for (const g of all.slice(0, 100)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(g.id) || g.id.length > 40) continue;
    const stops = stopsOf(g);
    if (!stops.length) continue;
    // Positions in user space can't be kept as fractions of the shape; those fall back to the defaults
    const box = g.getAttribute("gradientUnits") !== "userSpaceOnUse";
    const f = (name: string, d: number) => (box ? Math.min(3, Math.max(-2, fraction(g.getAttribute(name), d))) : d);
    paints.push(
      g.tagName === "linearGradient"
        ? { id: g.id, type: "linear", x1: f("x1", 0), y1: f("y1", 0), x2: f("x2", 1), y2: f("y2", 0), stops }
        : { id: g.id, type: "radial", cx: f("cx", 0.5), cy: f("cy", 0.5), r: f("r", 0.5), stops },
    );
  }
  return paints;
}

/** Placement attributes from a matrix: plain moves stay plain; turns and scales keep the anchor as pivot */
function placeAttrs(m: Matrix): Record<string, VisualAttrValue> {
  const t = decompose(m);
  const out: Record<string, VisualAttrValue> = { x: t.x, y: t.y };
  if (t.rotate) out.rotate = t.rotate;
  if (t.scaleX !== 1) out.scaleX = t.scaleX;
  if (t.scaleY !== 1) out.scaleY = t.scaleY;
  if (t.rotate || t.scaleX !== 1 || t.scaleY !== 1) out.pivot = "anchor";
  return out;
}

/** A CSS transform-origin ("center bottom", "50% 100%") as a point of a box */
function originIn(origin: string, box: { x: number; y: number; width: number; height: number }): [number, number] {
  const words = origin.trim().split(/\s+/);
  const KEYS: Record<string, number> = { left: 0, top: 0, center: 0.5, right: 1, bottom: 1 };
  const frac = (w: string | undefined) => (w === undefined ? 0.5 : w in KEYS ? KEYS[w] : w.endsWith("%") ? num(w) / 100 : null);
  // Keywords can come in either order ("bottom center")
  const [a, b] = ["top", "bottom"].includes(words[0]) ? [words[1], words[0]] : [words[0], words[1]];
  const fx = frac(a);
  const fy = frac(b);
  return [box.x + (fx ?? 0) * box.width + (fx === null ? num(a) : 0), box.y + (fy ?? 0) * box.height + (fy === null ? num(b) : 0)];
}

/** The element's own transform: the attribute, then a CSS transform (around its transform-origin when we know its box) */
function ownTransform(el: Element, box?: { x: number; y: number; width: number; height: number }): Matrix {
  const style = el.getAttribute("style") ?? "";
  const css = /(?:^|;)\s*transform\s*:\s*([^;]+)/.exec(style)?.[1];
  let m = parseTransform(el.getAttribute("transform"));
  if (!css) return m;
  const origin = /(?:^|;)\s*transform-origin\s*:\s*([^;]+)/.exec(style)?.[1];
  const fillBox = /transform-box\s*:\s*fill-box/.test(style);
  const [ox, oy] = origin && box ? originIn(origin, fillBox ? box : { x: 0, y: 0, width: 0, height: 0 }) : [0, 0];
  m = multiply(m, [1, 0, 0, 1, ox, oy]);
  m = multiply(m, parseTransform(css));
  return multiply(m, [1, 0, 0, 1, -ox, -oy]);
}

const pointsOf = (v: string | null) => {
  const n = (v ?? "").trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
  const out: string[] = [];
  for (let i = 0; i + 1 < n.length; i += 2) out.push(`${n[i]},${n[i + 1]}`);
  return out.join(" ");
};

export function importSvg(text: string, taken: Set<string>): SvgImport {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const root = doc.documentElement;
  if (root.nodeName !== "svg" || doc.querySelector("parsererror")) throw new Error("That isn't an SVG drawing this editor can read");
  const paints = readPaints(doc);
  const paintIds = new Set(paints.map((p) => p.id));
  const skipped: Record<string, number> = {};
  let count = 0;

  const make = (kind: VisualNode["kind"], el: Element, attrs: Record<string, VisualAttrValue>, children?: VisualNode[]): VisualNode => {
    const id = nextId(taken, kind);
    taken.add(id);
    count++;
    const title = el.querySelector(":scope > title")?.textContent?.trim();
    return { id, kind, ...(title ? { name: title.slice(0, 120) } : {}), attrs, ...(children ? { children } : {}) };
  };

  const convert = (el: Element): VisualNode | null => {
    const tag = el.tagName;
    if (count >= MAX_VISUAL_NODES) return null;
    if (SILENT.has(tag)) return null;
    const box = tag === "rect" || tag === "image" ? { x: num(el.getAttribute("x")), y: num(el.getAttribute("y")), width: num(el.getAttribute("width")), height: num(el.getAttribute("height")) } : undefined;
    const own = ownTransform(el, box);
    const at = (x: number, y: number) => placeAttrs(multiply(own, [1, 0, 0, 1, x, y]));
    const look = lookOf(el, paintIds);
    const kids = () => [...el.children].map(convert).filter((n): n is VisualNode => Boolean(n));
    switch (tag) {
      case "g": {
        const children = kids();
        return children.length ? make("group", el, { ...placeAttrs(own), ...look }, children) : null;
      }
      case "svg": {
        // A nested drawing: its viewBox scales its contents into its width × height
        const vb = (el.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
        const w = num(el.getAttribute("width"), vb[2] || 0);
        const h = num(el.getAttribute("height"), vb[3] || 0);
        let m = multiply(own, [1, 0, 0, 1, num(el.getAttribute("x")), num(el.getAttribute("y"))]);
        if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) m = multiply(m, [w / vb[2], 0, 0, h / vb[3], -vb[0] * (w / vb[2]), -vb[1] * (h / vb[3])]);
        const children = kids();
        return children.length ? make("group", el, { ...placeAttrs(m), ...look }, children) : null;
      }
      case "rect": {
        const rx = num(el.getAttribute("rx"), num(el.getAttribute("ry")));
        return make("rect", el, { ...at(num(el.getAttribute("x")), num(el.getAttribute("y"))), width: num(el.getAttribute("width")), height: num(el.getAttribute("height")), ...(rx ? { rx } : {}), ...look });
      }
      case "circle": {
        const r = num(el.getAttribute("r"));
        return make("ellipse", el, { ...at(num(el.getAttribute("cx")), num(el.getAttribute("cy"))), rx: r, ry: r, ...look });
      }
      case "ellipse":
        return make("ellipse", el, { ...at(num(el.getAttribute("cx")), num(el.getAttribute("cy"))), rx: num(el.getAttribute("rx")), ry: num(el.getAttribute("ry")), ...look });
      case "line":
        return make("line", el, { ...placeAttrs(own), x1: num(el.getAttribute("x1")), y1: num(el.getAttribute("y1")), x2: num(el.getAttribute("x2")), y2: num(el.getAttribute("y2")), ...look });
      case "polyline":
      case "polygon":
        return make(tag, el, { ...placeAttrs(own), points: pointsOf(el.getAttribute("points")), ...look });
      case "path": {
        const d = el.getAttribute("d") ?? "";
        return d.trim() && d.length <= 20_000 ? make("path", el, { ...placeAttrs(own), d, ...look }) : null;
      }
      case "text": {
        const t = textOf(el);
        return t.text ? make("text", el, { ...at(num(el.getAttribute("x")), num(el.getAttribute("y"))), ...t, ...look }) : null;
      }
      case "image": {
        const href = el.getAttribute("href") ?? el.getAttribute("xlink:href") ?? "";
        if (!safeImageHref(href) || href.length > 20_000) break;
        return make("image", el, { ...at(num(el.getAttribute("x")), num(el.getAttribute("y"))), width: num(el.getAttribute("width")), height: num(el.getAttribute("height")), href });
      }
    }
    skipped[tag] = (skipped[tag] ?? 0) + 1;
    return null;
  };

  const vb = (root.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
  const width = vb.length === 4 && vb[2] > 0 ? vb[2] : num(root.getAttribute("width")) || undefined;
  const height = vb.length === 4 && vb[3] > 0 ? vb[3] : num(root.getAttribute("height")) || undefined;
  // The outer viewBox's origin moves everything so it starts at (0, 0)
  const shift: Matrix = vb.length === 4 ? [1, 0, 0, 1, -vb[0], -vb[1]] : IDENTITY;
  const nodes = [...root.children].map(convert).filter((n): n is VisualNode => Boolean(n));
  if (shift[4] || shift[5]) for (const n of nodes) n.attrs = { ...n.attrs, x: num(String(n.attrs.x)) + shift[4], y: num(String(n.attrs.y)) + shift[5] };
  return { nodes, paints, width, height, skipped, count };
}
