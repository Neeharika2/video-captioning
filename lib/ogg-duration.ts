/**
 * Read the duration of an Ogg Opus file from its bytes, without decoding.
 *
 * Used server-side so quotas don't depend on a client-reported duration.
 * Duration = (last granule position − pre-skip) / 48 000; Opus granule
 * positions always count 48 kHz samples regardless of the input sample rate.
 * https://www.rfc-editor.org/rfc/rfc7845#section-4
 */
export class OggOpusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OggOpusError";
  }
}

const OGGS = [0x4f, 0x67, 0x67, 0x53]; // "OggS"
const OPUS_HEAD = "OpusHead";

function isPageStart(b: Uint8Array, i: number) {
  return b[i] === OGGS[0] && b[i + 1] === OGGS[1] && b[i + 2] === OGGS[2] && b[i + 3] === OGGS[3] && b[i + 4] === 0;
}

export function oggOpusDuration(bytes: Uint8Array): number {
  if (bytes.length < 47 || !isPageStart(bytes, 0)) {
    throw new OggOpusError("Not an Ogg file");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // First page: header (27 bytes) + segment table, then the OpusHead packet.
  const serial = view.getUint32(14, true);
  const segments = bytes[26];
  const headStart = 27 + segments;
  if (headStart + 19 > bytes.length) throw new OggOpusError("Truncated Ogg header");
  const magic = new TextDecoder().decode(bytes.subarray(headStart, headStart + 8));
  if (magic !== OPUS_HEAD) throw new OggOpusError("Ogg stream is not Opus");
  const preSkip = view.getUint16(headStart + 10, true);

  // Scan backwards for the last page of the same stream with a valid granule.
  for (let i = bytes.length - 27; i > 0; i--) {
    if (!isPageStart(bytes, i) || view.getUint32(i + 14, true) !== serial) continue;
    const lo = view.getUint32(i + 6, true);
    const hi = view.getInt32(i + 10, true);
    if (hi === -1 && lo === 0xffffffff) continue; // -1: no packet ends on this page
    const granule = hi * 2 ** 32 + lo;
    if (granule <= 0) continue;
    return Math.max(0, granule - preSkip) / 48_000;
  }
  throw new OggOpusError("No audio pages found");
}
