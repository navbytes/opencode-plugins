/**
 * The `?` pane is the only training a user gets at the moment they are confused, so it has to
 * be true: every verb it names must be spelled the way the keymap actually binds it. This is
 * the drift that shipped a pane reading `b branch` after branch moved to `gb`.
 *
 * And true for *this* user: `keybinds` rebinds any command, so the suite runs twice — once on
 * the defaults, once under an override — because a pane built from string literals passes the
 * first pass and lies to everyone who has rebound anything.
 */
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { DEFAULT_KEYS, footerLine, HELP_VERBS, HELP_WIDTH, helpLines, helpSegments, keyLabel, keyLabels, rowHint, type RowAffordance } from "../src/core/help.js"

/**
 * Every verb the pane must name, moved somewhere it could not possibly have been hardcoded —
 * plus one taken away entirely. A line built from a string literal survives the default pass
 * and fails here, which is the whole point: `keybinds` is a documented option, and a pane
 * that still says `c crop` to someone who moved crop is worse than a pane with no keys at all.
 */
const REBOUND: Record<string, string[]> = {
  ...Object.fromEntries(HELP_VERBS.map((command, i) => [command, [`f${i + 1}`]])),
  fold_toggle: ["ctrl+o"],
  merge: ["shift+b"],
  branch: [],
}

const CASES = [
  { name: "the defaults", overrides: undefined as Record<string, string[]> | undefined },
  { name: "a keybinds override", overrides: REBOUND },
]

for (const { name, overrides } of CASES) {
  const keys = (command: string) => overrides?.[command] ?? DEFAULT_KEYS[command] ?? []
  const lines = helpLines("1.2.3", overrides)
  const body = lines.join("\n")
  /** A verb row: the `Act`/`Views` table shape — a key field, a name field, a purpose. */
  const verbRows = helpSegments("1.2.3", overrides).filter((l) => l.some((s) => s.kind === "key") && l.some((s) => s.kind === "name"))

  describe(`the help pane spells keys the way the keymap binds them (${name})`, () => {
    for (const command of HELP_VERBS) {
      test(`${command} is named by its bound key`, () => {
        const bound = keys(command)
        expect(DEFAULT_KEYS[command], `${command} is missing from DEFAULT_KEYS`).toBeDefined()
        // an override may unbind a command outright; then the pane must simply not claim a key
        if (bound.length === 0) return
        // The pane writes keys as the user types them (`gb`, `⏎`, `/`, `?`) — and it must
        // write them *as keys*: `route.tsx#helpColor` can only bolden a run it has been told
        // is a key, so a spelling that leaked into a `text` run is invisible again, which is
        // the exact defect this whole segment model exists to prevent.
        const spellings = new Set(keyLabels(command, overrides))
        const asKeys = helpSegments("1.2.3", overrides)
          .flat()
          .filter((x) => x.kind === "key")
          .flatMap((x) => x.text.split(" "))
        expect([...spellings].some((k) => asKeys.includes(k)), `the ? pane never names ${command} (${bound.join(", ")}) in a key segment`).toBe(true)
      })
    }

    test("no line names a key the keymap does not bind", () => {
      const bound = new Set(Object.keys(DEFAULT_KEYS).flatMap(keys))
      // the g-prefixed verbs are the ones a rename would silently strand. "go" is the English
      // word in "⏎ go here", not a binding — the only collision the pane's prose has.
      const gVerbs = [...body.matchAll(/(?<![\w])g[a-z0-9](?![\w])/g)].map((m) => m[0]).filter((k) => k !== "go")
      for (const spelling of new Set(gVerbs)) {
        expect(bound.has(spelling), `the ? pane names "${spelling}", which nothing binds`).toBe(true)
      }
    })

    test("an unbound verb takes its clause with it rather than leaving a headless one", () => {
      // `keybinds: { branch: "none" }` used to leave "   branch — try something risky…": a
      // line whose key is simply gone, which reads as a typo rather than as an option.
      for (const line of helpSegments("1.2.3", overrides)) {
        for (const s of line) {
          expect(s.text.length, `an empty ${s.kind} segment — a key-shaped hole: ${JSON.stringify(line)}`).toBeGreaterThan(0)
        }
        // a name column with no key in front of it is the same hole, one layer up
        const kinds = line.map((s) => s.kind)
        if (kinds.includes("name")) expect(kinds.includes("key"), `a name with no key: ${JSON.stringify(line)}`).toBe(true)
      }
      for (const l of lines) {
        expect(l, `an empty clause survived: ${l}`).not.toMatch(/ · {2}|· ·/)
      }
    })

    test("an unbound command leaves no dangling key in the prose", () => {
      for (const [command, spellings] of Object.entries(overrides ?? {})) {
        if (spellings.length > 0) continue
        for (const gone of DEFAULT_KEYS[command] ?? []) {
          // `gb` is two characters and appears nowhere else; a single letter would be prose
          if (gone.length < 2) continue
          expect(body.includes(gone), `${command} is unbound but the pane still says "${gone}"`).toBe(false)
        }
      }
    })
  })

  describe(`the pane teaches, not just lists (${name})`, () => {
    test("every verb row is a key, a name and a reason", () => {
      // `gm  merge    end a branch: …` — three fields, and the third is what a key list
      // would leave out. This is the assertion the em-dash split used to stand in for.
      expect(verbRows.length, "the Act and Views tables lost their rows").toBeGreaterThanOrEqual(8)
      for (const line of verbRows) {
        const key = line.find((s) => s.kind === "key")!
        const name = line.find((s) => s.kind === "name")!
        const purpose = line
          .slice(line.indexOf(name) + 1)
          .map((s) => s.text)
          .join("")
        expect(key.text.trim().length, `a verb row with no key: ${JSON.stringify(line)}`).toBeGreaterThan(0)
        expect(name.text.trim().length, `a verb row with no name: ${JSON.stringify(line)}`).toBeGreaterThan(0)
        expect(purpose.trim().length, `no purpose after the name: ${purpose}`).toBeGreaterThan(12)
      }
    })

    test("a key is always drawn as a key, so the pane can make it the bright thing", () => {
      // the whole reason the pane is segments: `route.tsx#helpColor` can only bolden a key
      // it has been told about, and a key that leaked into a `text` run is invisible again
      // compare *spellings*, since that is what a segment carries: `up` is drawn `↑`
      const spelled = new Set(Object.keys(DEFAULT_KEYS).flatMap((command) => keyLabels(command, overrides)))
      for (const line of helpSegments("1.2.3", overrides)) {
        for (const s of line.filter((x) => x.kind === "key")) {
          for (const stroke of s.text.split(" ")) {
            expect(spelled.has(stroke), `"${stroke}" is drawn as a key but nothing binds it`).toBe(true)
          }
        }
      }
    })

    test("it opens by saying what the tree is, and what it does not touch", () => {
      expect(body).toContain("nothing here rewrites your transcript")
    })

    test("lines fit the width they were laid out for, at every terminal worth having", () => {
      // The budget is the *row* budget, not the terminal's: a help row is `│ ` inside a
      // padding-1 box, so it gets `cols - HELP_CHROME`. Asserting against the raw terminal
      // width is how nine lines came to clip at 100 columns with this test green.
      for (const width of [HELP_WIDTH, 76, 56, 40]) {
        for (const line of helpLines("1.2.3", overrides, width)) {
          expect([...line].length, `${width + 4} columns: too long to fit one row: ${line}`).toBeLessThanOrEqual(width)
        }
      }
    })

    test("narrowing drops clauses and clips prose — it never drops a row", () => {
      const rows = (width: number) => helpLines("1.2.3", overrides, width).length
      expect(rows(40)).toBe(rows(HELP_WIDTH))
    })
  })
}

describe("keyLabel", () => {
  test("spells a stroke the way it is typed, not the way it is stored", () => {
    expect(keyLabel("go")).toBe("⏎")
    expect(keyLabel("back")).toBe("q")
    expect(keyLabel("inspector_up")).toBe("PgUp")
    expect(keyLabel("mark")).toBe("space")
    expect(keyLabel("toggle")).toBe("Tab")
  })

  test("shift on a letter is the capital, not the word", () => {
    expect(keyLabel("last")).toBe("G")
    expect(keyLabel("inspector_full")).toBe("I")
    expect(keyLabel("search_prev")).toBe("N")
  })

  test("the first binding wins, which is the friendlier one where there are two", () => {
    expect(DEFAULT_KEYS.fold).toEqual(["left", "h"])
    expect(keyLabel("fold")).toBe("←")
    expect(keyLabel("up")).toBe("↑")
  })

  test("a sequence stays one label", () => {
    expect(keyLabel("fold_toggle")).toBe("za")
    expect(keyLabel("branch")).toBe("gb")
    expect(keyLabel("first")).toBe("gg")
  })

  test("nothing bound is the empty string — never a stale default", () => {
    expect(keyLabel("filter_prev")).toBe("")
    expect(keyLabel("branch", { branch: [] })).toBe("")
    expect(keyLabel("no_such_command")).toBe("")
  })

  test("an override wins, and is spelled by the same rules", () => {
    expect(keyLabel("branch", { branch: ["b"] })).toBe("b")
    expect(keyLabel("fold_toggle", { fold_toggle: ["ctrl+space"] })).toBe("ctrl+space")
    expect(keyLabel("crop", { crop: ["shift+c"] })).toBe("C")
  })
})

describe("rowHint", () => {
  const kinds: RowAffordance["kind"][] = ["fold-open", "fold-close", "branch-expand", "branch-switch", "crop", "restore"]

  test("names the key and what it does, on every affordance", () => {
    expect(rowHint({ kind: "fold-open" })).toBe("za open")
    expect(rowHint({ kind: "fold-close" })).toBe("za fold")
    expect(rowHint({ kind: "branch-expand" })).toBe("→ expand")
    expect(rowHint({ kind: "branch-switch" })).toBe("⏎ switch")
    expect(rowHint({ kind: "crop" })).toBe("space crop")
    expect(rowHint({ kind: "restore" })).toBe("u restore")
  })

  test("every hint is short enough to sit on a row beside its text", () => {
    for (const kind of kinds) {
      expect([...rowHint({ kind })].length, `hint for ${kind} is too wide`).toBeLessThanOrEqual(12)
    }
  })

  test("a row that affords nothing draws nothing", () => {
    expect(rowHint(undefined)).toBe("")
  })

  test("an unbound command draws nothing rather than a bare verb", () => {
    expect(rowHint({ kind: "fold-open" }, { fold_toggle: [] })).toBe("")
    expect(rowHint({ kind: "crop" }, { mark: [] })).toBe("")
  })

  test("a rebind changes the hint", () => {
    expect(rowHint({ kind: "fold-close" }, { fold_toggle: ["f2"] })).toBe("f2 fold")
    expect(rowHint({ kind: "restore" }, { undo: ["ctrl+z"] })).toBe("ctrl+z restore")
  })
})

describe("footerLine", () => {
  const HEAD = "⏎ fork & prefill this turn"
  const VERBS = ["gb branch", "gm merge", "c crop", "u undo", "gs consumers"]
  const TAIL = "? help  q/esc back"
  const at = (width: number) => footerLine(HEAD, VERBS, TAIL, width)

  test("a wide terminal keeps every verb", () => {
    expect(at(200)).toBe([HEAD, ...VERBS, TAIL].join("  "))
  })

  test("it never overflows, at any width a terminal can be", () => {
    // 40 is narrower than the route is usable at; the point is that the line is bounded
    // rather than that it is legible — an overflowing footer wraps and eats a row of tree
    for (let width = 40; width <= 200; width++) {
      const line = at(width)
      const fits = [...line].length <= width
      // the head and tail alone can be wider than a very narrow terminal: that is the floor,
      // and it is the one case the clamp cannot fix
      expect(fits || line === `${HEAD}  ${TAIL}`, `${width} cols: ${line}`).toBe(true)
    }
  })

  test("verbs go from the right, so what survives is the same prefix every time", () => {
    const widths = [200, 90, 80, 70, 60, 50]
    const survivors = widths.map((w) => VERBS.filter((v) => at(w).includes(v)).length)
    // monotonic: narrower never keeps *more*
    expect(survivors).toEqual([...survivors].sort((a, b) => b - a))
    for (const w of widths) {
      const kept = VERBS.filter((v) => at(w).includes(v))
      expect(kept, `${w} cols dropped from the middle`).toEqual(VERBS.slice(0, kept.length))
    }
  })

  test("the tail survives everything — it is the route to what was dropped", () => {
    for (let width = 40; width <= 120; width += 1) expect(at(width)).toContain("? help")
  })

  test("an unbound verb leaves no double gap", () => {
    expect(footerLine(HEAD, ["gb branch", "", "c crop"], TAIL, 200)).toBe(`${HEAD}  gb branch  c crop  ${TAIL}`)
    expect(footerLine("", [], TAIL, 200)).toBe(TAIL)
  })

  test("exactly the width fits; one column over drops the verb", () => {
    // "⏎ you are here" + "  gb branch" + "  ? help" is 33 columns on the nose
    const line = (width: number) => footerLine("⏎ you are here", ["gb branch"], "? help", width)
    expect([...line(33)].length).toBe(33)
    expect(line(33)).toContain("gb branch")
    expect(line(32)).not.toContain("gb branch")
  })
})

/**
 * `route.tsx` writes out `TextAttributes.BOLD` / `.DIM` rather than importing them: adding
 * `@opentui/core` to the TUI bundle's runtime imports made the host fail to load the route
 * entirely (the plugin has only ever imported `@opentui/solid`). This holds the two written
 * constants against the real enum, which the test process *can* import.
 */
describe("the text attribute bits route.tsx writes out", () => {
  test("still match @opentui/core", async () => {
    const { TextAttributes } = await import("@opentui/core")
    const source = readFileSync(path.join(import.meta.dir, "..", "src", "tui", "route.tsx"), "utf8")
    const bold = Number(source.match(/^const BOLD = (\d+)$/m)?.[1])
    const dim = Number(source.match(/^const DIM = (\d+)$/m)?.[1])
    expect(bold, "route.tsx no longer declares `const BOLD = <n>`").not.toBeNaN()
    expect(bold).toBe(TextAttributes.BOLD)
    expect(dim).toBe(TextAttributes.DIM)
  })

  test("the TUI bundle imports only @opentui/solid at runtime", () => {
    // dist is a build artefact; skip when it has not been built in this checkout
    const dist = path.join(import.meta.dir, "..", "dist", "tui.js")
    if (!existsSync(dist)) return
    const imports = new Set(readFileSync(dist, "utf8").match(/@opentui\/[a-z]+/g) ?? [])
    expect([...imports].sort()).toEqual(["@opentui/solid"])
  })
})
