/**
 * Shared plumbing for the e2e layer (test/e2e/*.test.ts): boot the real interactive
 * `opencode` TUI in a pty, against `harness/`'s mock OpenAI-compatible provider, with the
 * *built* git-stats plugin (dist/tui.js) — in throw-away temp dirs so tests never touch the
 * developer's real OpenCode config, a shared fixture, or the checked-in harness/ itself.
 *
 * Adapted from packages/context-tree/test/e2e/harness.ts, trimmed to what a TUI-only
 * plugin needs (no headless `opencode serve` / server plugin here), plus two additions
 * git-stats' own assertions need: a stub `open` on PATH, and a parser that turns the raw
 * pty capture's cursor-position escapes into clickable (row, col) coordinates.
 */
import { existsSync, readFileSync, writeFileSync, appendFileSync, chmodSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

export const REPO_ROOT = path.resolve(import.meta.dir, "../../../..")
export const HARNESS_DIR = path.join(REPO_ROOT, "harness")
// Where this package's own scripts/build.ts and dist/ live.
export const PACKAGE_DIR = path.resolve(import.meta.dir, "../..")

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Picks a free TCP port by opening then immediately closing a listener on port 0. */
export function freePort(): number {
  const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } })
  const port = listener.port
  listener.stop(true)
  return port
}

async function run(cmd: string[], cwd: string, env?: Record<string, string | undefined>): Promise<void> {
  const proc = Bun.spawn({ cmd, cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] })
  const code = await proc.exited
  if (code !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`command failed (${code}): ${cmd.join(" ")}\n${stderr}`)
  }
}

// ---------------------------------------------------------------------------
// The `opencode` binary itself: cached (and shared with context-tree's e2e suite)
// under harness/node_modules, since it is just an install cache, not a fixture.
// ---------------------------------------------------------------------------

export const OPENCODE_VERSION = process.env["GIT_STATS_OPENCODE_VERSION"] || "1.18.26"

function installedOpencodeVersion(): string | undefined {
  try {
    return JSON.parse(readFileSync(path.join(HARNESS_DIR, "node_modules/opencode-ai/package.json"), "utf8")).version as string
  } catch {
    return undefined
  }
}

export async function ensureOpencode(): Promise<string> {
  const bin = path.join(HARNESS_DIR, "node_modules/.bin/opencode")
  if (!existsSync(bin) || installedOpencodeVersion() !== OPENCODE_VERSION) {
    const pkgJson = path.join(HARNESS_DIR, "package.json")
    if (!existsSync(pkgJson)) {
      writeFileSync(pkgJson, JSON.stringify({ name: "harness", version: "1.0.0", private: true }, null, 2) + "\n")
    }
    const proc = Bun.spawn({
      cmd: ["npm", "i", `opencode-ai@${OPENCODE_VERSION}`],
      cwd: HARNESS_DIR,
      stdio: ["inherit", "inherit", "inherit"],
    })
    const code = await proc.exited
    if (code !== 0) throw new Error(`npm i opencode-ai@${OPENCODE_VERSION} failed in ${HARNESS_DIR} (exit ${code})`)
  }
  if (!existsSync(bin)) throw new Error(`opencode binary still missing at ${bin} after install`)
  return bin
}

// ---------------------------------------------------------------------------
// Mock provider
// ---------------------------------------------------------------------------

export interface StartedMock {
  port: number
  stop(): Promise<void>
}

export interface StartMockOptions {
  /** MOCK_TOOL=1: the mock answers a prompt starting with "run the tool" with a scripted bash call. */
  tool?: boolean
  /** The shell command the scripted bash call runs (MOCK_TOOL_CMD). */
  toolCmd?: string
  port?: number
}

export async function startMock(opts: StartMockOptions = {}): Promise<StartedMock> {
  const port = opts.port ?? freePort()
  const dir = await mkdtemp(path.join(tmpdir(), "gitstats-e2e-mock-"))
  const logFile = path.join(dir, "requests.jsonl")
  writeFileSync(logFile, "")

  const proc = Bun.spawn({
    cmd: ["node", path.join(HARNESS_DIR, "mock-provider.mjs")],
    env: {
      ...process.env,
      MOCK_PORT: String(port),
      MOCK_LOG: logFile,
      MOCK_TOOL: opts.tool ? "1" : "0",
      ...(opts.toolCmd ? { MOCK_TOOL_CMD: opts.toolCmd } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  })

  const base = `http://127.0.0.1:${port}`
  const start = Date.now()
  for (;;) {
    try {
      const res = await fetch(`${base}/v1/models`)
      if (res.ok) break
    } catch {}
    if (Date.now() - start > 10_000) throw new Error(`mock provider did not come up on ${base}`)
    await sleep(100)
  }

  return {
    port,
    async stop() {
      proc.kill()
      await proc.exited
      await rm(dir, { recursive: true, force: true })
    },
  }
}

// ---------------------------------------------------------------------------
// Fixture git repos (temp dirs — harness/project is a shared manual fixture and is
// never touched by this suite)
// ---------------------------------------------------------------------------

export interface CreateProjectOptions {
  /** Port of a running mock provider. */
  mockPort: number
  /** A dirty working tree: the tracked file grows by 3 lines, plus a 2-line untracked
   *  file — `git`/OpenCode's vcs.status count untracked files as all-additions, so this
   *  is chosen to land on a known total: "+5 -0 · 2 files". Defaults to a clean tree. */
  dirty?: boolean
}

export async function createProject(opts: CreateProjectOptions): Promise<{ dir: string; cleanup(): Promise<void> }> {
  const dir = await mkdtemp(path.join(tmpdir(), "gitstats-e2e-project-"))

  const config = {
    $schema: "https://opencode.ai/config.json",
    provider: {
      mock: {
        npm: "@ai-sdk/openai-compatible",
        name: "Mock",
        options: { baseURL: `http://127.0.0.1:${opts.mockPort}/v1`, apiKey: "x" },
        models: {
          "mock-a": { name: "mock-a", limit: { context: 200_000, output: 8192 }, tool_call: true },
        },
      },
    },
    model: "mock/mock-a",
    permission: { bash: "allow", edit: "allow" },
    share: "disabled",
  }
  writeFileSync(path.join(dir, "opencode.json"), JSON.stringify(config, null, 2) + "\n")

  await run(["git", "init", "-q"], dir)
  await run(["git", "config", "user.email", "e2e@git-stats.test"], dir)
  await run(["git", "config", "user.name", "git-stats e2e"], dir)
  writeFileSync(path.join(dir, "tracked.txt"), "line1\nline2\nline3\n")
  // installPlugins() writes .opencode/tui.json *after* this commit — ignored, so it never
  // shows up as an untracked file and skews the figures the tests assert on.
  writeFileSync(path.join(dir, ".gitignore"), ".opencode/\n")
  await run(["git", "add", "-A"], dir)
  await run(["git", "commit", "-q", "-m", "init"], dir, { GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z" })

  if (opts.dirty) {
    appendFileSync(path.join(dir, "tracked.txt"), "line4\nline5\nline6\n")
    writeFileSync(path.join(dir, "untracked.txt"), "extra1\nextra2\n")
  }

  return {
    dir,
    async cleanup() {
      await rm(dir, { recursive: true, force: true })
    },
  }
}

/** Writes .opencode/tui.json listing the built plugin(s) — git-stats has no server half. */
export async function installPlugins(opts: { projectDir: string; tui: string[] }): Promise<void> {
  const tuiDir = path.join(opts.projectDir, ".opencode")
  await Bun.write(path.join(tuiDir, ".keep"), "")
  writeFileSync(
    path.join(tuiDir, "tui.json"),
    JSON.stringify({ $schema: "https://opencode.ai/tui.json", plugin: opts.tui }, null, 2) + "\n",
  )
}

// ---------------------------------------------------------------------------
// A stub `open` on PATH: records every invocation's argv instead of launching a browser.
// ---------------------------------------------------------------------------

export interface OpenStub {
  /** Prepend this to PATH so the stub shadows the real `open`/`xdg-open`. */
  dir: string
  calls(): string[]
  cleanup(): Promise<void>
}

export async function createOpenStub(): Promise<OpenStub> {
  const dir = await mkdtemp(path.join(tmpdir(), "gitstats-e2e-open-"))
  const logFile = path.join(dir, "calls.log")
  writeFileSync(logFile, "")
  const bin = path.join(dir, "open")
  writeFileSync(bin, `#!/bin/sh\necho "$@" >> ${JSON.stringify(logFile)}\nexit 0\n`)
  chmodSync(bin, 0o755)
  return {
    dir,
    calls() {
      const raw = existsSync(logFile) ? readFileSync(logFile, "utf8") : ""
      return raw.split("\n").filter((l) => l.trim().length > 0)
    },
    async cleanup() {
      await rm(dir, { recursive: true, force: true })
    },
  }
}

// ---------------------------------------------------------------------------
// TUI (scripted pty run of the interactive `opencode` binary)
// ---------------------------------------------------------------------------

export interface RunTuiOptions {
  projectDir: string
  env?: Record<string, string>
  /** [delaySeconds, text] pairs; text uses pty-run.py's escapes verbatim, e.g. "hello\\r",
   *  "\\x1b". A trailing pair with empty text is just a timestamp — it sends nothing, but
   *  (with exitWhenDone) delays the "stop ~1s after the last key" point, giving async work
   *  (a `gh` call, a click's side effect) room to land in the capture. */
  keys: Array<[number, string]>
  exitWhenDone?: boolean
  timeoutSec?: number
  cols?: number
  rows?: number
}

export interface TuiCapture {
  /** ANSI-stripped capture (misses redraws — prefer `screens` for anything that repaints). */
  text: string
  /** The raw pty bytes, unmodified: the only place SGR/OSC codes (colours, cursor moves,
   *  hyperlinks) survive. */
  raw: string
  /** pyte-composed screens, one before each key and one at the end. */
  screens: { label: string; screen: string }[]
}

/** Runs the interactive TUI in a pty with scripted keystrokes against fresh, isolated XDG
 *  dirs — a leftover kv.json or gh config under the developer's real HOME must never leak in. */
export async function runTui(opts: RunTuiOptions): Promise<TuiCapture> {
  const bin = await ensureOpencode()
  const outDir = await mkdtemp(path.join(tmpdir(), "gitstats-e2e-pty-"))
  const outFile = path.join(outDir, "pty.out")
  const xdgRoot = await mkdtemp(path.join(tmpdir(), "gitstats-e2e-xdg-"))

  const args = [
    path.join(HARNESS_DIR, "pty-run.py"),
    "--cols",
    String(opts.cols ?? 140),
    "--rows",
    String(opts.rows ?? 40),
    "--timeout",
    String(opts.timeoutSec ?? 60),
    "--out",
    outFile,
  ]
  for (const [delay, text] of opts.keys) args.push("--keys", `${delay}:${text}`)
  if (opts.exitWhenDone) args.push("--exit-when-done")
  args.push("--", bin)

  const proc = Bun.spawn({
    cmd: ["python3", ...args],
    cwd: opts.projectDir,
    env: {
      ...process.env,
      XDG_DATA_HOME: path.join(xdgRoot, "data"),
      XDG_CONFIG_HOME: path.join(xdgRoot, "config"),
      XDG_STATE_HOME: path.join(xdgRoot, "state"),
      XDG_CACHE_HOME: path.join(xdgRoot, "cache"),
      OPENCODE_DISABLE_AUTOUPDATE: "1",
      OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
      OPENCODE_DISABLE_PRUNE: "1",
      // Otherwise opentui quantises to 256 colours, and the merged-PR purple assertion
      // (`48;2;130;80;223`) never appears even against a correctly-rendering plugin.
      COLORTERM: "truecolor",
      TERM: "xterm-256color",
      ...opts.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  await proc.exited

  const text = existsSync(`${outFile}.txt`) ? readFileSync(`${outFile}.txt`, "utf8") : ""
  const raw = existsSync(outFile) ? readFileSync(outFile, "utf8") : ""
  const screensRaw = existsSync(`${outFile}.screens.txt`) ? readFileSync(`${outFile}.screens.txt`, "utf8") : ""
  const screens = screensRaw
    .split("\n===== ")
    .filter((s) => s.trim())
    .map((s) => {
      const nl = s.indexOf(" =====\n")
      return { label: s.slice(0, nl), screen: s.slice(nl + 7) }
    })
  await rm(outDir, { recursive: true, force: true }).catch(() => {})
  await rm(xdgRoot, { recursive: true, force: true }).catch(() => {})
  return { text, raw, screens }
}

// ---------------------------------------------------------------------------
// Locating a widget on screen from the raw capture, for a scripted SGR mouse click.
// ---------------------------------------------------------------------------

export interface ScreenRun {
  row: number
  col: number
  text: string
}

// Cursor-position (`CSI row;colH`) immediately followed by zero or more SGR colour codes,
// then the literal text opentui drew there — repeated throughout the raw stream, since
// each redraw repositions the cursor before every run of same-styled cells.
const RUN_RE = /\x1b\[(\d+);(\d+)H(?:\x1b\[[0-9;]*m)*([^\x1b]+)/g

/** Every (row, col, text) run in a raw pty capture, in stream order. */
export function screenRuns(raw: string): ScreenRun[] {
  const out: ScreenRun[] = []
  RUN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = RUN_RE.exec(raw))) out.push({ row: Number(m[1]), col: Number(m[2]), text: m[3]! })
  return out
}

/** The last run (closest to the end of the capture — the final, settled paint) whose text
 *  contains `needle`, and the run drawn immediately after it (e.g. the chip's `×`). */
export function findRun(raw: string, needle: string): { run: ScreenRun; next?: ScreenRun } | undefined {
  const runs = screenRuns(raw)
  for (let i = runs.length - 1; i >= 0; i--) {
    if (runs[i]!.text.includes(needle)) return { run: runs[i]!, next: runs[i + 1] }
  }
  return undefined
}

/** An SGR (`\x1b[<...`) mouse click — press then release — at 1-based (col, row), in
 *  pty-run.py's backslash-escaped key text form. */
export function sgrClick(col: number, row: number): string {
  return `\\x1b[<0;${col};${row}M\\x1b[<0;${col};${row}m`
}

/** The last pyte-composed screen (the fully settled frame at capture's end) — the
 *  reliable thing to assert literal text against; `text` is diff-based and can split a
 *  label across two writes that never land adjacent in the ANSI-stripped stream. */
export function lastScreen(capture: TuiCapture): string {
  return capture.screens[capture.screens.length - 1]?.screen ?? ""
}
