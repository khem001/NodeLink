// JSON log projection only. Never mutate the live request used by authentication
// or voice negotiation. Whole voice blocks include tokens/endpoints/session IDs.
export function redactRequestField(key: string, value: unknown): unknown {
  return /^(voice|token|authorization|password|secretKey|endpoint|sessionId|cookie|set-cookie)$/i.test(
    key
  )
    ? '[REDACTED]'
    : value
}
