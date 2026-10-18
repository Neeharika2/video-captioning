import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

export const FIXTURES = path.join(__dirname, ".fixtures");
export const SPEECH = "Hello everyone. Today we deploy the service to Kubernetes. The rollout takes ten minutes.";

function ffmpeg(args: string[]) {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
}

/** Generate small test videos with ffmpeg (synthetic voice from flite). */
export default function globalSetup() {
  mkdirSync(FIXTURES, { recursive: true });
  const video = ["-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25:duration=8"];
  const voice = ["-f", "lavfi", "-i", `flite=text='${SPEECH}':voice=slt`];

  const mp4 = path.join(FIXTURES, "speech.mp4");
  if (!existsSync(mp4)) {
    ffmpeg([...video, ...voice, "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", mp4]);
  }
  // AVI isn't readable by Mediabunny → exercises the ffmpeg.wasm fallback.
  const avi = path.join(FIXTURES, "speech.avi");
  if (!existsSync(avi)) {
    ffmpeg([...video, ...voice, "-shortest", "-c:v", "mpeg4", "-c:a", "libmp3lame", avi]);
  }
  const silent = path.join(FIXTURES, "no-audio.mp4");
  if (!existsSync(silent)) {
    ffmpeg([...video, "-c:v", "libx264", "-pix_fmt", "yuv420p", silent]);
  }
}
