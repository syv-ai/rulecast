import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Many tests spawn git, and vitest runs files in parallel. They take 0.5-2.5 s on an idle machine,
    // but on a busy one they exceed vitest's 5 s default and fail as timeouts rather than on their
    // assertions. 20 s leaves an order of magnitude of headroom while still catching a real hang.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
})
