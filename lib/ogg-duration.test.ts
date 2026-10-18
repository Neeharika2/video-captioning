import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { OggOpusError, oggOpusDuration } from "./ogg-duration";

function makeOgg(args: string[], seconds: number, codec = ["-c:a", "libopus", "-b:a", "24k"]) {
  const dir = mkdtempSync(path.join(tmpdir(), "ogg-test-"));
  const out = path.join(dir, "out.ogg");
  execFileSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`,
    ...args, ...codec, out,
  ]);
  return new Uint8Array(readFileSync(out));
}

describe("oggOpusDuration", () => {
  it("matches the encoded duration (16 kHz mono input)", () => {
    const bytes = makeOgg(["-ac", "1", "-ar", "16000"], 7.25);
    expect(oggOpusDuration(bytes)).toBeCloseTo(7.25, 2);
  });

  it("handles longer files", () => {
    const bytes = makeOgg(["-ac", "1", "-ar", "16000"], 95);
    expect(oggOpusDuration(bytes)).toBeCloseTo(95, 1);
  });

  it("rejects non-Ogg and non-Opus input", () => {
    expect(() => oggOpusDuration(new TextEncoder().encode("hello world, definitely not ogg data at all!!"))).toThrow(
      OggOpusError,
    );
    const vorbis = makeOgg(["-ac", "1"], 1, ["-c:a", "libvorbis"]);
    expect(() => oggOpusDuration(vorbis)).toThrow(/not Opus/);
  });

  it("rejects a truncated header", () => {
    const bytes = makeOgg(["-ac", "1"], 1);
    expect(() => oggOpusDuration(bytes.subarray(0, 30))).toThrow(OggOpusError);
  });
});
