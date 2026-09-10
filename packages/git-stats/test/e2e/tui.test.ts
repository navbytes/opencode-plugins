/**
 * TUI e2e: boots the real opencode TUI in a pty with the *built* plugin (dist/tui.js) and
 * drives it through a real git repo and a real `gh`. Gated by GIT_STATS_E2E=1 — every unit
 * test the package has (91 of them) covers pure functions; nothing else exercises the
 * card actually rendering against OpenCode's own sidebar API, which is exactly what has
 * broken in the past while those stayed green.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import os from "node:os"
import path from "node:path"
import { createOpenStub, createProject, findRun, installPlugins, lastScreen, PACKAGE_DIR, runTui, sgrClick, startMock, type StartedMock } from "./harness.js"

const e2e = process.env["GIT_STATS_E2E"] === "1"

const TUI_JS = path.join(PACKAGE_DIR, "dist", "tui.js")
const PR_URL = "https://github.com/navbytes/opencode-plugins/pull/20"
const MOCK_TOOL_CMD = `echo ${PR_URL}`
// harness.ts's runTui already isolates XDG_CONFIG_HOME per run, which is where `gh` looks
// for its own config by default — so a run is "logged out" unless this points it back at
// the developer's real, already-authenticated `gh`.
const REAL_GH_CONFIG_DIR = path.join(os.homedir(), ".config", "gh")

describe.skipIf(!e2e)("git-stats TUI e2e", () => {
  beforeAll(async () => {
    const build = Bun.spawnSync({ cmd: ["bun", "run", "scripts/build.ts"], cwd: PACKAGE_DIR, stdio: ["ignore", "pipe", "pipe"] })
    if (build.exitCode !== 0) throw new Error(`build failed: ${build.stderr.toString()}`)
  })

  describe("working tree figures", () => {
    test("a dirty tree renders figures matching what git reports", async () => {
      const mock = await startMock()
      const project = await createProject({ mockPort: mock.port, dirty: true })
      try {
        await installPlugins({ projectDir: project.dir, tui: [TUI_JS] })
        // +3 tracked lines, +2 untracked (counted as all-additions): "+5 -0 · 2 files".
        const capture = await runTui({
          projectDir: project.dir,
          keys: [
            [9, "hello\\r"],
            [20, ""],
          ],
          timeoutSec: 35,
          exitWhenDone: true,
        })
        const screen = lastScreen(capture)
        expect(screen).toContain("Git Stats")
        expect(screen).toContain("⎇ main")
        expect(screen).toContain("+5 -0 · 2 files")
      } finally {
        await mock.stop()
        await project.cleanup()
      }
    }, 60_000)

    test("a clean tree renders 'working tree clean' instead of figures", async () => {
      const mock = await startMock()
      const project = await createProject({ mockPort: mock.port, dirty: false })
      try {
        await installPlugins({ projectDir: project.dir, tui: [TUI_JS] })
        const capture = await runTui({
          projectDir: project.dir,
          keys: [
            [9, "hello\\r"],
            [20, ""],
          ],
          timeoutSec: 35,
          exitWhenDone: true,
        })
        const screen = lastScreen(capture)
        expect(screen).toContain("working tree clean")
        expect(screen).not.toContain("· 0 files")
      } finally {
        await mock.stop()
        await project.cleanup()
      }
    }, 60_000)
  })

  describe("pull request chip", () => {
    let mock: StartedMock
    let project: Awaited<ReturnType<typeof createProject>>
    let located: Awaited<ReturnType<typeof runTui>>
    let chipCol: number
    let chipRow: number
    let closeCol: number

    const chipKeys: Array<[number, string]> = [
      [9, "run the tool\\r"],
      [12, "second\\r"],
      // no-op: pushes the "stop ~1s after the last key" point out far enough for the
      // plugin's own `gh pr view` call (fired the moment the tool output is ingested) to
      // land in the capture before it ends.
      [45, ""],
    ]

    beforeAll(async () => {
      mock = await startMock({ tool: true, toolCmd: MOCK_TOOL_CMD })
      project = await createProject({ mockPort: mock.port, dirty: true })
      await installPlugins({ projectDir: project.dir, tui: [TUI_JS] })
      located = await runTui({
        projectDir: project.dir,
        env: { GH_CONFIG_DIR: REAL_GH_CONFIG_DIR },
        keys: chipKeys,
        timeoutSec: 60,
        exitWhenDone: true,
      })
      const chip = findRun(located.raw, "#20 Merged")
      if (!chip) throw new Error(`chip never rendered as Merged. last screen:\n${lastScreen(located)}`)
      chipRow = chip.run.row
      chipCol = chip.run.col + Math.floor(chip.run.text.length / 2)
      // The dismiss "×" is drawn as the very next run, right after the chip's own.
      closeCol = chip.next && chip.next.text.includes("×") ? chip.next.col + 1 : chipCol + chip.run.text.length + 1
    })

    afterAll(async () => {
      await mock?.stop()
      await project?.cleanup()
    })

    test("renders as '#20 Merged' once `gh` answers", () => {
      expect(lastScreen(located)).toContain("#20 Merged")
    })

    test("carries GitHub's merged purple (48;2;130;80;223)", () => {
      // Asserted on a boolean, not the capture: `toContain` against ~60kB of raw pty
      // bytes prints the whole thing on failure and buries the result.
      const painted = located.raw.includes("\u001b[48;2;130;80;223m")
      expect({ mergedPurplePainted: painted }).toEqual({ mergedPurplePainted: true })
    })

    test("clicking the chip opens the PR", async () => {
      const openStub = await createOpenStub()
      try {
        await runTui({
          projectDir: project.dir,
          env: {
            GH_CONFIG_DIR: REAL_GH_CONFIG_DIR,
            PATH: `${openStub.dir}:${process.env["PATH"]}`,
          },
          keys: [...chipKeys.slice(0, 2), [45, sgrClick(chipCol, chipRow)], [48, ""], [53, ""]],
          timeoutSec: 65,
          exitWhenDone: true,
        })
        expect(openStub.calls()).toEqual([PR_URL])
      } finally {
        await openStub.cleanup()
      }
    }, 90_000)

    test("clicking × dismisses the chip and opens nothing", async () => {
      const openStub = await createOpenStub()
      try {
        // Screens are pyte-composed full frames (not the diff-based ANSI-stripped stream,
        // which would still show the chip's earlier paint after it is gone) — snapshot
        // index 2 is taken right before the click (key 0 and 1 are the two prompts), index
        // 3 right before the next key, ~3s after the click landed.
        const { screens } = await runTui({
          projectDir: project.dir,
          env: {
            GH_CONFIG_DIR: REAL_GH_CONFIG_DIR,
            PATH: `${openStub.dir}:${process.env["PATH"]}`,
          },
          keys: [...chipKeys.slice(0, 2), [45, sgrClick(closeCol, chipRow)], [48, ""], [53, ""]],
          timeoutSec: 65,
          exitWhenDone: true,
        })
        expect(openStub.calls()).toEqual([])
        const beforeClick = screens.find((s) => s.label.includes("timed key 2"))
        const afterClick = screens.find((s) => s.label.includes("timed key 3"))
        if (!beforeClick || !afterClick) throw new Error(`missing snapshots: ${screens.map((s) => s.label).join(" | ")}`)
        expect(beforeClick.screen).toContain("#20 Merged")
        expect(afterClick.screen).not.toContain("#20 Merged")
      } finally {
        await openStub.cleanup()
      }
    }, 90_000)
  })

  test("with `gh` logged out, the chip shows '#20 …' and the card explains why", async () => {
    const mock = await startMock({ tool: true, toolCmd: MOCK_TOOL_CMD })
    const project = await createProject({ mockPort: mock.port, dirty: true })
    try {
      await installPlugins({ projectDir: project.dir, tui: [TUI_JS] })
      // GH_CONFIG_DIR deliberately unset: `gh` falls back to XDG_CONFIG_HOME, which
      // runTui() points at a fresh, empty temp dir — `gh` is logged out there.
      const capture = await runTui({
        projectDir: project.dir,
        keys: [
          [9, "run the tool\\r"],
          [12, "second\\r"],
          [40, ""],
        ],
        timeoutSec: 55,
        exitWhenDone: true,
      })
      const screen = lastScreen(capture)
      expect(screen).toContain("#20 …")
      expect(screen).toContain("gh: run `gh auth login`")
    } finally {
      await mock.stop()
      await project.cleanup()
    }
  }, 90_000)
})
