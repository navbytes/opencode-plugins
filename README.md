# opencode-plugins

[![CI](https://github.com/navbytes/opencode-plugins/actions/workflows/ci.yml/badge.svg)](https://github.com/navbytes/opencode-plugins/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

A monorepo of independently versioned and published [OpenCode](https://opencode.ai)
plugins. Each publishable package lives under `packages/<name>/` with its own
`package.json`, README, and release history; the root only holds shared tooling
(TypeScript base config, the `harness/` PTY test rig) and CI.

| Package | Description |
|---|---|
| [`packages/context-tree`](packages/context-tree/README.md) | Pi-style context tree for OpenCode: branch, merge, crop, undo, plus a trajectory view |
| [`packages/git-stats`](packages/git-stats/README.md) | Sidebar card: working-tree diff figures, plus a GitHub-coloured chip per pull request the session touched |

## Adding a plugin

1. Create `packages/<name>/` with its own `package.json` and release scripts, and
   add it to the `workflow_dispatch.inputs.package` choice list in
   `.github/workflows/release.yml` and `publish.yml`.
2. **Publish its first version by hand.** npm's trusted publishing cannot be set up
   for a package that does not exist yet — the trust record silently fails to attach
   and the exchange reports "package not found". From `packages/<name>/`:
   `npm version <v> --no-git-tag-version --ignore-scripts && bun run build && npm publish --access public --ignore-scripts`,
   then reset the version (`git checkout -- package.json`) since the tag is the
   source of truth. `--ignore-scripts` is required: npm chokes on the `workspace:*`
   specifiers inside `@opentui`'s own published metadata, which is also why the build
   is explicit rather than left to `prepack`.
3. **Then create the trust record**, once per package — it binds to the package, not
   the repo, so a second plugin needs its own:
   `npm trust github <pkg> --file publish.yml --repo navbytes/opencode-plugins`,
   with environment `npm` (the publish job declares one; a record without it will not
   match the OIDC claims).
4. After that, `gh workflow run release.yml -f package=<name> -f bump=patch` does the
   rest. Note `bump=` computes off the newest `<name>-v*` tag and ignores a prerelease
   suffix, so the release a beta anticipated must be cut with an explicit
   `-f version=`, not `bump=`.

A green `release.yml` only means it tagged and dispatched, and a green `publish.yml`
only means npm accepted the upload — the registry lags by a minute or two. Check the
registry, not the workflow.

## Development

```sh
bun install
bun run build       # builds every package
bun run typecheck   # typechecks every package
bun test            # runs every package's tests
```
