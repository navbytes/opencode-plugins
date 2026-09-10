/**
 * Pull-request identity, state and colour — the half of the plugin that is pure
 * functions over strings, so it can be tested without a terminal or a network.
 */

export type PrState = "draft" | "open" | "closed" | "merged" | "unknown"

/** A pull request as named by a URL: enough to ask `gh` about it again. */
export type PrRef = {
  /** `github.com`, or an Enterprise host. `gh --repo host/owner/repo` accepts both. */
  host: string
  owner: string
  repo: string
  number: number
  url: string
}

export type PrChip = PrRef & {
  key: string
  state: PrState
  title?: string
  /** True when we saw the URL come out of a `gh pr create` (as opposed to merely referenced). */
  created: boolean
  /** ms epoch of the first sighting — chips keep session order. */
  seen: number
  /** ms epoch of the last `gh` attempt, successful or not; 0 before the first one. */
  checked: number
  /** Consecutive failed `gh` attempts — what the refresh backoff is computed from. */
  failures: number
}

export function prKey(ref: Pick<PrRef, "host" | "owner" | "repo" | "number">): string {
  return `${ref.host}/${ref.owner}/${ref.repo}#${ref.number}`
}

// `/pull/<n>` is followed by nothing, `/files`, `/commits/<sha>`, a quote or a `)`, so the
// only thing the trailing guard has to rule out is a longer number.
const PR_URL = /https?:\/\/([\w.-]+)\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?!\d)/g

/** The hosts trusted with no configuration. */
export const DEFAULT_HOSTS: readonly string[] = ["github.com", "www.github.com"]

/**
 * Every distinct PR URL in a blob of text, in first-seen order.
 *
 * `allowed` is an exact-match allow-list, and that is the point: the text being scanned is
 * tool output, which is attacker-reachable (a fetched page, a README, a paste). A host
 * from it is handed to `gh --repo <host>/…`, and `gh` treats an unknown host as GitHub
 * Enterprise — it would make an HTTPS request to whatever it was given, with an Enterprise
 * token attached if the user has one. So `github.evil.example` and `github.com.evil.example`
 * are dropped, and an Enterprise host has to be named in the plugin's own options.
 */
export function findPrRefs(text: string | undefined, allowed: readonly string[] = DEFAULT_HOSTS): PrRef[] {
  if (!text) return []
  const hosts = new Set(allowed.map((h) => h.toLowerCase()))
  const out: PrRef[] = []
  const seen = new Set<string>()
  for (const m of text.matchAll(PR_URL)) {
    const [, host, owner, repo, number] = m as unknown as [string, string, string, string, string]
    if (!hosts.has(host.toLowerCase())) continue
    const ref: PrRef = { host, owner, repo, number: Number(number), url: `https://${host}/${owner}/${repo}/pull/${number}` }
    const key = prKey(ref)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(ref)
  }
  return out
}

/**
 * Whether a shell command is a `gh pr create`. Used only to mark a chip as *created
 * here* rather than merely mentioned; detection of the PR itself is by URL.
 */
export function isPrCreateCommand(command: string | undefined): boolean {
  if (!command) return false
  // Quoted spans go first, so a commit message that merely *says* "gh pr create" doesn't
  // count. `[^;&|\n]*?` keeps the match inside one command of one line — a heredoc body
  // that happens to contain both words on different lines is not a `gh pr create` — while
  // allowing the flags that can sit between `gh` and its subcommand (`gh --repo a/b pr create`).
  const bare = command.replace(/'[^']*'|"[^"]*"/g, " ")
  return /(^|[\s;&|(])gh\b[^;&|\n]*?\bpr\s+create\b/.test(bare)
}

/** `gh pr view --json state,isDraft` → the state GitHub paints. */
export function stateFromGh(input: { state?: string; isDraft?: boolean } | undefined): PrState {
  const raw = input?.state?.toUpperCase()
  if (raw === "MERGED") return "merged"
  if (raw === "CLOSED") return "closed"
  if (raw === "OPEN") return input?.isDraft ? "draft" : "open"
  return "unknown"
}

export const PR_STATE_LABEL: Record<PrState, string> = {
  draft: "Draft",
  open: "Open",
  closed: "Closed",
  merged: "Merged",
  unknown: "…",
}

/**
 * GitHub's own state colours (Primer `*-emphasis` tokens), so a chip here reads as the
 * same badge as the one on the PR page.
 */
export const PR_STATE_COLOR: Record<Exclude<PrState, "unknown">, string> = {
  draft: "#59636e",
  open: "#1f883d",
  closed: "#cf222e",
  merged: "#8250df",
}

/**
 * Pull requests this session *made* lead; ones it merely referenced follow. Within each
 * group, the order the session saw them, then by number.
 */
export function sortChips(chips: readonly PrChip[]): PrChip[] {
  return [...chips].sort((a, b) => Number(b.created) - Number(a.created) || a.seen - b.seen || a.number - b.number)
}
