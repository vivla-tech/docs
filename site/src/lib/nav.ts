// Reads the navigation tree generated from docs.json by
// scripts/sync-content.mjs (see src/data/nav.json) and exposes it in the
// shapes SiteHeader.astro (the top tab bar) and routeData.ts (the per-tab
// sidebar + pagination) need. This is the single source of truth for "which
// tab is a page in" and "what does that tab's sidebar look like" — both
// come straight from docs.json, in the same order it defines.
import navData from '../data/nav.json';

export interface NavPage {
  slug: string;
  href: string;
  label: string;
}

export interface NavGroup {
  label: string;
  pages: NavPage[];
}

export interface NavTab {
  label: string;
  href: string;
  groups: NavGroup[];
}

export const TABS: NavTab[] = navData.tabs;

/** Index of the tab that contains `slug`, or 0 (first tab) if not found. */
export function tabIndexForSlug(slug: string): number {
  for (let i = 0; i < TABS.length; i++) {
    for (const group of TABS[i].groups) {
      if (group.pages.some((page) => page.slug === slug)) return i;
    }
  }
  return 0;
}

interface SidebarLink {
  type: 'link';
  label: string;
  href: string;
  isCurrent: boolean;
  attrs: Record<string, string | number | boolean | undefined>;
}

interface SidebarGroup {
  type: 'group';
  label: string;
  entries: SidebarLink[];
  collapsed: boolean;
}

/** Starlight sidebar tree for one tab, with the current page marked. */
export function sidebarForTab(tabIndex: number, currentSlug: string): SidebarGroup[] {
  const tab = TABS[tabIndex];
  if (!tab) return [];
  return tab.groups.map((group) => ({
    type: 'group',
    label: group.label,
    collapsed: false,
    entries: group.pages.map((page) => ({
      type: 'link',
      label: page.label,
      href: page.href,
      isCurrent: page.slug === currentSlug,
      attrs: {},
    })),
  }));
}

interface PaginationLink {
  label: string;
  href: string;
}

/** Prev/next links within the current tab's own flattened page order. */
export function paginationForTab(
  tabIndex: number,
  currentSlug: string
): { prev?: PaginationLink; next?: PaginationLink } {
  const tab = TABS[tabIndex];
  if (!tab) return {};
  const flat = tab.groups.flatMap((group) => group.pages);
  const index = flat.findIndex((page) => page.slug === currentSlug);
  if (index === -1) return {};
  const prev = index > 0 ? flat[index - 1] : undefined;
  const next = index < flat.length - 1 ? flat[index + 1] : undefined;
  return {
    prev: prev && { label: prev.label, href: prev.href },
    next: next && { label: next.label, href: next.href },
  };
}
