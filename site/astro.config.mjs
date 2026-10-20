// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import mermaid from 'astro-mermaid';
import icon from 'astro-icon';
import starlightLinksValidator from 'starlight-links-validator';

export default defineConfig({
  site: 'https://wiki.vivla.com',
  outDir: './dist',
  trailingSlash: 'never',
  integrations: [
    // Must come before `starlight()` — see astro-mermaid's own README.
    // autoTheme (default) switches 'default'/'dark' with the site's own
    // light/dark toggle, so no fixed theme needs to be chosen here.
    mermaid({ autoTheme: true }),

    // The Mintlify component wrappers (Note, Card, ...) are made available
    // without an import line in content the same way Mintlify itself needs
    // none: scripts/lib/inject-imports.mjs prepends real `import` lines to
    // every copied page. A Vite-transform-based auto-import integration was
    // tried first but never ran for content-layer-loaded MDX — see that
    // file's comment.
    icon(),

    starlight({
      title: 'VIVLA Docs',
      description: 'Documentación técnica interna de la plataforma VIVLA',
      favicon: '/favicon.svg',
      logo: {
        light: './src/assets/logo-light.svg',
        dark: './src/assets/logo-dark.svg',
        replacesTitle: true,
        alt: 'VIVLA Tech',
      },
      locales: {
        root: { label: 'Español', lang: 'es' },
      },
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/vivla-tech' }],
      customCss: ['./src/styles/theme.css'],
      routeMiddleware: './src/routeData.ts',
      components: {
        Header: './src/components/SiteHeader.astro',
      },
      pagefind: true,
      markdown: {
        headingLinks: true,
      },
      expressiveCode: {
        themes: ['github-dark', 'github-light'],
      },
      plugins: [
        starlightLinksValidator({
          // Content keeps writing today while we migrate off Mintlify; some
          // links are already broken there too (see PLAN.md §3.1). Report,
          // don't fail the build — tighten once the backlog is cleared.
          failOnError: false,
          reporters: { json: true },
        }),
      ],
    }),
  ],
});
