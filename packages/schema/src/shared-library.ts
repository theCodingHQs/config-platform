/**
 * The shared library: things a workspace has published for reuse (symbols for now; templates
 * later). Published items are frozen releases: changing the working copy changes nothing until
 * it's published again. A platform owner can share any item with every workspace.
 *
 * Three levels, everywhere in the app: Built-in (ships with the app), Shared (published), Mine
 * (the workspace's own, being worked on).
 */
import { z } from 'zod';

export const SHARED_KINDS = ['symbol', 'page-template', 'export-template', 'solution'] as const;
export type SharedKind = (typeof SHARED_KINDS)[number];

/** Kinds tied to the publishing workspace's entities, which another workspace maps onto its own */
export const TEMPLATE_KINDS: readonly SharedKind[] = ['page-template', 'export-template'];

/** Drawings place a shared symbol by `shared:<item id>`, always showing its latest release */
export const SHARED_PREFIX = 'shared:';
export const isSharedRef = (id: string | undefined): boolean => Boolean(id?.startsWith(SHARED_PREFIX));
export const sharedRef = (itemId: string) => `${SHARED_PREFIX}${itemId}`;
export const sharedItemId = (ref: string) => ref.slice(SHARED_PREFIX.length);

export const PublishInputSchema = z.object({
  kind: z.enum(SHARED_KINDS),
  /** The workspace's own item it's published from: a symbol's visual id, a page or export id; for a solution, a key made from its name */
  sourceId: z.string().min(1).max(64),
  description: z.string().trim().max(300).default(''),
  /** Solutions only: what it's called, and the entities in it (the entities they link to come too) */
  name: z.string().trim().min(1).max(120).optional(),
  entityIds: z.array(z.string().min(1).max(64)).max(50).optional(),
});
export type PublishInput = z.input<typeof PublishInputSchema>;

export interface SharedItemSummary {
  id: string;
  kind: SharedKind;
  name: string;
  description: string;
  /** Release number: 1 when first published, one more each time it's published again */
  version: number;
  /** Shared with every workspace (by a platform owner), not only the one that published it */
  everywhere: boolean;
  /** Name of the workspace that published it */
  workspace: string;
  /** Published by the signed-in person's workspace */
  own: boolean;
  /** What it was published from, for the publishing workspace only */
  sourceId: string | null;
  publishedAt: string;
}

export interface SharedItem extends SharedItemSummary {
  content: unknown;
}

/** An entity a template uses, as it was in the publishing workspace */
export interface TemplateEntity {
  id: string;
  name: string;
  label: string;
  fields: Array<{ id: string; name: string; label: string; type: string }>;
}

/** What a page or export template is stored as: the layout, and the entities it was built on */
export interface TemplateContent {
  definition: unknown;
  entities: TemplateEntity[];
  /** Export templates: the entity it exports */
  entityId?: string;
}

/** Using a template: for each of its entities (by id), the workspace entity that takes its place */
export const UseTemplateInputSchema = z.object({
  entityMap: z.record(z.string().min(1).max(64), z.string().min(1).max(64)).default({}),
});
export type UseTemplateInput = z.input<typeof UseTemplateInputSchema>;

export interface UsedTemplate {
  /** The layout, pointed at the workspace's own entities and fields */
  definition: unknown;
  /** Fields with no same-named field in the chosen entity ("Machine → Hourly target"); their places show as missing */
  missingFields: string[];
  /** Export templates: the workspace entity it now exports */
  entityId?: string;
}

/** A solution: entities (with their fields and links), and the pages and export templates built on them */
export interface SolutionField {
  id: string;
  name: string;
  label: string;
  type: string;
  required: boolean;
  isUnique: boolean;
  position: number;
  config: Record<string, unknown>;
}

export interface SolutionEntity {
  id: string;
  name: string;
  label: string;
  icon?: string | null;
  displayFieldId?: string | null;
  uniqueRules?: Array<{ id: string; fields: string[] }>;
  fields: SolutionField[];
}

export interface SolutionContent {
  entities: SolutionEntity[];
  relations: Array<{ name: string; sourceEntityId: string; sourceFieldId: string; targetEntityId: string; targetFieldId?: string; relationType: string }>;
  pages: Array<{ name: string; route: string; draft: unknown; published?: unknown }>;
  exportTemplates: Array<{ name: string; entityId: string; draft: unknown; published?: unknown }>;
}

/** For a solution entity whose name the workspace already uses: use the workspace's (adding some of the missing fields), or make a new one */
export const EntityChoiceSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('reuse'), entityId: z.string().min(1).max(64), addFields: z.array(z.string().min(1).max(64)).default([]) }),
  z.object({ action: z.literal('create'), label: z.string().trim().min(1).max(120) }),
]);
export type EntityChoice = z.input<typeof EntityChoiceSchema>;

export const InstallSolutionInputSchema = z.object({
  /** By the solution's entity id; entities with a new name need none */
  choices: z.record(z.string().min(1).max(64), EntityChoiceSchema).default({}),
});
export type InstallSolutionInput = z.input<typeof InstallSolutionInputSchema>;

/** What installing would do, for the person to decide on clashes first */
export interface InstallPlan {
  entities: Array<{
    id: string;
    name: string;
    label: string;
    fieldCount: number;
    /** The workspace's entity of the same name, and the solution's fields it doesn't have */
    existing: null | { id: string; label: string; missingFields: Array<{ id: string; label: string }> };
  }>;
  pages: string[];
  exportTemplates: string[];
}

export interface InstallResult {
  created: string[];
  reused: string[];
  pages: Array<{ name: string; route: string }>;
  exportTemplates: string[];
  /** Fields the solution's pages use that weren't added to a reused entity; their places show as missing */
  missingFields: string[];
}
