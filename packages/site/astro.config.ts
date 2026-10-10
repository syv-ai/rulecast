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
      logo: { light: "./src/assets/logo-light.svg", dark: "./src/assets/logo-dark.svg", replacesTitle: false },
      favicon: "/favicon.svg",
      customCss: ["./src/styles/theme.css"],
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/syv-ai/rulecast" }],
      editLink: undefined,
      lastUpdated: false,
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
