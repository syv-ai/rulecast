/**
 * The colour tokens of a page in agents/, by the theme they apply in. An artifact host sets
 * `data-theme` on the root to the viewer's app theme, which can differ from the system's, so a page
 * defines its light tokens on `:root`, and its dark ones twice: under `prefers-color-scheme: dark`
 * unless the host says light, and under `:root[data-theme="dark"]`. Throws when a block is missing
 * or the two dark blocks differ.
 */
export function themeBlocks(page: string): { light: Map<string, string>; dark: Map<string, string> } {
  const tokens = (body: string) =>
    new Map([...body.matchAll(/(--[\w-]+|color-scheme):\s*([^;]+);/g)].map((match) => [match[1]!, match[2]!.trim()]))
  const block = (pattern: RegExp, name: string) => {
    const match = pattern.exec(page)
    if (!match) throw new Error(`no ${name} block`)
    return tokens(match[1]!)
  }
  const light = block(/<style>[\s\S]*?\n:root \{([^}]*)\}/, ":root")
  const system = block(
    /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{([^}]*)\}/,
    'prefers-color-scheme: dark, :root:not([data-theme="light"])',
  )
  const host = block(/\n:root\[data-theme="dark"\] \{([^}]*)\}/, ':root[data-theme="dark"]')
  if (JSON.stringify([...system]) !== JSON.stringify([...host])) throw new Error("the two dark blocks differ")
  const colours = (map: Map<string, string>) => [...map.keys()].filter((key) => !["--display", "--mono"].includes(key))
  if (JSON.stringify(colours(light).sort()) !== JSON.stringify([...system.keys()].sort())) {
    throw new Error("the dark blocks do not redefine every colour token")
  }
  if (light.get("color-scheme") !== "light" || system.get("color-scheme") !== "dark")
    throw new Error("color-scheme is not set per theme")
  return { light, dark: system }
}
