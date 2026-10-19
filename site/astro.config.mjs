// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import mermaid from 'astro-mermaid';
import AutoImport from 'astro-auto-import';
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

    // Must come before `starlight()` so its auto-injected `@astrojs/mdx`
    // integration sees the imports this adds to every .mdx file — see
    // astro-auto-import's own README.
    AutoImport({
      imports: [
        { './src/components/mintlify/Note.astro': [['default', 'Note']] },
        { './src/components/mintlify/Tip.astro': [['default', 'Tip']] },
        { './src/components/mintlify/Warning.astro': [['default', 'Warning']] },
        { './src/components/mintlify/Info.astro': [['default', 'Info']] },
        { './src/components/mintlify/Check.astro': [['default', 'Check']] },
        { './src/components/mintlify/Danger.astro': [['default', 'Danger']] },
        { './src/components/mintlify/Card.astro': [['default', 'Card']] },
        { './src/components/mintlify/CardGroup.astro': [['default', 'CardGroup']] },
        { './src/components/mintlify/Columns.astro': [['default', 'Columns']] },
        { './src/components/mintlify/Tabs.astro': [['default', 'Tabs']] },
        { './src/components/mintlify/Tab.astro': [['default', 'Tab']] },
        { './src/components/mintlify/Steps.astro': [['default', 'Steps']] },
        { './src/components/mintlify/Step.astro': [['default', 'Step']] },
        { './src/components/mintlify/Accordion.astro': [['default', 'Accordion']] },
        { './src/components/mintlify/AccordionGroup.astro': [['default', 'AccordionGroup']] },
        { './src/components/mintlify/CodeGroup.astro': [['default', 'CodeGroup']] },
        { './src/components/mintlify/Frame.astro': [['default', 'Frame']] },
        // The <CodeGroup> -> <Tabs>/<TabItem> source transform emits
        // Starlight's own TabItem directly (see scripts/lib/codegroup.mjs).
        { '@astrojs/starlight/components': ['TabItem'] },
      ],
    }),

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
