import { defineCollection } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

// Pages keep Mintlify's frontmatter as-is: `title` and `description` map
// directly onto Starlight's schema. `sidebarTitle` (one page) is read
// separately by scripts/sync-content.mjs while building the sidebar data,
// so it doesn't need a schema extension here.
export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
};
