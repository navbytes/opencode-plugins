import { describe, expect, test } from "bun:test"
import { PR_STATE_COLOR, PR_STATE_LABEL, findPrRefs, isPrCreateCommand, prKey, sortChips, stateFromGh, type PrChip } from "../src/core/pr.js"

describe("findPrRefs", () => {
  test("picks the URL `gh pr create` prints", () => {
    const refs = findPrRefs("https://github.com/navbytes/opencode-plugins/pull/20\n")
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({ host: "github.com", owner: "navbytes", repo: "opencode-plugins", number: 20 })
  })

  test("finds PRs embedded in prose and markdown links", () => {
    const refs = findPrRefs("Opened [#7](https://github.com/a/b/pull/7) and see https://github.com/a/b/pull/8).")
    expect(refs.map((r) => r.number)).toEqual([7, 8])
  })

  test("dedupes repeats but keeps distinct PRs of the same repo", () => {
    const refs = findPrRefs("https://github.com/a/b/pull/1 https://github.com/a/b/pull/1 https://github.com/a/b/pull/2")
    expect(refs.map((r) => r.number)).toEqual([1, 2])
  })

  test("does not truncate a longer number into a shorter match", () => {
    expect(findPrRefs("https://github.com/a/b/pull/123")[0]!.number).toBe(123)
  })

  test("follows a PR URL that points at a sub-page", () => {
    expect(findPrRefs("https://github.com/a/b/pull/12/files")[0]).toMatchObject({ number: 12 })
    expect(findPrRefs("https://github.com/a/b/pull/12/commits/abc123")[0]).toMatchObject({ number: 12 })
    expect(findPrRefs("https://github.com/a/b/pull/12/checks")[0]).toMatchObject({ number: 12 })
  })

  test("ignores /pull/ paths on non-GitHub hosts", () => {
    expect(findPrRefs("https://gitlab.com/a/b/pull/3")).toEqual([])
  })

  // Tool output is attacker-reachable, and the host goes straight to `gh --repo`: a
  // look-alike must never become a request (and possibly a token) sent to that host.
  test.each([
    "https://github.evil.example/a/b/pull/1",
    "https://github.com.evil.example/a/b/pull/1",
    "https://notgithub.com/a/b/pull/1",
    "https://evil.example/github.com/a/b/pull/1",
  ])("rejects the look-alike host in %p", (url) => {
    expect(findPrRefs(url)).toEqual([])
  })

  test("accepts a GitHub Enterprise host only when it is explicitly allowed", () => {
    expect(findPrRefs("https://github.acme.com/a/b/pull/4")).toEqual([])
    const refs = findPrRefs("https://github.acme.com/a/b/pull/4", ["github.com", "github.acme.com"])
    expect(refs[0]).toMatchObject({ host: "github.acme.com", number: 4 })
  })

  test("the allow-list is matched case-insensitively", () => {
    expect(findPrRefs("https://GitHub.com/a/b/pull/5")[0]).toMatchObject({ number: 5 })
  })

  test("ignores the compare URL `git push` suggests", () => {
    expect(findPrRefs("remote: https://github.com/a/b/pull/new/my-branch")).toEqual([])
  })

  test("ignores issues and the PR list page", () => {
    expect(findPrRefs("https://github.com/a/b/issues/5 https://github.com/a/b/pulls")).toEqual([])
  })

  test("survives empty and undefined input", () => {
    expect(findPrRefs(undefined)).toEqual([])
    expect(findPrRefs("")).toEqual([])
  })
})

describe("isPrCreateCommand", () => {
  test.each([
    "gh pr create --fill",
    "gh pr create -t 'x' -b 'y'",
    "cd repo && gh pr create --draft",
    "git push -u origin hi; gh pr create --fill",
    "gh --repo a/b pr create",
  ])("recognises %p", (cmd) => {
    expect(isPrCreateCommand(cmd)).toBe(true)
  })

  test.each(["gh pr view 20", "gh pr list", "echo gh-pr-create", "git commit -m 'gh pr create'"])("rejects %p", (cmd) => {
    expect(isPrCreateCommand(cmd)).toBe(false)
  })

  test("a heredoc body that mentions both words on different lines is not a create", () => {
    expect(isPrCreateCommand("gh pr view 1 <<EOF\nsomething\npr create\nEOF")).toBe(false)
  })

  test("survives undefined", () => {
    expect(isPrCreateCommand(undefined)).toBe(false)
  })
})

describe("stateFromGh", () => {
  test("maps every gh state, draft included", () => {
    expect(stateFromGh({ state: "MERGED" })).toBe("merged")
    expect(stateFromGh({ state: "CLOSED" })).toBe("closed")
    expect(stateFromGh({ state: "OPEN", isDraft: false })).toBe("open")
    expect(stateFromGh({ state: "OPEN", isDraft: true })).toBe("draft")
  })

  test("a merged PR that is still flagged draft reads as merged", () => {
    expect(stateFromGh({ state: "MERGED", isDraft: true })).toBe("merged")
  })

  test("unknown for anything it cannot read", () => {
    expect(stateFromGh(undefined)).toBe("unknown")
    expect(stateFromGh({})).toBe("unknown")
    expect(stateFromGh({ state: "WAT" })).toBe("unknown")
  })
})

describe("colours and labels", () => {
  test("every paintable state has GitHub's own colour", () => {
    expect(PR_STATE_COLOR).toEqual({ draft: "#59636e", open: "#1f883d", closed: "#cf222e", merged: "#8250df" })
  })

  test("every state has a label", () => {
    for (const s of ["draft", "open", "closed", "merged", "unknown"] as const) expect(PR_STATE_LABEL[s]).toBeTruthy()
  })
})

describe("prKey and sortChips", () => {
  const chip = (n: number, seen: number): PrChip => ({
    host: "github.com",
    owner: "a",
    repo: "b",
    number: n,
    url: `https://github.com/a/b/pull/${n}`,
    key: prKey({ host: "github.com", owner: "a", repo: "b", number: n }),
    state: "open",
    created: false,
    seen,
    checked: 0,
    failures: 0,
  })

  test("key separates same-numbered PRs of different repos", () => {
    expect(prKey({ host: "github.com", owner: "a", repo: "b", number: 1 })).not.toBe(prKey({ host: "github.com", owner: "a", repo: "c", number: 1 }))
  })

  test("orders by first sighting, then number", () => {
    const sorted = sortChips([chip(9, 200), chip(3, 100), chip(1, 100)])
    expect(sorted.map((c) => c.number)).toEqual([1, 3, 9])
  })

  test("pull requests this session made lead the ones it only referenced", () => {
    const made = { ...chip(9, 300), created: true }
    const sorted = sortChips([chip(1, 100), made, chip(2, 200)])
    expect(sorted.map((c) => c.number)).toEqual([9, 1, 2])
  })

  test("does not mutate its input", () => {
    const input = [chip(2, 200), chip(1, 100)]
    sortChips(input)
    expect(input.map((c) => c.number)).toEqual([2, 1])
  })
})
