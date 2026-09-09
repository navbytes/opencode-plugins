/**
 * TUI e2e: boots the real opencode TUI in a pty with the *built* plugin (dist/tui.js
 * + dist/server.js) and drives `/tree`. Gated by CTREE_E2E=1.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import path from "node:path"
import { tmpdir } from "node:os"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { createProject, installPlugins, REPO_ROOT, runTui, runTuiScreens, startMock, type StartedMock } from "./harness.js"

const e2e = process.env["CTREE_E2E"] === "1"

/** `CTREE_DUMP=<path>` writes the pyte-rendered screens for eyeballing a failure. A value that
 *  is not a path (`CTREE_DUMP=1`, the obvious thing to type) lands in the temp dir rather than
 *  creating a file called `1` in the repo root — which is exactly how one got committed. */
async function dumpScreens(screens: { label: string; screen: string }[]): Promise<void> {
  const want = process.env["CTREE_DUMP"]
  if (!want) return
  const file = want.includes("/") ? want : path.join(tmpdir(), "ctree-e2e-screens.txt")
  await Bun.write(file, screens.map((x) => `=== ${x.label}\n${x.screen}`).join("\n"))
  console.log(`screens → ${file}`)
}

describe.skipIf(!e2e)("tui e2e: built plugin", () => {
  let mock: StartedMock
  let project: Awaited<ReturnType<typeof createProject>>

  beforeAll(async () => {
    const build = Bun.spawnSync({ cmd: ["bun", "run", "scripts/build.ts"], cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] })
    if (build.exitCode !== 0) throw new Error(`build failed: ${build.stderr.toString()}`)
    mock = await startMock({ tool: false })
    project = await createProject({ mockPort: mock.port })
    await installPlugins({
      projectDir: project.dir,
      server: [path.join(REPO_ROOT, "dist", "server.js")],
      tui: [path.join(REPO_ROOT, "dist", "tui.js")],
    })
  })

  afterAll(async () => {
    await mock?.stop()
    await project?.cleanup()
  })

  test("crop in the tree hides a tool result from the model; undo restores it", async () => {
    const toolMock = await startMock({ tool: true })
    const proj = await createProject({ mockPort: toolMock.port })
    await installPlugins({ projectDir: proj.dir, server: [path.join(REPO_ROOT, "dist", "server.js")], tui: [path.join(REPO_ROOT, "dist", "tui.js")] })
    try {
      await runTui({
        projectDir: proj.dir,
        keys: [
          ["Ask anything", 1, "run the tool\\r"],
          ["mock reply", 2, "second\\r"],
          ["mock reply", 8, "/tree"],
          ["Context tree", 0.5, "\\r"],
          ["Context tree ·", 2, "c"],
          ["crop mode", 1, "gg"],
          ["crop mode", 2, "j"],
          ["crop mode", 3, " "],
          ["crop mode", 4.5, " "],
          ["crop mode", 6, "\\r"],
          ["Crop 1 result", 1.5, "\\r"],
          ["Crop 1 result", 4, "q"],
          ["Crop 1 result", 6, "third\\r"],
          ["Crop 1 result", 16, "/tree"],
          ["Crop 1 result", 17, "\\r"],
          ["Crop 1 result", 20, "u"],
          ["Undo?", 1.5, "\\r"],
          ["Undo?", 4, "q"],
          ["Undo?", 6, "fourth\\r"],
          ["Undo?", 16, "\\x03"],
          ["Undo?", 17, "\\x03"],
        ],
        timeoutSec: 200,
        cols: 130,
        rows: 34,
        exitWhenDone: true,
      })
      const reqs = toolMock.requests()
      const toolMsgs = reqs.map((r) => (r.body.messages as { role: string; content: unknown }[]).filter((m) => m.role === "tool").map((m) => String(m.content)))
      const third = toolMsgs.find((t) => t.some((c) => c.startsWith("[cropped: bash")))
      expect(third).toBeDefined()
      const last = toolMsgs[toolMsgs.length - 1]!
      expect(last.some((c) => c.startsWith("mock-tool-output"))).toBe(true)
      const journal = readdirSync(path.join(proj.dir, ".opencode", "context-tree")).filter((f) => f.endsWith(".jsonl"))
      const lines = readFileSync(path.join(proj.dir, ".opencode", "context-tree", journal[0]!), "utf8")
      expect(lines).toContain('"type":"crop.applied"')
      expect(lines).toContain('"type":"crop.restored"')
    } finally {
      await toolMock.stop()
      await proj.cleanup()
    }
  }, 300_000)

  test("/branch, /merge (squash via $EDITOR) lands a ◆ record in the trunk; undo re-opens", async () => {
    const m = await startMock({ tool: false })
    const proj = await createProject({ mockPort: m.port })
    await installPlugins({ projectDir: proj.dir, server: [path.join(REPO_ROOT, "dist", "server.js")], tui: [path.join(REPO_ROOT, "dist", "tui.js")] })
    try {
      await runTui({
        projectDir: proj.dir,
        env: { EDITOR: path.join(REPO_ROOT, "harness", "fake-editor.sh"), SPIKE_LOG: path.join(proj.dir, "editor.log") },
        keys: [
          ["Ask anything", 1, "hello\\r"],
          ["mock reply", 1, "/branch"],
          ["Branch here", 0.5, "\\r"],
          ["new OpenCode session", 2, "fix-flaky"],
          ["new OpenCode session", 3, "\\r"],
          ["opened", 1, "second question\\r"],
          ["opened", 8, "/merge"],
          ["Merge branch", 0.5, "\\r"],
          ["Merge ⎇", 1.5, "\\r"],
          ["merged", 3, "third\\r"],
          ["merged", 12, "/tree"],
          ["merged", 13, "\\r"],
          ["merged", 16, "u"],
          ["Undo?", 1.5, "\\r"],
          ["Undo?", 5, "\\x03"],
          ["Undo?", 6, "\\x03"],
        ],
        timeoutSec: 240,
        cols: 130,
        rows: 34,
        exitWhenDone: true,
      })
      const users = m.requests().map((r) => (r.body.messages as { role: string; content: unknown }[]).filter((x) => x.role === "user").map((x) => String(x.content)))
      const withRecord = users.find((u) => u.some((c) => c.startsWith("◆ ## Decision: fix-flaky")))
      expect(withRecord).toBeDefined()
      expect(withRecord!.some((c) => c.includes("EDITED-BY-FAKE-EDITOR"))).toBe(true)
      const dir = path.join(proj.dir, ".opencode", "context-tree")
      const lines = readFileSync(path.join(dir, readdirSync(dir).find((f) => f.endsWith(".jsonl"))!), "utf8")
      for (const t of ["decision.recorded", "branch.closed"]) expect(lines).toContain(`"type":"${t}"`)
      expect(lines.split('"type":"branch.opened"').length - 1).toBe(2) // opened, squashed, re-opened by undo
    } finally {
      await m.stop()
      await proj.cleanup()
    }
  }, 320_000)

  test("⏎ on an earlier turn offers Pi's three fork choices; summarize lands a ≣ summary in the fork", async () => {
    const m = await startMock({ tool: false })
    const proj = await createProject({ mockPort: m.port })
    await installPlugins({ projectDir: proj.dir, server: [path.join(REPO_ROOT, "dist", "server.js")], tui: [path.join(REPO_ROOT, "dist", "tui.js")] })
    try {
      const text = await runTui({
        projectDir: proj.dir,
        keys: [
          ["Ask anything", 1, "first question\r"],
          ["mock reply", 6, "second question\r"],
          ["mock reply", 14, "/tree"],
          ["Context tree", 0.5, "\r"],
          // the first user turn, three turns above the tip: ⏎ there asks Pi's question
          ["Context tree ·", 2, "gg"],
          ["Context tree ·", 3, "\r"],
          // esc on the choices goes back to the row with nothing done (Pi's showTreeSelector)
          ["Fork & prefill this turn", 1.5, "\x1b"],
          ["Context tree ·", 3, "\r"],
          // ↓ once = "Summarize everything below this point"
          ["Fork & prefill this turn", 1.5, "\x1b[B"],
          ["Summarize everything below", 1.5, "\r"],
          // the fork opens with the turn pre-filled: send it, so the model request that
          // follows is the proof the injected summary is really in the fork's context
          ["mock reply|Ask anything", 16, "\r"],
          ["mock reply|Ask anything", 16, "\x03"],
          ["", 1, "\x03"],
        ],
        timeoutSec: 240,
        cols: 130,
        rows: 34,
        exitWhenDone: true,
      })
      // all three Pi answers, in Pi's order, from the one dialog ⏎ opens
      expect(text).toContain("Fork & prefill this turn")
      expect(text).toContain("No summary")
      expect(text).toContain("Summarize everything below this point")
      expect(text).toContain("Summarize with a custom prompt")

      const dir = path.join(proj.dir, ".opencode", "context-tree")
      const lines = readFileSync(path.join(dir, readdirSync(dir).find((f) => f.endsWith(".jsonl"))!), "utf8")
      // the escape round changed nothing: exactly one fork, from the one ⏎ we went through with
      expect(lines.split('"type":"branch.opened"').length - 1).toBe(1)
      expect(lines).toContain('"kind":"redo"')
      expect(lines).toContain('"type":"summary.recorded"')
      // the summary was drafted from the abandoned turns, and the fork's next model request
      // carries it: injected with noReply, it only reaches the provider on the following turn
      const users = m.requests().map((r) => (r.body.messages as { role: string; content: unknown }[]).filter((x) => x.role === "user").map((x) => String(x.content)))
      expect(users.some((u) => u.some((c) => c.includes("Create a structured summary of this conversation branch")))).toBe(true)
      expect(users.some((u) => u.some((c) => c.startsWith("The user explored a different conversation branch")))).toBe(true)
    } finally {
      await m.stop()
      await proj.cleanup()
    }
  }, 320_000)

  test("esc in the custom-prompt editor loops back to Pi's choices instead of cancelling the whole jump", async () => {
    const m = await startMock({ tool: false })
    const proj = await createProject({ mockPort: m.port })
    await installPlugins({ projectDir: proj.dir, server: [path.join(REPO_ROOT, "dist", "server.js")], tui: [path.join(REPO_ROOT, "dist", "tui.js")] })
    try {
      const { screens } = await runTuiScreens({
        projectDir: proj.dir,
        keys: [
          ["Ask anything", 1, "first question\r"],
          ["mock reply", 6, "second question\r"],
          ["mock reply", 14, "/tree"],
          ["Context tree", 0.5, "\r"],
          ["Context tree ·", 2, "gg"],
          ["Context tree ·", 3, "\r"],
          // ↓↓ = "Summarize with a custom prompt"
          ["Fork & prefill this turn", 1.5, "\x1b[B\x1b[B"],
          ["Summarize with a custom prompt", 1, "\r"],
          // the DialogPrompt's own title never lands as one contiguous run in the raw
          // ANSI-stripped stream (its text-cursor widget repaints unlike a plain title), so
          // wait on a single word from it instead of the full phrase
          ["instructions", 2, "focus on x"],
          // esc here must return to the 3-choice picker, not cancel the whole jump
          ["instructions", 1, "\x1b"],
          ["instructions", 2, "\r"],
          // confirms we really landed back on a live picker (not a dangling, unresolved
          // promise): finish the flow by picking "No summary" and sending the prefilled turn
          ["mock reply|Ask anything", 16, "\r"],
          ["mock reply|Ask anything", 16, "\x03"],
          ["", 1, "\x03"],
        ],
        timeoutSec: 240,
        cols: 130,
        rows: 34,
        exitWhenDone: true,
      })
      const afterEsc = screens.find((s) => s.label.includes("conditional key 10"))
      expect(afterEsc).toBeDefined()
      expect(afterEsc!.screen).toContain("Fork & prefill this turn?")
      expect(afterEsc!.screen).not.toContain("Custom summarization instructions")

      const dir = path.join(proj.dir, ".opencode", "context-tree")
      const lines = readFileSync(path.join(dir, readdirSync(dir).find((f) => f.endsWith(".jsonl"))!), "utf8")
      // the detour through the custom-prompt editor changed nothing else: exactly one fork
      expect(lines.split('"type":"branch.opened"').length - 1).toBe(1)
    } finally {
      await m.stop()
      await proj.cleanup()
    }
  }, 320_000)

  test("the server captures the real system prompt; consumers shows it as a bucket", async () => {
    const m = await startMock({ tool: false })
    const proj = await createProject({ mockPort: m.port })
    await installPlugins({ projectDir: proj.dir, server: [path.join(REPO_ROOT, "dist", "server.js")], tui: [path.join(REPO_ROOT, "dist", "tui.js")] })
    try {
      const log = path.join(proj.dir, "ctree-debug.log")
      const { screens } = await runTuiScreens({
        projectDir: proj.dir,
        env: { CTREE_DEBUG: log },
        keys: [
          // a plain session that never branches: the case the capture must not miss
          ["Ask anything", 1, "hello\r"],
          ["mock reply", 8, "/tree"],
          ["Context tree", 0.5, "\r"],
          ["Context tree ·", 2, "gs"],
          ["what's filling|consumers", 3, "\x03"],
          ["", 1, "\x03"],
        ],
        timeoutSec: 180,
        cols: 130,
        rows: 34,
        exitWhenDone: true,
      })

      // 1. the assumption the whole feature rests on: `output.system` arrives carrying
      //    OpenCode's own parts, so there is something real to snapshot
      const debugLog = existsSync(log) ? readFileSync(log, "utf8") : "(no debug log)"
      const dir = path.join(proj.dir, ".opencode", "context-tree")
      if (!existsSync(dir)) throw new Error(`no context-tree dir. debug log:\n${debugLog.split("\n").filter((l) => l.includes("system")).join("\n") || debugLog.slice(0, 2000)}`)
      const snap = readdirSync(dir).find((f) => f.startsWith("system-") && f.endsWith(".json"))
      expect(snap).toBeDefined()
      const parsed = JSON.parse(readFileSync(path.join(dir, snap!), "utf8")) as { v: number; parts: { name: string; chars: number; text: string }[] }
      expect(parsed.v).toBe(1)
      expect(parsed.parts.length).toBeGreaterThan(0)
      expect(parsed.parts.reduce((n, p) => n + p.chars, 0)).toBeGreaterThan(200)

      // 2. our own note is NOT in the snapshot: it is captured before we push it
      expect(parsed.parts.some((p) => p.text.startsWith("Context notes:"))).toBe(false)

      // 3. and it reaches the consumers view. Assert against the pyte-rendered screen, not
      //    the raw stream: the panel is painted cell-by-cell, so no label lands there whole.
      const consumers = screens.find((s) => s.screen.includes("what's filling the context"))
      if (!consumers) throw new Error(`consumers panel never rendered. screens: ${screens.map((s) => s.label).join(" | ")}`)
      expect(consumers.screen).toContain("≡ system prompt")
    } finally {
      await m.stop()
      await proj.cleanup()
    }
  }, 300_000)

  test("the fold verbs fire, l opens a fold, and the cursor row names the key", async () => {
    // the fold keys are two-stroke sequences, which nothing else in the keymap was until now:
    // this test exists to prove they really fire against the real TUI — and, since the pane
    // and the row hint both build their text from the live keymap, that the hint arrives on
    // the cursor's row and nowhere else
    const toolMock = await startMock({ tool: true })
    const proj = await createProject({ mockPort: toolMock.port })
    await installPlugins({ projectDir: proj.dir, server: [path.join(REPO_ROOT, "dist", "server.js")], tui: [path.join(REPO_ROOT, "dist", "tui.js")] })
    try {
      const { screens } = await runTuiScreens({
        projectDir: proj.dir,
        keys: [
          ["Ask anything", 1, "run the tool\r"],
          ["mock reply", 8, "second\r"],
          ["mock reply", 16, "/tree"],
          ["Context tree", 0.5, "\r"],
          ["Context tree ·", 2.5, "gg"],
          ["Context tree ·", 3.5, "za"],
          ["Context tree ·", 5, "zm"],
          ["Context tree ·", 6.5, "l"],
          ["Context tree ·", 8, "zr"],
          ["Context tree ·", 9.5, "q"],
          ["Ask anything|mock reply", 1, "\x03"],
          ["", 1, "\x03"],
        ],
        timeoutSec: 180,
        cols: 130,
        rows: 34,
        exitWhenDone: true,
      })
      await dumpScreens(screens)
      // screens are captured *before* each key, so key N's screen is the state key N-1 left:
      // assert the state itself rather than the notice, which has a lifetime of its own
      const before = (key: number) => {
        const hit = screens.find((x) => x.label.includes(`conditional key ${key}`))
        if (!hit) throw new Error(`no screen before key ${key}. screens: ${screens.map((x) => x.label).join(" | ")}`)
        return hit.screen
      }
      const STEP = "⚙ [bash"
      const FOLDED_FIRST = "● ▸2 user: run the tool"
      // The tree opens on the default posture: the turn you are in is open, everything above
      // it is scrollback, folded. Only the first turn ran tools here, so it is the only row
      // with a fold at all — the second turn owns nothing and never grows a ▸.
      expect(before(4)).toContain(FOLDED_FIRST)
      expect(before(4)).not.toContain(STEP)
      // the marker is the row's left edge, between the ● and the preview — not a digest
      // trailing a clipped preview, and never a second copy of the token column
      expect(before(4)).toMatch(/● ▸2 user: run the tool/)
      expect(before(4)).not.toMatch(/▸\s*\d+ steps/)
      expect(before(4)).toContain("● user: second ")
      // gg puts the cursor on that folded turn, and the row says what it affords in the key
      // that actually does it — on that row only, so a search over row text never sees it
      expect(before(5)).toContain("za open")
      expect(before(5).match(/za open/g)?.length ?? 0).toBe(1)
      // za opens it; the hint on the same row flips to the other direction
      expect(before(6)).toContain(STEP)
      expect(before(6)).not.toContain(FOLDED_FIRST)
      expect(before(6)).toContain("za fold")
      // zm folds them all again, hand-opened turns included
      expect(before(7)).not.toContain(STEP)
      expect(before(7)).toContain(FOLDED_FIRST)
      expect(before(7)).toContain("za open")
      // `l` is vim's foldopen=hor: a horizontal move opens the fold under the cursor. This
      // key did nothing at all on a turn row before, which is why it was free to mean this.
      expect(before(8)).toContain(STEP)
      expect(before(8)).not.toContain(FOLDED_FIRST)
      // zr opens every fold there is, so nothing is left standing in for hidden rows.
      // `▸\d` rather than a bare caret: a collapsed *branch* row draws ▸ too.
      expect(before(9)).toContain(STEP)
      expect(before(9)).not.toMatch(/▸\d/)
    } finally {
      await toolMock.stop()
      await proj.cleanup()
    }
  }, 300_000)

  test("a summary that takes seconds shows a live progress line while it runs", async () => {
    // The mock answers instantly, which is why no earlier test watched the tree *during* a
    // draft at all. Holding the summary request back pins the two things a user reports when
    // they say "no feedback": that the line is up straight away (0.3s in, not whenever
    // something else repaints), and that it is still moving while the model thinks.
    const m = await startMock({ tool: false, slowSummaryMs: 20000 })
    const proj = await createProject({ mockPort: m.port })
    await installPlugins({ projectDir: proj.dir, server: [path.join(REPO_ROOT, "dist", "server.js")], tui: [path.join(REPO_ROOT, "dist", "tui.js")] })
    try {
      const { screens } = await runTuiScreens({
        projectDir: proj.dir,
        keys: [
          ["Ask anything", 1, "first question\r"],
          ["mock reply", 8, "second question\r"],
          ["mock reply", 16, "/tree"],
          ["Context tree", 0.5, "\r"],
          ["Context tree ·", 2, "gg"],
          ["Context tree ·", 3, "\r"],
          // ↓ once = "Summarize everything below this point"
          ["Fork & prefill this turn", 1.5, "\x1b[B"],
          ["Summarize everything below", 1, "\r"],
          // four screens half a second apart while the summary is still in flight: close
          // enough that only a *live* line changes between them (the spinner turns every
          // 120ms), which is the thing OpenCode's on-demand renderer does not do by itself
          ["Summarize everything below", 0.3, ""],
          ["Summarize everything below", 0.5, ""],
          ["Summarize everything below", 0.5, ""],
          ["Summarize everything below", 0.5, ""],
          ["mock reply|Ask anything", 20, "\x03"],
          ["", 1, "\x03"],
        ],
        timeoutSec: 240,
        cols: 130,
        rows: 34,
        exitWhenDone: true,
      })
      await dumpScreens(screens)
      // the first sample is 0.3s after the choice: the line has to be up *immediately*, not
      // whenever something else happens to repaint the screen
      const inFlight = screens.filter((x) => x.label.includes("conditional key 8") || x.label.includes("conditional key 9") || x.label.includes("conditional key 10") || x.label.includes("conditional key 11"))
      expect(inFlight.length).toBe(4)
      const during = inFlight.filter((x) => x.screen.includes("summarizing"))
      if (during.length < 4) throw new Error(`the progress line was missing from ${4 - during.length} of the 4 in-flight samples: ${inFlight.map((x) => (x.screen.includes("summarizing") ? "line" : "NOTHING")).join(" ")}`)
      expect(during.every((x) => x.screen.includes("esc cancels"))).toBe(true)

      // It is *live*: the spinner has turned between these half-second samples. Without a
      // frame request the line is drawn once and then sits frozen until something unrelated
      // repaints — which is exactly what "no feedback" looked like.
      const frames = during.map((x) => /([⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]) summarizing/.exec(x.screen)?.[1]).filter((v): v is string => v !== undefined)
      if (process.env["CTREE_DUMP"]) console.log(`spinner frames across ${during.length} samples: ${frames.join(" ")}`)
      expect(frames.length).toBe(during.length)
      // two of four is enough to prove it moved: at 8 frames a second, samples half a second
      // apart alias against the 10-frame cycle, so "all four differ" would be flaky
      expect(new Set(frames).size).toBeGreaterThan(1)
    } finally {
      await m.stop()
      await proj.cleanup()
    }
  }, 300_000)

  test("the ? pane teaches the verbs, and scrolls to the rest", async () => {
    const m = await startMock({ tool: false })
    const proj = await createProject({ mockPort: m.port })
    await installPlugins({ projectDir: proj.dir, server: [path.join(REPO_ROOT, "dist", "server.js")], tui: [path.join(REPO_ROOT, "dist", "tui.js")] })
    try {
      const { screens } = await runTuiScreens({
        projectDir: proj.dir,
        keys: [
          ["Ask anything", 1, "hello\r"],
          ["mock reply", 8, "/tree"],
          ["Context tree", 0.5, "\r"],
          ["Context tree ·", 2, "?"],
          ["Context tree ·", 2, "\x1b[6~"],
          ["Context tree ·", 2, "\x1b[6~"],
          ["Context tree ·", 2, "q"],
          ["Ask anything|mock reply", 1, "\x03"],
          ["", 1, "\x03"],
        ],
        timeoutSec: 180,
        cols: 130,
        rows: 30,
        exitWhenDone: true,
      })
      await dumpScreens(screens)
      const seen = (needle: string) => screens.some((x) => x.screen.includes(needle))
      // the pane opens on what the tool is and what each verb is for
      if (!seen("nothing here rewrites your transcript")) throw new Error(`the ? pane never opened. screens: ${screens.map((x) => x.label).join(" | ")}`)
      expect(seen("gb branch — try something risky")).toBe(true)
      // a 30-row terminal cannot hold it, so it says so and PgDn reaches the rest
      expect(seen("PgUp/PgDn scroll")).toBe(true)
      if (!seen("gs consumers — what is actually filling")) throw new Error("PgDn never reached the Views section of the ? pane")
    } finally {
      await m.stop()
      await proj.cleanup()
    }
  }, 300_000)

  test("the g-prefixed verbs fire alongside gg", async () => {
    // `gg` was the only sequence in the keymap; the realignment put every plugin verb behind
    // `g`, so this proves the sequence tree branches rather than `gg` shadowing them
    const m = await startMock({ tool: false })
    const proj = await createProject({ mockPort: m.port })
    await installPlugins({ projectDir: proj.dir, server: [path.join(REPO_ROOT, "dist", "server.js")], tui: [path.join(REPO_ROOT, "dist", "tui.js")] })
    try {
      const { screens } = await runTuiScreens({
        projectDir: proj.dir,
        keys: [
          ["Ask anything", 1, "hello\r"],
          ["mock reply", 8, "/tree"],
          ["Context tree", 0.5, "\r"],
          ["Context tree ·", 2, "gs"],
          ["Context tree ·", 4, "gs"],
          ["Context tree ·", 5.5, "gd"],
          ["Context tree ·", 7, "gd"],
          ["Context tree ·", 8.5, "gg"],
          ["Context tree ·", 10, "q"],
          ["Ask anything|mock reply", 1, "\x03"],
          ["", 1, "\x03"],
        ],
        timeoutSec: 180,
        cols: 130,
        rows: 34,
        exitWhenDone: true,
      })
      const seen = (needle: string) => screens.some((x) => x.screen.includes(needle))
      // gs opens the consumers panel, gd the decisions panel — and gg still goes to the top
      if (!seen("what's filling the context")) throw new Error(`gs never fired. screens: ${screens.map((x) => x.label).join(" | ")}`)
      if (!seen("decisions on this tree")) throw new Error(`gd never fired. screens: ${screens.map((x) => x.label).join(" | ")}`)
      // and the panels toggle back off, so the tree is still there afterwards
      expect(seen("Context tree ·")).toBe(true)
    } finally {
      await m.stop()
      await proj.cleanup()
    }
  }, 300_000)

  test("/tree opens the context tree route with rows and a context header", async () => {
    const text = await runTui({
      projectDir: project.dir,
      keys: [
        ["Ask anything", 1, "hello\\r"],
        ["mock reply", 1, "/tree"],
        ["Context tree", 0.5, "\\r"],
        ["Context tree ·", 2, "q"],
        ["Ask anything|mock reply", 1, "\\x03"],
        ["", 1, "\\x03"],
      ],
      timeoutSec: 120,
      exitWhenDone: true,
      cols: 120,
      rows: 30,
    })
    expect(text).toContain("Context tree ·")
    expect(text).toContain("ctx ")
    expect(text).not.toMatch(/tui\.plugin.*error/i)
    expect(mock.requests().length).toBeGreaterThan(0)
  }, 90_000)
})
