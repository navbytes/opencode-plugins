import { describe, expect, test } from "bun:test"
import { openCommand } from "../src/core/open.js"

const URL = "https://github.com/navbytes/opencode-plugins/pull/20"

describe("openCommand", () => {
  test("uses each platform's own opener", () => {
    expect(openCommand(URL, "darwin")).toEqual({ command: "open", args: [URL] })
    expect(openCommand(URL, "linux")).toEqual({ command: "xdg-open", args: [URL] })
    expect(openCommand(URL, "freebsd")).toEqual({ command: "xdg-open", args: [URL] })
  })

  test("keeps cmd's empty title argument, or `start` eats the URL", () => {
    expect(openCommand(URL, "win32")).toEqual({ command: "cmd", args: ["/c", "start", "", URL] })
  })

  test("the URL is always a separate argv element, never concatenated", () => {
    for (const p of ["darwin", "linux", "win32"] as const) {
      expect(openCommand(URL, p)!.args).toContain(URL)
    }
  })

  // The last gate before a URL reaches the operating system.
  test.each([
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,<script>",
    "ssh://host/repo",
    "/Applications/Calculator.app",
    "-n",
    "",
  ])("refuses to hand %p to the OS", (bad) => {
    expect(openCommand(bad, "darwin")).toBeUndefined()
  })

  test("accepts http as well as https", () => {
    expect(openCommand("http://github.com/a/b/pull/1", "darwin")).toBeDefined()
    expect(openCommand("HTTPS://github.com/a/b/pull/1", "darwin")).toBeDefined()
  })
})
