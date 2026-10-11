import starlight from "@astrojs/starlight"
import { defineConfig } from "astro/config"
import { BASE, GROUPS, PAGES, SITE } from "./scripts/sources"

export default defineConfig({
  site: SITE,
  base: BASE,
  trailingSlash: "always",
  integrations: [
    starlight({
      title: "rulecast",
      description: "Your project's conventions, delivered to your coding agent at the moment it is about to break one.",
      logo: { src: "./src/assets/logo.svg", replacesTitle: false },
      favicon: "/favicon.svg",
      customCss: ["./src/styles/theme.css"],
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/syv-ai/rulecast" }],
      editLink: undefined,
      lastUpdated: false,
      components: { Header: "./src/components/Header.astro", ThemeSelect: "./src/components/ThemeSelect.astro" },
      // Code blocks are surfaces, not framed boxes: no borders, no window chrome.
      expressiveCode: {
        defaultProps: { frame: "none" },
        styleOverrides: { borderWidth: "0px", borderRadius: "0.75rem", frames: { frameBoxShadowCssValue: "none" } },
      },
      sidebar: GROUPS.map((label) => ({
        label,
        items: PAGES.filter((page) => page.group === label).map((page) => ({
          label: page.title,
          link: `/${page.route}/`,
        })),
      })),
    }),
  ],
})
