/**
 * The one place the plugin leaves OpenCode's API: asking the GitHub CLI what state a
 * pull request is in. `gh` is spawned with an argv array (never a shell string), and only
 * for a host on the caller's allow-list (see `findPrRefs`), so neither a repo name nor a
 * host taken from tool output can steer it.
 */
import { execFile } from "node:child_process"
import { stateFromGh, type PrRef, type PrState } from "./pr.js"

export type GhLookup = { state: PrState; title?: string }

/** Why the plugin has no state to show — surfaced in the card rather than swallowed. */
export type GhFailure = "missing" | "unauthenticated" | "timeout" | "error"

export type GhResult = { ok: true; value: GhLookup } | { ok: false; failure: GhFailure; message: string }

const TIMEOUT_MS = 10_000

type ExecFailure = NodeJS.ErrnoException & { code?: number | string | null; killed?: boolean; signal?: NodeJS.Signals | null }

type RunResult = { code: number; stdout: string; stderr: string; spawnError?: ExecFailure; killed?: boolean }

function run(args: string[], cwd: string, signal?: AbortSignal): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      "gh",
      args,
      { cwd, timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024, signal, env: { ...process.env, GH_PAGER: "", NO_COLOR: "1" } },
      (error, stdout, stderr) => {
        const err = error as ExecFailure | null
        if (!err) return resolve({ code: 0, stdout, stderr })
        if (err.code === "ENOENT") return resolve({ code: -1, stdout, stderr, spawnError: err })
        // A child killed by the timeout or the abort signal never produced output. Reading
        // its absent exit code as 0 would send empty stdout down the success path, and the
        // failure would surface as "unreadable JSON" — the runtimes disagree on which of
        // `killed` / `signal` / `code` they set, so any of them counts.
        const aborted = err.killed || Boolean(err.signal) || err.code === "ABORT_ERR" || err.code === "ETIMEDOUT" || err.name === "AbortError"
        if (aborted) return resolve({ code: -1, stdout, stderr, killed: true })
        if (typeof err.code === "string") return resolve({ code: -1, stdout, stderr, spawnError: err })
        resolve({ code: typeof err.code === "number" ? err.code : -1, stdout, stderr })
      },
    )
  })
}

/** `gh pr view <n> --repo <host>/<owner>/<repo> --json state,isDraft,title`. */
export async function fetchPrState(ref: PrRef, cwd: string, signal?: AbortSignal): Promise<GhResult> {
  if (signal?.aborted) return { ok: false, failure: "timeout", message: "cancelled" }
  const { code, stdout, stderr, spawnError, killed } = await run(
    ["pr", "view", String(ref.number), "--repo", `${ref.host}/${ref.owner}/${ref.repo}`, "--json", "state,isDraft,title"],
    cwd,
    signal,
  )
  if (killed) return { ok: false, failure: "timeout", message: signal?.aborted ? "cancelled" : "gh timed out" }
  if (spawnError?.code === "ENOENT") return { ok: false, failure: "missing", message: "gh not found on PATH" }
  if (spawnError) return { ok: false, failure: "error", message: spawnError.message || String(spawnError.code) }
  if (code !== 0) {
    const message = (stderr || stdout).trim().split("\n")[0] || `gh exited ${code}`
    // `gh` says this whenever the token is absent or lacks the scope for this host.
    const unauth = /auth login|not logged|authentication|HTTP 401|gh auth/i.test(message)
    return { ok: false, failure: unauth ? "unauthenticated" : "error", message }
  }
  try {
    const parsed = JSON.parse(stdout) as { state?: string; isDraft?: boolean; title?: string }
    return { ok: true, value: { state: stateFromGh(parsed), title: parsed.title } }
  } catch {
    return { ok: false, failure: "error", message: "gh returned unreadable JSON" }
  }
}
