/**
 * Opening a pull request in the browser.
 *
 * The chip's label is an OSC 8 hyperlink, but OpenCode's TUI turns on any-event mouse
 * tracking (`?1000h ?1002h ?1003h ?1006h`), so the terminal forwards every click to the
 * application and never activates the link itself — a plain click on a hyperlink does
 * nothing unless the user knows their terminal's bypass modifier. Since the click reaches
 * us, we open the URL ourselves.
 */

export type OpenCommand = { command: string; args: string[] }

/**
 * The platform's URL opener, as an argv array — never a shell string, so a URL can
 * never be read as shell syntax.
 */
export function openCommand(url: string, platform: NodeJS.Platform = process.platform): OpenCommand | undefined {
  // Only ever hand a browser an http(s) URL. Chip URLs are built from an allow-listed
  // host, but this is the last gate before a URL reaches the operating system.
  if (!/^https?:\/\//i.test(url)) return undefined
  if (platform === "darwin") return { command: "open", args: [url] }
  // `start` is a cmd builtin, and its first quoted argument is the window title — omit it
  // and a URL containing spaces would be swallowed as the title.
  if (platform === "win32") return { command: "cmd", args: ["/c", "start", "", url] }
  return { command: "xdg-open", args: [url] }
}
