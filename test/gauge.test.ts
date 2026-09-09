/**
 * The gauge shipped through 0.3.0-beta.2 painting every readable character in a band colour —
 * `ctx`, the bar, and `84.7k/1M · low` were one `success`-green run. On a dark theme that
 * reads; on a light one it does not, and the report was simply "this section is not legible".
 *
 * The rule that fixes it is a rule about *tokens*, not about any one theme's hex values, so it
 * is testable without a terminal: a theme guarantees `text` and `textMuted` are readable on
 * its own background; it guarantees nothing of the kind about `success` / `warning` / `error`,
 * which it picks to be distinguishable from each other.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { BAND_TOKEN, gaugeRoles, READABLE, READ_ROLES, type GaugeRoles } from "../src/core/gauge.js"
import { bandFor, type ContextBand } from "../src/core/tokens.js"

const BANDS: ContextBand[] = ["low", "healthy", "filling", "red"]

describe("no run a user reads takes a band colour", () => {
  for (const band of BANDS) {
    test(`in the ${band} band`, () => {
      const roles = gaugeRoles(band)
      for (const role of READ_ROLES) {
        expect(READABLE, `the gauge's "${role}" run is ${roles[role]} in the ${band} band — a band colour is chosen to be distinguishable, not readable`).toContain(roles[role])
      }
    })
  }

  test("the numbers are the theme's own text colour, not merely readable", () => {
    // `84.7k/1M · low` is the payload; textMuted would be legible but wrong for it
    for (const band of BANDS) expect(gaugeRoles(band).numbers).toBe("text")
  })
})

describe("the bar still carries the band", () => {
  test("the fresh run is the band's colour, and nothing else is", () => {
    for (const band of BANDS) {
      const roles = gaugeRoles(band)
      expect(roles.fresh).toBe(BAND_TOKEN[band])
      const others = (Object.keys(roles) as (keyof GaugeRoles)[]).filter((r) => r !== "fresh")
      for (const role of others) {
        expect(Object.values(BAND_TOKEN), `"${role}" also carries the band — the bar should be the only thing that does`).not.toContain(roles[role])
      }
    }
  })

  test("every band maps to a colour, and red is the alarming one", () => {
    for (const band of BANDS) expect(BAND_TOKEN[band]).toBeTruthy()
    expect(BAND_TOKEN[bandFor(100, 100)]).toBe("error")
    expect(BAND_TOKEN[bandFor(1, 100)]).toBe("success")
  })

  test("the cached and empty runs stay distinguishable from the fresh one", () => {
    for (const band of BANDS) {
      const roles = gaugeRoles(band)
      expect(new Set([roles.cached, roles.fresh, roles.empty]).size, `two of the bar's three runs share a colour in the ${band} band`).toBe(3)
    }
  })
})

describe("the components take their colours from the table", () => {
  const read = (file: string) => readFileSync(path.join(import.meta.dir, "..", "src", "tui", file), "utf8")

  test("gauge.tsx names no theme colour of its own", () => {
    // every run must go through fg("…"), or the table stops being the single source of truth
    const body = read("gauge.tsx").split("export function ContextGauge")[1] ?? ""
    expect(body.length).toBeGreaterThan(100)
    expect(body, "gauge.tsx reaches past gaugeRoles to a theme colour directly").not.toMatch(/props\.theme\.[a-zA-Z]+/)
  })

  test("no readable string is interpolated into a band-coloured element", () => {
    // `<text fg={t[BAND_TOKEN[band()]]}>{`⎇ ${name} · `}</text>` is the shape that shipped:
    // a whole label, not a glyph, wearing the band's colour
    for (const file of ["index.tsx", "gauge.tsx"]) {
      for (const line of read(file).split("\n")) {
        if (!line.includes("BAND_TOKEN[")) continue
        const content = line.match(/>\{?([^<]*)\}?<\/text>/)?.[1] ?? ""
        expect([...content.replace(/[{}`\s]/g, "")].length, `a band-coloured run in ${file} carries text, not just a glyph: ${line.trim()}`).toBeLessThanOrEqual(2)
      }
    }
  })
})
