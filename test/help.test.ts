/**
 * The `?` pane is the only training a user gets at the moment they are confused, so it has to
 * be true: every verb it names must be spelled the way the keymap actually binds it. This is
 * the drift that shipped a pane reading `b branch` after branch moved to `gb`.
 */
import { describe, expect, test } from "bun:test"
import { DEFAULT_KEYS, HELP_VERBS, helpLines } from "../src/core/help.js"

const lines = helpLines("1.2.3")
const body = lines.join("\n")
/** A verb's line: indented, and naming the key. Headings are unindented by construction. */
const verbLines = lines.filter((l) => l.startsWith("  ") && l.includes(" — "))

describe("the help pane spells keys the way the keymap binds them", () => {
  for (const command of HELP_VERBS) {
    test(`${command} is named by its bound key`, () => {
      const keys = DEFAULT_KEYS[command]
      expect(keys, `${command} is missing from DEFAULT_KEYS`).toBeDefined()
      expect(keys!.length, `${command} has no default key to document`).toBeGreaterThan(0)
      // the pane writes keys as the user types them: `gb`, `⏎`, `/`, `?`
      const spellings = keys!.map((k) => k.replace("return", "⏎").replace("escape", "esc").replace("shift+", ""))
      expect(spellings.some((k) => body.includes(k)), `no line in the ? pane names ${command} (${keys!.join(", ")})`).toBe(true)
    })
  }

  test("no line names a key the keymap does not bind", () => {
    const bound = new Set(Object.values(DEFAULT_KEYS).flat())
    // the g-prefixed verbs are the ones a rename would silently strand. "go" is the English
    // word in "⏎ go here", not a binding — the only collision the pane's prose has.
    const gVerbs = [...body.matchAll(/(?<![\w])g[a-z0-9](?![\w])/g)].map((m) => m[0]).filter((k) => k !== "go")
    for (const spelling of new Set(gVerbs)) {
      expect(bound.has(spelling), `the ? pane names "${spelling}", which nothing binds`).toBe(true)
    }
  })
})

describe("the pane teaches, not just lists", () => {
  test("every verb line says what the key is for", () => {
    // "gb branch — try something risky on a copy": a key, a name, and a reason
    expect(verbLines.length).toBeGreaterThanOrEqual(8)
    for (const line of verbLines) {
      const [, purpose] = line.split(" — ")
      expect(purpose?.trim().length ?? 0, `no purpose after the em dash: ${line}`).toBeGreaterThan(12)
    }
  })

  test("it opens by saying what the tree is, and what it does not touch", () => {
    expect(body).toContain("nothing here rewrites your transcript")
  })

  test("lines fit a terminal row unwrapped", () => {
    for (const line of lines) {
      expect([...line].length, `too long to fit one row: ${line}`).toBeLessThanOrEqual(112)
    }
  })
})
