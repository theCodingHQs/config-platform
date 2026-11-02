/**
 * Links to a page by its id, not its address, so moving or renaming the page never breaks them.
 * A link looks like `page:<id>?machine=M12`: the values after "?" arrive on the target page as
 * `{{ params.machine }}`. The app turns it into the page's current address when it navigates.
 */
export const PAGE_LINK_PREFIX = "page:";

export function buildPageLink(pageId: string, values: Record<string, string> = {}): string {
  const query = new URLSearchParams(Object.entries(values).filter(([key]) => key.trim() !== "")).toString();
  return `${PAGE_LINK_PREFIX}${pageId}${query ? `?${query}` : ""}`;
}

export const isPageLink = (url: string): boolean => url.startsWith(PAGE_LINK_PREFIX);

/** The page's current address plus the values, or null when no published page has that id. */
export function resolvePageLink(url: string, pages: { id: string; route: string }[]): string | null {
  const rest = url.slice(PAGE_LINK_PREFIX.length);
  const split = rest.indexOf("?");
  const id = split === -1 ? rest : rest.slice(0, split);
  const page = pages.find((candidate) => candidate.id === id);
  return page ? `${page.route}${split === -1 ? "" : rest.slice(split)}` : null;
}
