import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fetchPrState } from "../src/core/gh.js"

const REF = { host: "github.com", owner: "navbytes", repo: "opencode-tree", number: 20, url: "https://github.com/navbytes/opencode-tree/pull/20" }
const PATH = process.env.PATH

afterEach(() => {
  process.env.PATH = PATH
})

/** Put a scripted `gh` at the front of PATH, so the classifier can be tested without GitHub. */
function stubGh(body: string): void {
  const dir = mkdtempSync(join(tmpdir(), "git-stats-gh-"))
  const bin = join(dir, "gh")
  writeFileSync(bin, `#!/bin/sh\n${body}\n`)
  chmodSync(bin, 0o755)
  process.env.PATH = `${dir}:${PATH}`
}

describe("fetchPrState", () => {
  test("reports a missing gh rather than throwing", async () => {
    process.env.PATH = "/nonexistent-for-tests"
    expect(await fetchPrState(REF, process.cwd())).toEqual({ ok: false, failure: "missing", message: "gh not found on PATH" })
  })

  test("reads the state and title out of gh's JSON", async () => {
    stubGh(`echo '{"state":"OPEN","isDraft":true,"title":"A draft"}'`)
    expect(await fetchPrState(REF, process.cwd())).toEqual({ ok: true, value: { state: "draft", title: "A draft" } })
  })

  test("classifies a logged-out gh as unauthenticated, not a generic error", async () => {
    stubGh(`echo 'To get started with GitHub CLI, please run: gh auth login' >&2; exit 4`)
    const result = await fetchPrState(REF, process.cwd())
    expect(result).toMatchObject({ ok: false, failure: "unauthenticated" })
  })

  test("a deleted PR is an error, and keeps gh's own message", async () => {
    stubGh(`echo 'GraphQL: Could not resolve to a PullRequest with the number of 20.' >&2; exit 1`)
    const result = await fetchPrState(REF, process.cwd())
    expect(result).toMatchObject({ ok: false, failure: "error" })
    if (!result.ok) expect(result.message).toContain("Could not resolve")
  })

  test("output that is not JSON is an error, not a crash", async () => {
    stubGh(`echo 'not json at all'`)
    expect(await fetchPrState(REF, process.cwd())).toEqual({ ok: false, failure: "error", message: "gh returned unreadable JSON" })
  })

  test("a killed gh reads as a timeout, not as an empty success", async () => {
    // The child is aborted mid-run: exit code is null and only `signal`/`killed` say so.
    stubGh(`sleep 30`)
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 50)
    const result = await fetchPrState(REF, process.cwd(), controller.signal)
    expect(result).toMatchObject({ ok: false, failure: "timeout" })
  })

  test("an already-aborted signal never spawns gh at all", async () => {
    expect(await fetchPrState(REF, process.cwd(), AbortSignal.abort())).toEqual({ ok: false, failure: "timeout", message: "cancelled" })
  })

  // Opt-in: this one talks to GitHub. `GIT_STATS_GH=1 bun test` to include it.
  test.skipIf(process.env.GIT_STATS_GH !== "1")("reads a real merged pull request", async () => {
    const result = await fetchPrState(REF, process.cwd())
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.state).toBe("merged")
  })
})
