import { defineCollection } from 'astro:content';
import { docsLoader, i18nLoader } from '@astrojs/starlight/loaders';
import { docsSchema, i18nSchema } from '@astrojs/starlight/schema';

// Pages keep Mintlify's frontmatter as-is: `title` and `description` map
// directly onto Starlight's schema. `sidebarTitle` (one page) is read
// separately by scripts/sync-content.mjs while building the sidebar data,
// so it doesn't need a schema extension here.
export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
  // Mintlify's own UI strings are English while the content is Spanish.
  // The site keeps lang="es" (Pagefind stems Spanish) and overrides the
  // UI labels here so they read as they do on Mintlify.
  i18n: defineCollection({ loader: i18nLoader(), schema: i18nSchema() }),
};
