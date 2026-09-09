/** Every SDK call gets a bounded wait: a server that never replies must not hang a hook or a route forever. */
export const SDK_TIMEOUT_MS = 15_000

export function sdkTimeout(): AbortSignal {
  return AbortSignal.timeout(SDK_TIMEOUT_MS)
}
