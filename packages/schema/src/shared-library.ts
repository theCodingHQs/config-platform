/**
 * The shared library: things a workspace has published for reuse (symbols for now; templates
 * later). Published items are frozen releases: changing the working copy changes nothing until
 * it's published again. A platform owner can share any item with every workspace.
 *
 * Three levels, everywhere in the app: Built-in (ships with the app), Shared (published), Mine
 * (the workspace's own, being worked on).
 */
import { z } from 'zod';

export const SHARED_KINDS = ['symbol'] as const;
export type SharedKind = (typeof SHARED_KINDS)[number];

/** Drawings place a shared symbol by `shared:<item id>`, always showing its latest release */
export const SHARED_PREFIX = 'shared:';
export const isSharedRef = (id: string | undefined): boolean => Boolean(id?.startsWith(SHARED_PREFIX));
export const sharedRef = (itemId: string) => `${SHARED_PREFIX}${itemId}`;
export const sharedItemId = (ref: string) => ref.slice(SHARED_PREFIX.length);

export const PublishInputSchema = z.object({
  kind: z.enum(SHARED_KINDS),
  /** The workspace's own item it's published from (a symbol's visual id) */
  sourceId: z.string().min(1).max(64),
  description: z.string().trim().max(300).default(''),
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
