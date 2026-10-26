/** Shorthand for writing drawings in code (the same helpers the app's own visual templates use) */
import type { VisualAttrValue, VisualNode, VisualNodeKind } from '@config-platform/schema';

type Attrs = Record<string, VisualAttrValue>;
type Extra = Partial<Pick<VisualNode, 'name' | 'bindings' | 'rules' | 'effects' | 'smooth' | 'locked'>>;

export const shape = (kind: Exclude<VisualNodeKind, 'group' | 'symbol' | 'preset'>, id: string, attrs: Attrs, extra: Extra = {}): VisualNode => ({ id, kind, attrs, ...extra });

export const group = (id: string, children: VisualNode[], attrs: Attrs = {}, extra: Extra = {}): VisualNode => ({ id, kind: 'group', attrs, children, ...extra });

export const symbol = (id: string, ref: string, attrs: Attrs, extra: Extra = {}): VisualNode => ({ id, kind: 'symbol', ref, attrs, ...extra });

export const text = (id: string, x: number, y: number, content: string, size: number, attrs: Attrs = {}, extra: Extra = {}): VisualNode =>
  shape('text', id, { x, y, text: content, fontSize: size, ...attrs }, extra);
