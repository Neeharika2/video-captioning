/**
 * Parse a protobuf Duration string as returned by Gemini ("0.100s", "12s",
 * "-0.5s") into seconds.
 */
export function parseOffset(value: string): number {
  const match = /^(-?\d+(?:\.\d+)?)s$/.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid duration offset: ${JSON.stringify(value)}`);
  }
  return Number(match[1]);
}
