/** @jsxImportSource @opentui/solid */
/**
 * TUI plugin: a sidebar card with the working tree's diff figures and a chip per pull
 * request this session touched.
 *
 * Everything it knows comes from OpenCode's own TUI API — `client.vcs.status()` for the
 * figures, `state.session.messages` / `state.part` for the tool output a PR URL appears
 * in, `kv` for what the user has dismissed. The single outside call is `gh pr view`,
 * which is the only way to learn whether a PR is draft, open, closed or merged.
 */
import type { TuiPlugin } from "@opencode-ai/plugin/tui"
import { createEffect, createMemo, createSignal } from "solid-js"
import { fetchPrState, type GhFailure } from "../core/gh.js"
import { DEFAULT_HOSTS, sortChips, type PrChip } from "../core/pr.js"
import { summarize, type DiffSummary, type FileStat } from "../core/stats.js"
import { applyFailure, applyLookup, collectChips, dueForRefresh, mapChips, markStale as staleChip, mergeChips, staleAfterTurn, visibleChips, type ToolCall } from "../core/tracker.js"
import { Card } from "./card.js"

/** How often the plugin looks for chips whose state has aged out, and for tree changes. */
const TICK_MS = 10_000
const STATUS_TIMEOUT_MS = 5_000
/** A `gh` failure is reported once per state, not once per tick. */
const NOTE: Record<GhFailure, string> = {
  missing: "gh not installed",
  unauthenticated: "gh: run `gh auth login`",
  timeout: "gh timed out",
  error: "gh could not read PR state",
}

/**
 * A GitHub Enterprise host has to be named here to be trusted, because the text these
 * URLs are found in is tool output — see `findPrRefs`.
 */
function parseHosts(raw: unknown): string[] {
  const extra = (raw as { hosts?: unknown } | undefined)?.hosts
  const list = Array.isArray(extra) ? extra.filter((h): h is string => typeof h === "string" && h.length > 0) : []
  return [...DEFAULT_HOSTS, ...list]
}

type ToolPart = { id: string; type: string; state?: { status?: string; input?: Record<string, unknown>; output?: string } }

/** What picking a row of the `/prs` dialog does. */
type ChipAction = { kind: "hide"; key: string } | { kind: "hideAll" } | { kind: "restore" }

const tui: TuiPlugin = async (api, options) => {
  const directory = api.state.path.directory
  const hosts = parseHosts(options)

  // ── pull requests ────────────────────────────────────────────────────────────
  // Chips are per session (the sidebar is), but a PR's *state* is fetched once per key
  // per pass, so the same PR open in two sessions costs one `gh` call.
  const [chips, setChips] = createSignal<Record<string, PrChip[]>>({})
  const [note, setNote] = createSignal<string | undefined>()
  const [dismissedTick, bumpDismissed] = createSignal(0)
  // Parts already read, per session: a re-render must not re-scan a whole transcript.
  const scanned = new Map<string, Set<string>>()
  // Message count at the last catch-up scan, per session.
  const counted = new Map<string, number>()

  // Fallback for the window before `kv` has loaded: a dismissal still takes effect, it
  // just does not survive a restart.
  const volatileDismissed = new Map<string, Set<string>>()

  const dismissedKey = (sessionID: string) => `gitstats.dismissed.${sessionID}`
  const dismissedFor = (sessionID: string): Set<string> => {
    dismissedTick()
    // The union, not one or the other: a chip dismissed before `kv` loaded must not come
    // back the moment it does.
    const out = new Set(volatileDismissed.get(sessionID) ?? [])
    if (api.kv.ready) for (const key of api.kv.get<string[]>(dismissedKey(sessionID), []) ?? []) out.add(key)
    return out
  }
  const setDismissedFor = (sessionID: string, keys: readonly string[]) => {
    if (api.kv.ready) {
      api.kv.set(dismissedKey(sessionID), [...keys])
      volatileDismissed.delete(sessionID)
    } else {
      volatileDismissed.set(sessionID, new Set(keys))
    }
    bumpDismissed((n) => n + 1)
  }

  const updateSession = (sessionID: string, fn: (list: PrChip[]) => PrChip[]) => {
    setChips((prev) => {
      const before = prev[sessionID] ?? []
      const after = fn(before)
      return after === before ? prev : { ...prev, [sessionID]: after }
    })
  }

  /** Read any tool part we have not read before, and fold whatever PRs it names into the session. */
  const ingest = (sessionID: string, parts: readonly ToolPart[]) => {
    let read = scanned.get(sessionID)
    if (!read) scanned.set(sessionID, (read = new Set()))
    const calls: ToolCall[] = []
    for (const part of parts) {
      if (part.type !== "tool" || part.state?.status !== "completed" || read.has(part.id)) continue
      read.add(part.id)
      const command = part.state?.input?.["command"]
      calls.push({ command: typeof command === "string" ? command : undefined, output: part.state?.output })
    }
    if (!calls.length) return
    const found = collectChips(calls, Date.now(), hosts)
    if (!found.length) return
    updateSession(sessionID, (list) => mergeChips(list, found))
    // Detached: `ingest` runs inside the catch-up effect, and `refresh` reads `chips()`.
    queueMicrotask(() => void refresh())
  }

  // One `gh` pass over every chip whose state has aged out. Serial on purpose: a handful
  // of chips is not worth a scheduler, and a burst of `gh` processes is worth avoiding.
  let refreshing = false
  const refresh = async () => {
    if (refreshing) return
    refreshing = true
    try {
      const now = Date.now()
      const due = new Map<string, PrChip>()
      for (const [sessionID, list] of Object.entries(chips())) {
        // A chip the user closed costs nothing to keep, but must cost no `gh` calls.
        const hidden = dismissedFor(sessionID)
        for (const chip of list) if (!hidden.has(chip.key) && dueForRefresh(chip, now) && !due.has(chip.key)) due.set(chip.key, chip)
      }
      if (!due.size) return
      let failure: GhFailure | undefined
      for (const chip of due.values()) {
        if (api.lifecycle.signal.aborted) return
        const result = await fetchPrState(chip, directory, api.lifecycle.signal)
        const at = Date.now()
        if (!result.ok) {
          failure ??= result.failure
          // Stamp the attempt and lengthen the next wait, so a missing or logged-out `gh`
          // backs off to minutes instead of being re-spawned on every tick forever.
          setChips((prev) => mapChips(prev, chip.key, (c) => applyFailure(c, at)))
          continue
        }
        setChips((prev) => mapChips(prev, chip.key, (c) => applyLookup(c, result.value.state, result.value.title, at)))
      }
      setNote(failure ? NOTE[failure] : undefined)
    } finally {
      refreshing = false
    }
  }

  /** A finished turn may have merged or closed something: let the next tick re-ask. */
  const markStale = (sessionID: string) => {
    updateSession(sessionID, (list) => {
      const next = list.map((c) => (staleAfterTurn(c) ? staleChip(c) : c))
      return next.some((c, i) => c !== list[i]) ? next : list
    })
    void refresh()
  }

  // ── working tree ─────────────────────────────────────────────────────────────
  // `undefined` until the first answer: a card that has not been told anything says
  // nothing, rather than claiming a dirty tree is clean.
  const [summary, setSummary] = createSignal<DiffSummary | undefined>()
  let loadingStatus = false
  const readTree = async () => {
    if (loadingStatus) return
    loadingStatus = true
    try {
      // A hung server must not wedge the poll; the next tick tries again.
      const res = await api.client.vcs.status({ directory }, { signal: AbortSignal.timeout(STATUS_TIMEOUT_MS) }).catch(() => undefined)
      const files = res?.data as FileStat[] | undefined
      // A failed or aborted call answers `undefined`, which is not the same as an empty
      // working tree: keep the last figures we were actually told.
      if (files) setSummary(summarize(files))
    } finally {
      loadingStatus = false
    }
  }

  // ── wiring ───────────────────────────────────────────────────────────────────
  void readTree()
  // `session.diff` fires whenever OpenCode notices the tree moved; the tick covers edits
  // made outside it (a rebase in another terminal), and ages chip states out.
  const offDiff = api.event.on("session.diff", () => void readTree())
  const offIdle = api.event.on("session.idle", (event) => {
    void readTree()
    markStale(event.properties.sessionID)
  })
  // A chip should appear the moment the command that made the PR finishes, and reading one
  // part per event is O(1) — walking the whole transcript on every streamed part is not.
  const offPart = api.event.on("message.part.updated", (event) => {
    ingest(event.properties.sessionID, [event.properties.part as unknown as ToolPart])
  })
  const timer = setInterval(() => {
    void readTree()
    void refresh()
  }, TICK_MS)
  api.lifecycle.onDispose(() => {
    clearInterval(timer)
    offDiff()
    offIdle()
    offPart()
  })

  const currentSession = (): string | undefined => {
    const route = api.route.current
    return route.name === "session" ? ((route.params as { sessionID?: string } | undefined)?.sessionID ?? undefined) : undefined
  }

  const shownFor = (sessionID: string): PrChip[] => sortChips(visibleChips(chips()[sessionID] ?? [], dismissedFor(sessionID)))

  const detached = (fn: () => Promise<void>) => () => {
    void fn().catch((e) => api.ui.toast({ variant: "error", message: e instanceof Error ? e.message : String(e) }))
  }

  const dismiss = (sessionID: string, key: string) => {
    const next = dismissedFor(sessionID)
    next.add(key)
    setDismissedFor(sessionID, [...next])
  }

  api.keymap.registerLayer({
    commands: [
      {
        namespace: "palette",
        name: "gitstats.chips",
        title: "Hide a pull request chip",
        description: "Close one chip, all of them, or bring the hidden ones back",
        category: "Git",
        slashName: "prs",
        slashAliases: ["chips"],
        enabled: () => Boolean(currentSession()),
        // A palette `run` must return synchronously, and the palette clears any dialog open
        // when it closes — so the picker is opened detached, one tick after that close.
        run: detached(async () => {
          const sessionID = currentSession()
          if (!sessionID) return
          await new Promise((r) => setTimeout(r, 30))
          const shown = shownFor(sessionID)
          const hidden = (chips()[sessionID] ?? []).length - shown.length
          const options: { title: string; value: ChipAction; description?: string }[] = shown.map((c) => ({
            title: `Hide #${c.number} · ${c.state === "unknown" ? "checking" : c.state}`,
            value: { kind: "hide", key: c.key },
            description: c.title,
          }))
          if (shown.length > 1) options.push({ title: `Hide all ${shown.length} chips`, value: { kind: "hideAll" } })
          if (hidden > 0) options.push({ title: `Show ${hidden} hidden chip${hidden === 1 ? "" : "s"} again`, value: { kind: "restore" } })
          if (!options.length) {
            api.ui.toast({ message: "no pull requests seen in this session yet" })
            api.ui.dialog.clear()
            return
          }
          api.ui.dialog.replace(() =>
            api.ui.DialogSelect<ChipAction>({
              title: "Pull request chips",
              options,
              onSelect: (option) => {
                const action = option.value
                // Union with what is already hidden: "hide all" must not un-hide.
                if (action.kind === "hideAll") setDismissedFor(sessionID, [...dismissedFor(sessionID), ...shown.map((c) => c.key)])
                else if (action.kind === "restore") setDismissedFor(sessionID, [])
                else dismiss(sessionID, action.key)
                api.ui.dialog.clear()
              },
            }),
          )
        }),
      },
    ],
  })

  api.slots.register({
    // The host's own sections are 100 Context … 400 Todo, 500 Modified Files, drawn
    // lowest first: the worktree totals belong directly above that file list.
    order: 450,
    slots: {
      sidebar_content: (_ctx, props: { session_id: string }) => {
        // Catch-up for everything that happened before this card mounted — a session
        // reopened after a restart, or one whose messages were still loading. Guarded by
        // the message count so a streaming turn does not re-walk the transcript; live
        // parts arrive through `message.part.updated` instead.
        createEffect(() => {
          const sessionID = props.session_id
          const messages = api.state.session.messages(sessionID)
          if (messages.length === counted.get(sessionID)) return
          counted.set(sessionID, messages.length)
          for (const message of messages) ingest(sessionID, api.state.part(message.id) as unknown as ToolPart[])
        })
        const shown = createMemo(() => shownFor(props.session_id))
        return (
          <Card
            theme={api.theme.current}
            git={Boolean(api.state.vcs)}
            branch={api.state.vcs?.branch}
            summary={summary()}
            chips={shown()}
            // Only while a chip is still stateless: once `gh` answers, the explanation
            // for why it could not is no longer true.
            note={shown().some((c) => c.state === "unknown") ? note() : undefined}
            onDismiss={(key) => dismiss(props.session_id, key)}
          />
        )
      },
    },
  })
}

export { tui }
export default { id: "opencode-git-stats", tui } satisfies { id: string; tui: TuiPlugin }
