# Changelog

## 0.1.1-beta.1 — 2026-09-10

**Nothing in the plugin changed.** `git diff git-stats-v0.1.0 git-stats-v0.1.1-beta.1
-- src dist` is empty; the only difference is the `repository.url` and `homepage`
metadata following the repo's rename to `navbytes/opencode-plugins`.

This version exists because the release path had never actually been run for this
package, and the way to find out whether it works is to run it. It did not: the `npm`
deployment environment only admitted tags matching `v*`, the scheme this repo used
before it became a monorepo, so the publish job was rejected before its first step —
with no failing step and no log to read. Fixed by allowing `*-v*` as well.

Published under the `beta` dist-tag, so `latest` still resolves to 0.1.0. Deprecated
on npm; install `opencode-git-stats@latest` instead.

## 0.1.0 — 2026-09-10

First release.

A `sidebar_content` card, at order 450 so it sits directly above the host's own
**Modified Files** list, holding two things:

- **The working tree's figures** — `+123 -45 · 7 files` for the whole folder, from
  `client.vcs.status()`, refreshed on OpenCode's `session.diff` and `session.idle`
  events and on a 10 s tick so an edit made in another terminal shows up too. This
  is deliberately *not* `state.session.diff()`, which accumulates only the files
  the current session touched.

- **A chip per pull request the session touched** — `#20 Merged`, painted with
  GitHub's own state colours (`#59636e` draft, `#1f883d` open, `#cf222e` closed,
  `#8250df` merged) and white text, the way the badge on the pull request page is.
  Sightings come from completed tool parts (`state.session.messages()` +
  `state.part()`), so a chip only exists because a command actually printed the
  URL; the state behind it comes from `gh pr view --json state,isDraft`, the one
  question OpenCode's API cannot answer. A merged PR is never re-fetched, and a
  `gh` that is missing or logged out is reported in the card once instead of being
  retried every tick.

Chips close: click the `×`, or run `/prs` to hide one, hide all, or bring the
hidden ones back. Dismissals live in `kv`, keyed per session, so they survive a
restart and do not leak between sessions. Each chip's label is also an OSC 8
hyperlink to the pull request.

Two limits worth knowing about. Only `github.com` is trusted unless a host is
named in the plugin's `hosts` option: the URLs are found in *tool output*, which
can carry a `github.evil.example` a fetched page put there, and the host goes
straight to `gh --repo`, which would treat an unknown one as Enterprise and send
it a request with an Enterprise token attached. And at most 24 chips are tracked
per session, so a `gh pr list --json url` cannot mint a chip — and a `gh`
process — per pull request in the repository. Failing `gh` calls back off
exponentially to about 16 minutes, and reset at the end of a turn in case the
user has just installed or logged into it.
