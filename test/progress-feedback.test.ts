/**
 * The feedback half of the LLM-backed flows: a jump that summarizes must say what it is doing
 * while it does it — the stage, and the draft as it streams — and must clear the line on the
 * way out, however it leaves.
 */
import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { executeJump, type ActionContext } from "../src/tui/actions.js"
import { JournalStore } from "../src/shared/store.js"
import type { AbandonedTail } from "../src/core/actions.js"
import type { ProgressState } from "../src/core/progress.js"

const HERE = "ses_here"
const THERE = "ses_there"
const HELPER = "ses_helper"

const tail = (): AbandonedTail => ({
  turns: 3,
  tokens: 14_000,
  messages: [
    { id: "m1", sessionID: HERE, role: "user", time: { created: 1 }, parts: [{ type: "text", text: "try redis" }] },
    { id: "m2", sessionID: HERE, role: "assistant", time: { created: 2 }, parts: [{ type: "text", text: "no, keep it in memory" }] },
  ] as unknown as AbandonedTail["messages"],
})

/** A fake TUI api whose helper reply streams two deltas before it returns. */
function fakeJump(opts: { withProgress: boolean; deltas?: string[] }) {
  const dir = mkdtempSync(path.join(tmpdir(), "ctree-progress-"))
  const store = new JournalStore({ worktree: dir })
  const handlers: ((event: unknown) => void)[] = []
  const toasts: string[] = []
  const seen: (Omit<ProgressState, "startedAt"> | undefined)[] = []
  const prompted: { sessionID: string; text: string }[] = []
  const deltas = opts.deltas ?? ["## Goal\n", "## Goal\nkeep the working set in memory"]

  const api = {
    client: {
      session: {
        get: async () => ({ data: { metadata: {} } }),
        update: async () => ({ data: {} }),
        abort: async () => ({ data: {} }),
        delete: async () => ({ data: {} }),
        create: async () => ({ data: { id: HELPER } }),
        messages: async () => ({ data: [] }),
        prompt: async (p: { sessionID: string; parts: { text: string }[] }) => {
          prompted.push({ sessionID: p.sessionID, text: p.parts[0]!.text })
          if (p.sessionID !== HELPER) return { data: { info: { id: "m_landed" } } }
          for (const text of deltas) {
            // the live half is throttled to about one redraw per spinner frame, so a delta
            // arriving in the same millisecond as the last one is deliberately dropped
            await new Promise((r) => setTimeout(r, 120))
            for (const handler of [...handlers]) handler({ properties: { part: { id: "prt_1", sessionID: HELPER, type: "text", text } } })
          }
          return { data: { parts: [{ type: "text", text: deltas.at(-1) }] } }
        },
      },
    },
    event: {
      on: (_type: string, handler: (event: unknown) => void) => {
        handlers.push(handler)
        return () => handlers.splice(handlers.indexOf(handler), 1)
      },
    },
    state: { session: { status: () => undefined, get: () => ({ title: "Fix flaky test" }), messages: () => [{ id: "m2" }] } },
    ui: { toast: (t: { message: string }) => toasts.push(t.message) },
    route: { navigate: () => {} },
  } as unknown as TuiPluginApi

  const ctx: ActionContext = { api, store, directory: dir, ...(opts.withProgress ? { progress: (state) => seen.push(state) } : {}) }
  return { ctx, seen, toasts, prompted, handlers, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe("a jump that summarizes reports what it is doing", () => {
  test("stage, then the draft as it streams, then a cleared line", async () => {
    const f = fakeJump({ withProgress: true })
    try {
      const out = await executeJump(f.ctx, { kind: "switch", sessionID: THERE }, { currentSessionID: HERE, summary: { kind: "summarize" }, abandoned: tail() })
      expect(out).toEqual({ target: THERE })

      const labels = f.seen.map((s) => s?.label)
      // the wait is named by what it is summarizing, in the dialog's own words
      expect(labels[0]).toBe("summarizing 3 turns · ~14k")
      expect(f.seen[0]?.hint).toBe("esc cancels")
      // the model's own draft, live: the section it is on and how much of it there is
      expect(f.seen.map((s) => s?.detail).filter(Boolean)).toEqual(["Goal · 7 chars", "Goal · 38 chars"])
      // and the destination is named while the summary is written into it
      expect(labels.at(-2)).toBe("writing the ≣ summary into Fix flaky test")
      expect(f.seen.at(-1)).toBeUndefined()
    } finally {
      f.cleanup()
    }
  })

  test("the line is cleared even when the draft fails, and the jump still moves", async () => {
    const f = fakeJump({ withProgress: true, deltas: [] })
    try {
      const out = await executeJump(f.ctx, { kind: "switch", sessionID: THERE }, { currentSessionID: HERE, summary: { kind: "summarize" }, abandoned: tail() })
      expect(out).toEqual({ target: THERE })
      expect(f.seen.at(-1)).toBeUndefined()
      expect(f.toasts.at(-1)).toContain("summary failed")
    } finally {
      f.cleanup()
    }
  })

  test("nothing is left listening on the event bus once the draft is done", async () => {
    const f = fakeJump({ withProgress: true })
    try {
      await executeJump(f.ctx, { kind: "switch", sessionID: THERE }, { currentSessionID: HERE, summary: { kind: "summarize" }, abandoned: tail() })
      expect(f.handlers.length).toBe(0)
    } finally {
      f.cleanup()
    }
  })

  test("without a status line to draw on, the model wait becomes one toast", async () => {
    const f = fakeJump({ withProgress: false })
    try {
      await executeJump(f.ctx, { kind: "switch", sessionID: THERE }, { currentSessionID: HERE, summary: { kind: "summarize" }, abandoned: tail() })
      // exactly one — the fast server steps stay quiet rather than stacking toasts
      expect(f.toasts.filter((t) => t.startsWith("summarizing"))).toEqual(["summarizing 3 turns · ~14k… (esc cancels)"])
    } finally {
      f.cleanup()
    }
  })

  test("a jump with no summary reports nothing at all", async () => {
    const f = fakeJump({ withProgress: true })
    try {
      await executeJump(f.ctx, { kind: "switch", sessionID: THERE }, { currentSessionID: HERE, summary: { kind: "none" }, abandoned: tail() })
      expect(f.seen.filter(Boolean)).toEqual([])
      expect(f.prompted).toEqual([])
    } finally {
      f.cleanup()
    }
  })
})
