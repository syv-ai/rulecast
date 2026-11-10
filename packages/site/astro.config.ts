import starlight from "@astrojs/starlight"
import type { AstroIntegration } from "astro"
import { defineConfig } from "astro/config"
import { codeThemes } from "./scripts/code-themes"
import { proseColumnPlugin } from "./scripts/prose-column"
import { BASE, SITE, sidebar } from "./scripts/sources"

/** Marks each table's prose column (scripts/prose-column.ts), the way Starlight adds its own plugins. */
const proseColumns: AstroIntegration = {
  name: "rulecast-prose-columns",
  hooks: {
    "astro:config:setup": ({ config }) => {
      const options = config.markdown.processor.options as { hastPlugins?: unknown[] }
      if (!Array.isArray(options.hastPlugins)) throw new Error("the Markdown processor takes no HAST plugins")
      options.hastPlugins.push(proseColumnPlugin)
    },
  },
}

export default defineConfig({
  site: SITE,
  base: BASE,
  trailingSlash: "always",
  // Pages that moved: an old link lands where its content went.
  redirects: {
    "/guides/claude-code-plugin/": `${BASE}/guides/agents/#claude-code`,
  },
  integrations: [
    proseColumns,
    starlight({
      title: "rulecast",
      description: "Your project's conventions, checked while your coding agent works.",
      logo: { src: "./src/assets/logo.svg", replacesTitle: false },
      favicon: "/favicon.svg",
      customCss: ["./src/styles/theme.css"],
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/syv-ai/rulecast" }],
      editLink: undefined,
      lastUpdated: false,
      components: {
        Header: "./src/components/Header.astro",
        MobileMenuToggle: "./src/components/MobileMenuToggle.astro",
        ThemeSelect: "./src/components/ThemeSelect.astro",
      },
      // Code blocks are surfaces, not framed boxes: no borders, no window chrome. Their colours are
      // the landing page's (scripts/code-themes.ts), on Starlight's own surfaces, except where
      // Expressive Code raises one to its minimum contrast. Long lines wrap, continuing under their
      // own indent, so nothing is cut off out of sight.
      expressiveCode: {
        themes: codeThemes(),
        useStarlightUiThemeColors: true,
        defaultProps: { frame: "none", wrap: true, preserveIndent: true },
        styleOverrides: { borderWidth: "0px", borderRadius: "0.75rem", frames: { frameBoxShadowCssValue: "none" } },
      },
      sidebar: sidebar(),
    }),
  ],
})
