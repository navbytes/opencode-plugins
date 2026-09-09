/**
 * Adopting OpenCode's native forks into the journal: the IO half of core/adopt.ts,
 * shared by both plugin halves. Idempotent, and never throws — adoption is a nicety,
 * it must not take a hook or a route down.
 */
import { expectedParentTitle, findForkParent, pickAdoptables, type ForkCandidate, type ForkMessage, type ForkParent, type SessionInfo } from "../core/adopt.js"
import type { JournalActor } from "../core/journal.js"
import { debug } from "./debug.js"
import type { JournalStore } from "./store.js"

export type AdoptOptions = {
  store: JournalStore
  directory: string
  actor: JournalActor
  listSessions: () => Promise<SessionInfo[]>
  messagesOf: (sessionID: string) => Promise<ForkMessage[]>
  log?: (event: string, data?: Record<string, unknown>) => void
}

export type Adopted = { sessionID: string; parentSessionID: string }

/** `adoptables` is the count found at the start of the pass — 0 means the pass had nothing
 *  to do, which `retryAdopt` uses to stop polling even when nothing was adopted; -1 means the
 *  pass threw before it could count (a genuine 0 must come from a pass that actually ran). */
export type AdoptResult = { adopted: Adopted[]; adoptables: number }

/** Each candidate costs one `session.messages` round-trip, and an old session is not a
 *  plausible fork parent — so the blind fallback only looks at the recent past. */
const MAX_CANDIDATES = 40

type Fetch = (sessionID: string) => Promise<ForkMessage[]>

async function matchAgainst(fork: ForkCandidate, pool: SessionInfo[], messagesOf: Fetch): Promise<ForkParent | undefined> {
  if (pool.length === 0) return undefined
  const candidates: ForkCandidate[] = []
  for (const session of pool) candidates.push({ ...session, messages: await messagesOf(session.id) })
  return findForkParent(fork, candidates)
}

/** Journal every native fork of `directory` that is not in a tree yet. Returns what it adopted. */
export async function adoptNativeForks(opts: AdoptOptions): Promise<AdoptResult> {
  const { store, actor } = opts
  const log = opts.log ?? debug
  const adopted: Adopted[] = []
  let adoptableCount = -1 // unknown until a pass actually completes the count
  try {
    const sessions = (await opts.listSessions()).filter((s) => !s.parentID && (s.directory === undefined || s.directory === opts.directory))
    const registered = new Set(sessions.filter((s) => store.treeIdFor(s.id)).map((s) => s.id))
    const adoptables = pickAdoptables(sessions, registered)
    adoptableCount = adoptables.length
    if (adoptables.length === 0) return { adopted, adoptables: adoptableCount }

    const cache = new Map<string, ForkMessage[]>()
    const messagesOf: Fetch = async (sessionID) => {
      const hit = cache.get(sessionID)
      if (hit) return hit
      const messages = await opts.messagesOf(sessionID)
      cache.set(sessionID, messages)
      return messages
    }

    for (const session of adoptables) {
      const messages = await messagesOf(session.id)
      // forked messages are copies and keep their original `time.created`, so they all
      // predate the fork's session row; a session that wrote its own first message is
      // not a fork and needs no candidate round-trips at all (equal times are common —
      // a row created and its first message sent inside one millisecond)
      if (messages.length === 0 || messages[0]!.created >= session.created) continue

      const fork: ForkCandidate = { ...session, messages }
      const expected = expectedParentTitle(session.title)
      const pool = sessions.filter((s) => s.id !== session.id && s.created <= session.created).sort((a, b) => b.created - a.created)
      const titled = expected === undefined ? [] : pool.filter((s) => s.title === expected)
      const rest = pool.filter((s) => !titled.includes(s)).slice(0, MAX_CANDIDATES)
      const parent = (await matchAgainst(fork, titled, messagesOf)) ?? (await matchAgainst(fork, rest, messagesOf))
      if (!parent) continue

      const treeId = store.ensureTree(parent.parentID, actor)
      if (store.treeIdFor(session.id)) continue // the other half adopted it while we matched
      store.registerSession(session.id, treeId)
      store.record(treeId, "branch.opened", { sessionID: session.id, parentSessionID: parent.parentID, anchorMessageID: parent.anchorMessageID, kind: "native" }, actor)
      adopted.push({ sessionID: session.id, parentSessionID: parent.parentID })
      log("adopt.native", { treeId, sessionID: session.id, parentSessionID: parent.parentID, anchorMessageID: parent.anchorMessageID })
    }
  } catch (e) {
    log("adopt.failed", { directory: opts.directory, error: e instanceof Error ? e.message : String(e) })
  }
  return { adopted, adoptables: adoptableCount }
}

/** The `session.created` event fires before the fork's messages are copied, so wait, then
 *  retry — but stop as soon as one pass adopts something, or a pass finds nothing to adopt:
 *  a fork batch's other loop already got there first, and later passes are zero-call polls. */
export async function retryAdopt(adopt: () => Promise<AdoptResult>, tries = 3, delayMs = 1000): Promise<Adopted[]> {
  for (let attempt = 0; attempt < tries; attempt++) {
    await new Promise((r) => setTimeout(r, delayMs))
    const { adopted, adoptables } = await adopt()
    if (adopted.length > 0 || adoptables === 0) return adopted
  }
  return []
}
