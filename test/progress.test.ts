import { describe, expect, test } from "bun:test"
import { SPINNER_FRAMES, SPINNER_MS, draftDetail, draftSection, formatChars, formatElapsed, formatProgress, spinnerFrame } from "../src/core/progress.js"

describe("spinnerFrame", () => {
  test("advances one frame per SPINNER_MS and wraps", () => {
    expect(spinnerFrame(0)).toBe(SPINNER_FRAMES[0])
    expect(spinnerFrame(SPINNER_MS)).toBe(SPINNER_FRAMES[1])
    expect(spinnerFrame(SPINNER_MS * SPINNER_FRAMES.length)).toBe(SPINNER_FRAMES[0])
  })
  test("a clock that went backwards still draws a frame", () => {
    expect(spinnerFrame(-500)).toBe(SPINNER_FRAMES[0])
  })
})

describe("formatElapsed", () => {
  test("seconds under a minute, from the first frame", () => {
    expect(formatElapsed(0)).toBe("0s")
    expect(formatElapsed(4_400)).toBe("4s")
    expect(formatElapsed(59_000)).toBe("59s")
  })
  test("minutes past one", () => {
    expect(formatElapsed(60_000)).toBe("1m00s")
    expect(formatElapsed(64_000)).toBe("1m04s")
    expect(formatElapsed(605_000)).toBe("10m05s")
  })
})

describe("draftSection", () => {
  test("the last markdown heading the model has opened", () => {
    expect(draftSection("## Goal\nship it\n\n## Progress\n### Done\n- [x] x")).toBe("Done")
  })
  test("bold field labels, as the ◆ record template writes them", () => {
    expect(draftSection("## Decision: try-redis\n**Outcome:** kept it in memory\n**Why:**")).toBe("Why")
  })
  test("nothing yet", () => {
    expect(draftSection("")).toBeUndefined()
    expect(draftSection("a paragraph with **bold** in the middle")).toBeUndefined()
  })
})

describe("formatChars", () => {
  test("exact under a thousand, one decimal above", () => {
    expect(formatChars(0)).toBe("0 chars")
    expect(formatChars(412)).toBe("412 chars")
    expect(formatChars(1_440)).toBe("1.4k chars")
  })
})

describe("draftDetail", () => {
  test("the section being written and how much there is", () => {
    expect(draftDetail("## Goal\nship it")).toBe("Goal · 15 chars")
  })
  test("size alone before the first heading", () => {
    expect(draftDetail("thinking")).toBe("8 chars")
  })
  test("an empty draft has nothing to add to the label", () => {
    expect(draftDetail("")).toBeUndefined()
    expect(draftDetail("   \n ")).toBeUndefined()
  })
})

describe("formatProgress", () => {
  test("spinner, label, detail, elapsed and the way out", () => {
    expect(formatProgress({ label: "summarizing 3 turns · ~14k", detail: "Progress · 412 chars", hint: "esc cancels", startedAt: 1_000 }, 5_000)).toBe(
      "⠸ summarizing 3 turns · ~14k · Progress · 412 chars · 4s · esc cancels",
    )
  })
  test("label and elapsed are enough on their own", () => {
    expect(formatProgress({ label: "forking the new branch", startedAt: 1_000 }, 1_000)).toBe("⠋ forking the new branch · 0s")
  })
})
