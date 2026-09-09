/**
 * The README sends people into `docs/USAGE.md` by anchor. A renamed heading breaks those
 * links silently — the page still loads, it just lands at the top — so the drift is invisible
 * until a user is lost. This holds the two files against each other.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { DEFAULT_KEYS } from "../src/core/help.js"
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

/**
 * `keybinds` is documented by listing every command name it accepts. That list is a hand copy
 * of `DEFAULT_KEYS`, so a new command is documented only if someone remembers to add it —
 * and a user who guesses the name gets silence, since an unknown key is simply ignored.
 */
describe("the keybinds command list", () => {
  // the fenced run of names between "names are" and the closing backtick
  const listed = new Set(
    (usage.match(/names are\s*\n?`([^`]+)`/)?.[1] ?? "")
      .split(/\s+/)
      .filter(Boolean),
  )

  test("the guide actually lists the names", () => {
    expect(listed.size).toBeGreaterThan(30)
  })

  test("`open` is listed — it is the one command that is not a route key", () => {
    expect(listed.has("open")).toBe(true)
  })

  for (const command of Object.keys(DEFAULT_KEYS)) {
    test(`${command} is documented`, () => {
      expect(listed.has(command), `docs/USAGE.md does not list "${command}" among the keybinds names`).toBe(true)
    })
  }

  test("nothing is listed that no longer exists", () => {
    for (const name of listed) {
      if (name === "open") continue
      expect(DEFAULT_KEYS[name], `docs/USAGE.md lists "${name}", which is not a command`).toBeDefined()
    }
  })
})
