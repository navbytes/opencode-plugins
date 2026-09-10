/**
 * One entry point: src/tui/index.tsx -> dist/tui.js (Solid JSX, via @opentui/solid's
 * bun plugin). @opencode-ai/*, @opentui/* and solid-js are provided by the host TUI.
 */
import solidPlugin from "@opentui/solid/bun-plugin"
import pkg from "../package.json"

const result = await Bun.build({
  entrypoints: ["src/tui/index.tsx"],
  outdir: "dist",
  target: "bun",
  format: "esm",
  naming: "tui.js",
  plugins: [solidPlugin],
  external: ["@opencode-ai/*", "@opentui/*", "solid-js", "solid-js/*"],
  define: { __GIT_STATS_VERSION__: JSON.stringify(pkg.version) },
})
if (!result.success) {
  console.error("build failed: src/tui/index.tsx")
  for (const log of result.logs) console.error(log)
  process.exit(1)
}
for (const output of result.outputs) console.log(`${output.path} ${output.size}B`)
