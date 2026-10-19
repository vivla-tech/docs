// Starlight's own `sidebar` config is a single, site-wide tree. Mintlify's
// `docs.json` instead gives each top-level tab its own sidebar. This route
// middleware swaps in the right one for the page being rendered, computed
// from docs.json (see src/lib/nav.ts) — the officially documented way to
// customize Starlight's per-page data (see "Route Data" in the Starlight
// docs). SiteHeader.astro reads the same data to render the tab itself.
import { defineRouteMiddleware } from '@astrojs/starlight/route-data';
import { paginationForTab, sidebarForTab, tabIndexForSlug } from './lib/nav';

export const onRequest = defineRouteMiddleware((context) => {
  const { starlightRoute } = context.locals;
  const currentSlug = starlightRoute.id;
  const tabIndex = tabIndexForSlug(currentSlug);

  // @ts-expect-error — our sidebar entries match StarlightRouteData's
  // SidebarLink/SidebarGroup shape; the import type isn't re-exported.
  starlightRoute.sidebar = sidebarForTab(tabIndex, currentSlug);
  starlightRoute.pagination = paginationForTab(tabIndex, currentSlug);
});
