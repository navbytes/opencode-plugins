# opencode-tree

[![CI](https://github.com/navbytes/opencode-tree/actions/workflows/ci.yml/badge.svg)](https://github.com/navbytes/opencode-tree/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

A monorepo of independently versioned and published [OpenCode](https://opencode.ai)
plugins. Each publishable package lives under `packages/<name>/` with its own
`package.json`, README, and release history; the root only holds shared tooling
(TypeScript base config, the `harness/` PTY test rig) and CI.

| Package | Description |
|---|---|
| [`packages/context-tree`](packages/context-tree/README.md) | Pi-style context tree for OpenCode: branch, merge, crop, undo, plus a trajectory view |
| [`packages/git-stats`](packages/git-stats/README.md) | Sidebar card: working-tree diff figures, plus a GitHub-coloured chip per pull request the session touched |

To add a new plugin, create `packages/<name>/` with its own `package.json` and
release scripts, then add it to the `workflow_dispatch.inputs.package` choice
list in `.github/workflows/release.yml` and `publish.yml`.

## Development

```sh
bun install
bun run build       # builds every package
bun run typecheck   # typechecks every package
bun test            # runs every package's tests
```
