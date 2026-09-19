import { errorMessage } from "../errors"
import { cachedRepo, ensureRepo } from "./fetch"
import { repoLabel } from "./layout"

export type Checkout = { ok: true; dir: string; label: string } | { ok: false; message: string; missing: boolean }

/** Where compile finds a pinned rule repo's files. */
export interface RepoProvider {
  checkout(url: string, rev: string): Promise<Checkout>
}

/** For hooks, which never fetch (spec §4): a repo missing from the cache is reported, not fetched. */
export function cachedRepos(home: string): RepoProvider {
  return {
    async checkout(url, rev) {
      const dir = cachedRepo(home, url, rev)
      if (dir === null) return { ok: false, missing: true, message: "not in the cache" }
      return { ok: true, dir, label: repoLabel(url, rev) }
    },
  }
}

/** For the CLI: fetches repos missing from the cache. */
export function fetchingRepos(home: string): RepoProvider {
  return {
    async checkout(url, rev) {
      try {
        return { ok: true, dir: await ensureRepo(home, url, rev), label: repoLabel(url, rev) }
      } catch (error) {
        return { ok: false, missing: false, message: `fetch failed: ${errorMessage(error)}` }
      }
    },
  }
}

/** For try-repo: every repo is `dir`. */
export function fixedRepo(dir: string, label: string): RepoProvider {
  return {
    async checkout() {
      return { ok: true, dir, label }
    },
  }
}
