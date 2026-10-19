/**
 * Phase 0 benchmark: compare Gemini transcription configs on clips with ground truth.
 *
 *   pnpm bench                     # all clips, all configs
 *   pnpm bench --clips a,b --configs A,B --repeat 2
 *   pnpm bench --dry-run           # convert audio + show plan, no API calls
 *
 * See benchmark/README.md for the clip format.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { DEFAULT_MODEL, GeminiError, transcribe, type TranscribeOptions } from "../lib/gemini";
import { durationSeconds, toOpus } from "./audio";
import {
  charErrorRate,
  glossaryRecall,
  scriptAccuracy,
  timingError,
  wordErrorRate,
  type TimingResult,
} from "./metrics";

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const CLIPS_DIR = path.join(ROOT, "clips");
const CACHE_DIR = path.join(ROOT, ".cache");
const RESULTS_DIR = path.join(ROOT, "results");
const MEDIA_EXT = /\.(wav|mp3|m4a|aac|ogg|opus|flac|webm|mp4|mov|mkv)$/i;
/** Blended estimate from PLAN.md §3. */
const USD_PER_AUDIO_MIN = 0.005;
/** Vercel Hobby function limit. */
const FUNCTION_LIMIT_SEC = 300;
/** 4.5 MB Vercel body limit at 24 kbps ≈ 25 min; the API allows 30 min with timestamps. */
const MAX_CHUNK_MIN = 25;

const TruthSchema = z.object({
  /** Verbatim ground-truth transcript (include fillers like "um"). */
  text: z.string().min(1),
  /** Jargon / names used by config D and for glossary recall. */
  glossary: z.array(z.string()).optional(),
  /** Hand-timed words (a sample of 20–30 per clip is enough). */
  words: z.array(z.object({ text: z.string(), start: z.number(), end: z.number() })).optional(),
  notes: z.string().optional(),
});
type Truth = z.infer<typeof TruthSchema>;

type Clip = { id: string; media: string; truth: Truth; opus: string; durationSec: number; opusBytes: number };

type ConfigId = "A" | "B" | "D";
const CONFIGS: Record<ConfigId, { label: string; build: (t: Truth) => TranscribeOptions | undefined }> = {
  A: { label: "verbatim", build: () => ({}) },
  B: { label: "verbatim + word timestamps", build: () => ({ timestamps: true }) },
  D: {
    label: "verbatim + custom_vocabulary",
    build: (t) => (t.glossary?.length ? { customVocabulary: t.glossary } : undefined),
  },
};

type RunRow = {
  clip: string;
  config: ConfigId;
  repeat: number;
  durationSec: number;
  latencyMs?: number;
  wer?: number;
  cer?: number;
  refWords?: number;
  timing?: TimingResult;
  telugu?: number;
  latin?: number;
  glossary?: number;
  wordCount?: number;
  error?: string;
};

async function main() {
  const { values } = parseArgs({
    options: {
      clips: { type: "string" },
      configs: { type: "string", default: "A,B,D" },
      repeat: { type: "string", default: "1" },
      model: { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
  });
  const configIds = values.configs.split(",").map((c) => c.trim().toUpperCase()) as ConfigId[];
  for (const c of configIds) if (!(c in CONFIGS)) throw new Error(`Unknown config ${c}`);
  const repeat = Math.max(1, Number(values.repeat));
  const model = values.model ?? process.env.GEMINI_MODEL ?? DEFAULT_MODEL;
  const apiKey = process.env.GEMINI_API_KEY;
  const dryRun = values["dry-run"];
  if (!dryRun && !apiKey) {
    throw new Error("GEMINI_API_KEY is not set. Put it in .env.local (see .env.example) or use --dry-run.");
  }

  const clips = await loadClips(values.clips?.split(",").map((s) => s.trim()));
  if (!clips.length) {
    console.log(`No clips found in ${CLIPS_DIR}. See benchmark/README.md.`);
    return;
  }

  // Plan + cost estimate.
  const plan = clips.flatMap((clip) =>
    configIds.flatMap((config) => {
      const opts = CONFIGS[config].build(clip.truth);
      return opts ? Array.from({ length: repeat }, (_, r) => ({ clip, config, opts, repeat: r + 1 })) : [];
    }),
  );
  const audioMin = plan.reduce((s, p) => s + p.clip.durationSec / 60, 0);
  console.log(`Model: ${model}`);
  console.log(`Clips: ${clips.map((c) => `${c.id} (${fmtMin(c.durationSec)}, ${(c.opusBytes / 1e6).toFixed(2)} MB opus)`).join(", ")}`);
  console.log(`Runs: ${plan.length} · audio ${audioMin.toFixed(1)} min · est. cost $${(audioMin * USD_PER_AUDIO_MIN).toFixed(3)}`);
  for (const p of plan) console.log(`  ${p.clip.id} ${p.config}#${p.repeat}: ${JSON.stringify(p.opts)}`);
  if (dryRun) return;

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.join(RESULTS_DIR, stamp);
  await mkdir(path.join(outDir, "runs"), { recursive: true });

  const rows: RunRow[] = [];
  const audioCache = new Map<string, Uint8Array>();
  for (const [i, p] of plan.entries()) {
    const tag = `${p.clip.id}.${p.config}.${p.repeat}`;
    process.stdout.write(`[${i + 1}/${plan.length}] ${tag} … `);
    let audio = audioCache.get(p.clip.id);
    if (!audio) {
      audio = new Uint8Array(await readFile(p.clip.opus));
      audioCache.set(p.clip.id, audio);
    }
    const row: RunRow = { clip: p.clip.id, config: p.config, repeat: p.repeat, durationSec: p.clip.durationSec };
    try {
      const res = await transcribe({ apiKey: apiKey!, audio, mimeType: "audio/ogg", model, ...p.opts });
      const t = p.clip.truth;
      const wer = wordErrorRate(t.text, res.text);
      const sa = scriptAccuracy(t.text, res.text);
      Object.assign(row, {
        latencyMs: res.latencyMs,
        wer: wer.rate,
        refWords: wer.refLength,
        cer: charErrorRate(t.text, res.text).rate,
        telugu: sa.telugu,
        latin: sa.latin,
        glossary: t.glossary?.length ? glossaryRecall(t.text, res.text, t.glossary).recall : undefined,
        timing: p.opts.timestamps && t.words?.length ? timingError(t.words, res.words) : undefined,
        wordCount: res.words.length,
      });
      await writeFile(
        path.join(outDir, "runs", `${tag}.json`),
        JSON.stringify({ options: p.opts, text: res.text, words: res.words, usage: res.usage, raw: res.raw }, null, 2),
      );
      console.log(`WER ${pct(row.wer)} · ${(res.latencyMs / 1000).toFixed(1)}s`);
    } catch (err) {
      row.error = err instanceof GeminiError ? err.message : String(err);
      await writeFile(
        path.join(outDir, "runs", `${tag}.error.json`),
        JSON.stringify({ options: p.opts, error: row.error, body: (err as GeminiError).body }, null, 2),
      );
      console.log(`ERROR ${row.error}`);
    }
    rows.push(row);
  }

  const report = renderReport(model, rows, clips);
  await writeFile(path.join(outDir, "report.md"), report);
  await writeFile(path.join(outDir, "rows.json"), JSON.stringify(rows, null, 2));
  console.log(`\n${report}\nSaved to ${path.relative(process.cwd(), outDir)}/`);
}

async function loadClips(only?: string[]): Promise<Clip[]> {
  const entries = await readdir(CLIPS_DIR, { withFileTypes: true }).catch(() => []);
  await mkdir(CACHE_DIR, { recursive: true });
  const clips: Clip[] = [];
  for (const e of entries) {
    // "_" folders (e.g. _smoke) only run when named explicitly.
    if (!e.isDirectory() || (only ? !only.includes(e.name) : e.name.startsWith("_"))) continue;
    const dir = path.join(CLIPS_DIR, e.name);
    const files = await readdir(dir);
    const media = files.find((f) => MEDIA_EXT.test(f));
    if (!files.includes("truth.json") || !media) {
      console.warn(`Skipping ${e.name}: needs truth.json and one audio/video file`);
      continue;
    }
    const truth = TruthSchema.parse(JSON.parse(await readFile(path.join(dir, "truth.json"), "utf8")));
    const opus = path.join(CACHE_DIR, `${e.name}.ogg`);
    await toOpus(path.join(dir, media), opus);
    const durationSec = await durationSeconds(opus);
    if (durationSec > 30 * 60) console.warn(`${e.name}: over 30 min — timestamp configs will be rejected`);
    const opusBytes = (await readFile(opus)).byteLength;
    clips.push({ id: e.name, media, truth, opus, durationSec, opusBytes });
  }
  return clips;
}

// ---------------------------------------------------------------------------
// Report

function renderReport(model: string, rows: RunRow[], clips: Clip[]): string {
  const lines: string[] = [];
  lines.push(`# Benchmark run — ${new Date().toISOString()}`, "", `Model: \`${model}\``, "");

  lines.push("## Per run", "");
  lines.push("| Clip | Cfg | # | WER | CER | Telugu acc | Latin acc | Glossary | Timing: mean start err | ±0.15 s | Latency | s per audio min |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    if (r.error) {
      lines.push(`| ${r.clip} | ${r.config} | ${r.repeat} | ERROR: ${r.error.replace(/\|/g, "/")} |||||||||`);
      continue;
    }
    lines.push(
      `| ${r.clip} | ${r.config} | ${r.repeat} | ${pct(r.wer)} | ${pct(r.cer)} | ${pct(r.telugu)} | ${pct(r.latin)} | ${pct(r.glossary)} | ${sec(r.timing?.meanStartError)} | ${pct(r.timing?.within150ms)} | ${sec(r.latencyMs! / 1000)} | ${sec(latencyPerMin(r))} |`,
    );
  }

  lines.push("", "## Per config (word-weighted WER)", "");
  lines.push("| Cfg | Description | Runs | Errors | WER | CER | Glossary | Mean start err | ±0.15 s | s per audio min (max) |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|");
  const agg: Partial<Record<ConfigId, ReturnType<typeof aggregate>>> = {};
  for (const id of Object.keys(CONFIGS) as ConfigId[]) {
    const rs = rows.filter((r) => r.config === id);
    if (!rs.length) continue;
    const a = (agg[id] = aggregate(rs));
    lines.push(
      `| ${id} | ${CONFIGS[id].label} | ${rs.length} | ${a.errors} | ${pct(a.wer)} | ${pct(a.cer)} | ${pct(a.glossary)} | ${sec(a.meanStart)} | ${pct(a.within)} | ${sec(a.latPerMin)} (${sec(a.latPerMinMax)}) |`,
    );
  }

  lines.push("", "## Decision hints (see RESULTS.md for the rules)", "");
  // Compare on the same clips only.
  const pairDelta = (x: ConfigId, y: ConfigId) => {
    const ids = clips.map((c) => c.id).filter((id) => ok(rows, id, x) && ok(rows, id, y));
    if (!ids.length) return undefined;
    const wx = aggregate(rows.filter((r) => r.config === x && ids.includes(r.clip))).wer!;
    const wy = aggregate(rows.filter((r) => r.config === y && ids.includes(r.clip))).wer!;
    return { delta: wy - wx, n: ids.length };
  };
  const ab = pairDelta("A", "B");
  if (ab) lines.push(`- Timestamps cost: WER(B) − WER(A) = **${pp(ab.delta)}** over ${ab.n} clip(s).`);
  const ad = pairDelta("A", "D");
  if (ad) lines.push(`- Custom vocab: WER(D) − WER(A) = **${pp(ad.delta)}** over ${ad.n} clip(s); glossary recall A ${pct(agg.A?.glossary)} → D ${pct(agg.D?.glossary)}.`);
  const lats = Object.values(agg).map((a) => a.latPerMinMax).filter((x): x is number => x !== undefined);
  if (lats.length) {
    const worst = Math.max(...lats);
    const byLatency = FUNCTION_LIMIT_SEC / 2 / worst;
    const chunkMin = Math.min(byLatency, MAX_CHUNK_MIN);
    lines.push(
      `- Latency: worst ${sec(worst)} per audio minute (any config) → latency allows ${byLatency.toFixed(1)} min with a 2× margin under ${FUNCTION_LIMIT_SEC}s; ` +
        `recommended chunk ≤ **${chunkMin.toFixed(1)} min** (hard cap ${MAX_CHUNK_MIN} min from the 4.5 MB upload limit / 30 min API limit).`,
    );
  }
  return lines.join("\n") + "\n";
}

function aggregate(rs: RunRow[]) {
  const good = rs.filter((r) => !r.error);
  const weighted = (key: "wer" | "cer") => {
    const words = good.reduce((s, r) => s + (r.refWords ?? 0), 0);
    return words ? good.reduce((s, r) => s + (r[key] ?? 0) * (r.refWords ?? 0), 0) / words : undefined;
  };
  const mean = (xs: (number | undefined)[]) => {
    const v = xs.filter((x): x is number => x !== undefined);
    return v.length ? v.reduce((s, x) => s + x, 0) / v.length : undefined;
  };
  const lat = good.map(latencyPerMin);
  return {
    errors: rs.length - good.length,
    wer: weighted("wer"),
    cer: weighted("cer"),
    glossary: mean(good.map((r) => r.glossary)),
    meanStart: mean(good.map((r) => r.timing?.meanStartError)),
    within: mean(good.map((r) => r.timing?.within150ms)),
    latPerMin: mean(lat),
    latPerMinMax: lat.length ? Math.max(...(lat as number[])) : undefined,
  };
}

const ok = (rows: RunRow[], clip: string, config: ConfigId) =>
  rows.some((r) => r.clip === clip && r.config === config && !r.error);
const latencyPerMin = (r: RunRow) => (r.latencyMs === undefined ? undefined : r.latencyMs / 1000 / (r.durationSec / 60));
const pct = (x?: number) => (x === undefined ? "–" : `${(x * 100).toFixed(1)}%`);
const pp = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)} pp`;
const sec = (x?: number) => (x === undefined ? "–" : `${x.toFixed(2)}s`);
const fmtMin = (s: number) => { const t = Math.round(s); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
