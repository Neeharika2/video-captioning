// Copies ffmpeg.wasm into public/ffmpeg so it's served from our own origin
// (needed later for COEP, and avoids a CDN dependency). Runs on postinstall.
//
//   public/ffmpeg/ffmpeg-core.{js,wasm}  single-thread core (@ffmpeg/core)
//   public/ffmpeg/esm/*.js               @ffmpeg/ffmpeg wrapper + worker
//
// The wrapper is loaded at runtime instead of bundled: Turbopack can't resolve
// its `new Worker(new URL(variable, import.meta.url))`.
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";

// These packages' "exports" hide their files from require.resolve; they're
// direct dependencies, so pnpm links them at the top level.
const modules = path.join(process.cwd(), "node_modules", "@ffmpeg");
const outDir = path.join(process.cwd(), "public", "ffmpeg");

function copy(fromDir, toDir, filter) {
  mkdirSync(toDir, { recursive: true });
  const files = readdirSync(fromDir).filter(filter);
  if (!files.length) throw new Error(`No files found in ${fromDir}`);
  for (const file of files) copyFileSync(path.join(fromDir, file), path.join(toDir, file));
}

copy(path.join(modules, "core", "dist", "esm"), outDir, (f) => /^ffmpeg-core\.(js|wasm)$/.test(f));
copy(path.join(modules, "ffmpeg", "dist", "esm"), path.join(outDir, "esm"), (f) => f.endsWith(".js"));
console.log(`ffmpeg.wasm copied to ${path.relative(process.cwd(), outDir)}/`);
