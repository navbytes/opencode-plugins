/**
 * Working-tree diff figures. The numbers come from OpenCode's own VCS status
 * endpoint (`client.vcs.status()`), so they agree with what the host sidebar shows.
 */

export type FileStat = { file: string; additions: number; deletions: number; status?: string }

export type DiffSummary = { files: number; additions: number; deletions: number }

export const EMPTY_SUMMARY: DiffSummary = { files: 0, additions: 0, deletions: 0 }

export function summarize(files: readonly FileStat[] | undefined): DiffSummary {
  if (!files?.length) return EMPTY_SUMMARY
  let additions = 0
  let deletions = 0
  for (const f of files) {
    additions += f.additions || 0
    deletions += f.deletions || 0
  }
  return { files: files.length, additions, deletions }
}

/** `7 files` / `1 file` — the noun that goes beside the +/− pair. */
export function fileCountLabel(files: number): string {
  return `${files} file${files === 1 ? "" : "s"}`
}

/** Cut to `max` columns, ellipsis included, so a long branch name cannot wrap the card. */
export function clip(text: string, max: number): string {
  if (max <= 0) return ""
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

/** Thousands get a `k` so the line never outgrows the sidebar: `1.2k`. */
export function compact(n: number): string {
  if (n < 1000) return String(n)
  const k = n / 1000
  return `${k < 10 ? k.toFixed(1).replace(/\.0$/, "") : Math.round(k)}k`
}
