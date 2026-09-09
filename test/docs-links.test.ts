/**
 * The README sends people into `docs/USAGE.md` by anchor. A renamed heading breaks those
 * links silently — the page still loads, it just lands at the top — so the drift is invisible
 * until a user is lost. This holds the two files against each other.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.join(import.meta.dir, "..")
const readme = readFileSync(path.join(ROOT, "README.md"), "utf8")
const usage = readFileSync(path.join(ROOT, "docs", "USAGE.md"), "utf8")

/**
 * GitHub's heading slug: lowercase, drop everything that is not a word character, a space or
 * a hyphen, then spaces become hyphens. An em dash between spaces therefore leaves *two*
 * hyphens (`### Crop — stop …` → `crop--stop-`), which is easy to get wrong by hand.
 */
function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s/g, "-")
}

const headings = [...usage.matchAll(/^#+ (.+)$/gm)].map((m) => slug(m[1]!))
const links = [...readme.matchAll(/docs\/USAGE\.md#([\w-]+)/g)].map((m) => m[1]!)

describe("README → USAGE anchors", () => {
  test("the README actually links into the usage guide", () => {
    expect(links.length).toBeGreaterThan(3)
  })

  for (const anchor of [...new Set(links)]) {
    test(`#${anchor} exists`, () => {
      expect(headings, `docs/USAGE.md has no heading whose anchor is #${anchor}`).toContain(anchor)
    })
  }

  test("the decision guide is reachable from the command table", () => {
    expect(links).toContain("choosing-what-to-do")
  })
})
