# Local-first AI caption editor — Next.js plan

Status: draft v3 (supersedes v2, kept in `PLAN.v2.md`)
Date: 2026-10-18
Scope: Next.js app (frontend + thin API) · browser audio extraction · Gemini transcription ·
caption editor · SRT/VTT/MP4 export

---

## 1. Summary of this revision

v2's architecture is kept: the video stays in the browser, only compressed audio goes to a
thin backend that holds the Gemini key. v3 makes **Next.js the single app** for both the UI and
the thin backend (route handlers), and fixes the places where v2 doesn't fit Next.js or its
usual host (Vercel).

What changed from v2, in priority order:

| # | Change | Why |
|---|---|---|
| 1 | **Always chunk in the browser at ≤10 min per request** (one chunk for short videos) | Vercel caps request bodies at **4.5 MB** and function time at **300s** (Hobby). 10 min of 24 kbps Opus ≈ 1.8 MB. A 25–30 min single upload (≈5.4 MB) would be rejected. |
| 2 | **Stitching + overlap de-dup moves to the browser** | With one request per chunk, the server is stateless and never sees all chunks. The client already has them. |
| 3 | **Two-pass runs both passes in parallel** (when a glossary is given) | Pass 1 and pass 2 don't depend on each other; parallel keeps one chunk under the time limit. |
| 4 | **Single-thread FFmpeg.wasm + WORKERFS for Phases 1–3; COOP/COEP only in Phase 4** | Audio extraction doesn't need threads. Multi-thread needs cross-origin isolation, which breaks cross-origin assets and auth widgets. WORKERFS avoids copying a multi-GB video into wasm memory. |
| 5 | **Server computes audio duration for quota** (from the Ogg stream) | Quota can't trust a client-sent duration. |
| 6 | **MVP split into two phases** (pipeline, then editor) | Gives a checkpoint after the riskiest integration work. |
| 7 | **Filler removal defaults to unambiguous fillers only** | Deleting "like" / "you know" by default changes meaning. |
| 8 | **Autosave transcript to IndexedDB** | A refresh shouldn't throw away a paid transcription. |
| 9 | **Model id in an env var; validate API responses with zod** | `gemini-3.5-transcribe` is Preview; SDK input shape is not settled across sources. |

---

## 2. Review of v2 (what still holds, what doesn't)

**Still holds:** model/endpoint/config facts (§3), cost (~$0.30/hour), benchmark-first,
verbatim-only two-pass, token-sequence de-dup, precise privacy statement, data model,
grouping rules, export ordering (SRT/VTT → soft-embed → burn-in).

**Issues found:**

1. **Upload size vs host limits.** v2 planned single uploads up to 25 min. On Vercel that
   fails (4.5 MB body limit). Fixed by change #1. If self-hosting Next.js on Node there's no
   body limit, but 10-min chunks are still better: faster, retryable, parallel.
2. **Request time.** A 25-min transcription with timestamps may not finish in 300s. Phase 0
   now measures latency per minute of audio so the chunk size is chosen from data.
3. **"Backend stitches"** doesn't work with stateless per-chunk requests. Fixed by change #2.
4. **COOP/COEP "from day one"** (v2 §3.4) is costly in Next.js: `require-corp` blocks any
   cross-origin resource without CORP headers (third-party scripts, images, auth widgets).
   Not needed for audio extraction. Deferred to Phase 4, scoped to the editor route.
5. **FFmpeg.wasm memory.** Writing the input video into MEMFS copies the whole file into wasm
   memory (2–4 GB hard ceiling). Mount it with WORKERFS instead (read-only, no copy).
6. **Phase 1 exit said "≤25 min"** while the API allows 30 min with timestamps and the host
   allows much less per request. Now: Phase 1–2 = ≤10 min video; Phase 3 = long videos.
7. **Filler list includes "like", "you know"** — these are often real words. Make them opt-in.
8. **Gap > 300 ms as a hard break** will over-split natural speech. Keep it as a tunable
   default and tune it on the benchmark clips.
9. **Video file can't be restored after refresh** (a `File` isn't persistable). Save the
   transcript; on reload ask the user to re-pick the video and match by name + size + duration.
   (Chromium can persist a `FileSystemFileHandle` — nice-to-have.)
10. **SDK uncertainty.** Sources disagree on the JS `interactions.create` input shape. Use a
    thin `fetch` wrapper over the REST endpoint, validated with zod, shared by the benchmark
    and the route handler.

---

## 3. Verified API facts (carried from v2)

Verified 2026-10-18 against `ai.google.dev/gemini-api/docs/transcribe` and `/pricing`.

| Item | Value |
|---|---|
| Model id | `gemini-3.5-transcribe` (Preview, 2026-09-25) → `GEMINI_MODEL` env var |
| Endpoint | `POST https://generativelanguage.googleapis.com/v1beta/interactions` |
| Auth | `x-goog-api-key` header (server only) |
| Config | `generation_config.transcription_config.mode` |
| Word timestamps | `mode = {"type":"verbatim","timestamp_granularities":["word"]}` |
| Response text | `output_text` |
| Response timing | `steps[].content[].annotations[]` where `type == "word_info"` → `text, speaker, start_offset:"0.100s", end_offset` |
| Language hints | `transcription_config.language_codes` (BCP-47, e.g. `te-IN`, `en-IN`) |
| Diarization | `mode.diarization_mode = "speaker"` (≤8 speakers; 3+ experimental) |
| Custom vocab | `transcription_config.custom_vocabulary`, ≤1000 terms |
| Incompatible | custom vocab ✗ timestamps ✗ diarization; `smart` ✗ timestamps/diarization |
| Duration | 1 h unary; **30 min with timestamps or diarization** |
| Accuracy note | Word timestamps may reduce text accuracy (official) |
| Inputs | wav, mp3, aac, ogg, flac, m4a, **opus**, webm, … |
| Price | ≈ **$0.005/min** blended → 10 min ≈ $0.05, 60 min ≈ $0.30 |
| Files API | for large inputs; 48 h retention — delete after use |
| Inline audio | `input: [{type:"audio", data:<base64>, mime_type}]`; **20 MB max request** |
| Retention | Interactions are stored by default (55 days paid, 1 day free) → send **`store: false`** |
| `output_text` | SDK convenience only; REST clients join `steps[type=model_output].content[type=text].text` |

Hosting facts (Vercel, fluid compute, checked 2026-10-18):

| Limit | Hobby | Pro |
|---|---|---|
| Request/response body | 4.5 MB | 4.5 MB |
| Function max duration | 300s | 800s (1800s beta) |

---

## 4. Stack

| Concern | Choice | Notes |
|---|---|---|
| Framework | **Next.js 16 (App Router), TypeScript strict, React 19** | Turbopack is the default bundler; `proxy.ts` replaces `middleware.ts`. |
| Package manager | pnpm | |
| API | Route handler `app/api/transcribe/route.ts` | `runtime = 'nodejs'`, `maxDuration = 300`. **Not** Server Actions (1 MB default body limit). |
| Gemini client | `lib/server/gemini.ts` (REST `fetch` + zod) | `import 'server-only'`; key in `GEMINI_API_KEY` (never `NEXT_PUBLIC_*`). |
| Audio extraction | **Mediabunny** (WebCodecs) | Streams the file; hardware decoders. |
| Fallback extraction | `@ffmpeg/ffmpeg` single-thread core | Self-hosted in `public/ffmpeg/`, loaded at runtime (not bundled); input mounted with WORKERFS. |
| Editor state | Zustand (+ zundo for undo/redo) | Autosave to IndexedDB (`idb-keyval`). |
| UI | Tailwind CSS + shadcn/ui | `next/font` (self-hosts fonts — matters once COEP is on). |
| Auth (v1) | **None for now** — app-wide daily quota + rate limit cap spend | Add a shared key or real accounts (Phase 5) before sharing the URL widely. |
| Quota / rate limit | Upstash Redis (`@upstash/ratelimit`) | Minutes per day per key/user. |
| Tests | Vitest (pure `lib/`), Playwright (e2e with mocked transcription) | |
| Deploy | Vercel (Hobby is enough for v1) | Self-host on Node also works; nothing Vercel-specific in code. |

---

## 5. Architecture

```
Browser (Next.js client, /editor)
  1. Pick video  → object URL for <video> preview. Never uploaded.
  2. FFmpeg.wasm (worker, WORKERFS mount):
       -vn -ac 1 -ar 16000 -c:a libopus -b:a 24k -application voip → chunk_N.ogg
       ≤10 min per chunk, split near silences, ~2 s overlap
  3. POST /api/transcribe  (raw audio/ogg body, ≤3 chunks in parallel, retry on failure)
        query: ?languages=te-IN,en-IN (optional)
        |
Next.js route handler (stateless)
  4. Reject body > 4.4 MB (no auth for now)
  5. Read duration from the Ogg stream; check + debit quota (Redis)
  6. Gemini interactions call (inline audio):
       default  : verbatim + word timestamps [+ language_codes]
       glossary : pass 1 (verbatim + vocab) ∥ pass 2 (verbatim + timestamps) → align
  7. Parse word_info; "0.100s" → 0.1; return { words: Word[] }   (chunk-local times)
        |
Browser
  8. Add chunk offsets; drop overlap duplicates by token sequence; build Transcript
  9. groupWords() → Caption[]; autosave to IndexedDB
 10. Editor: preview with caption overlay; edit text; nudge/split/merge; undo/redo
 11. Export: SRT/VTT (Phase 2) · soft-embed MP4 (Phase 3) · burn-in MP4 (Phase 4)
```

### Repo layout

```
app/
  page.tsx                  landing + privacy notice
  editor/page.tsx           loads <Editor/> with next/dynamic, ssr:false
  api/transcribe/route.ts   thin backend
components/editor/          VideoPreview, CaptionList, Timeline, ExportMenu
lib/                        pure, unit-tested, shared by client/server/benchmark
  types.ts                  Word, Caption, Transcript
  parse-offsets.ts          "0.100s" → 0.1
  stitch.ts                 chunk offsets + overlap de-dup
  align.ts                  two-pass token alignment
  group-words.ts            caption grouping (§7)
  export/srt.ts, vtt.ts
  ogg-duration.ts           duration from last Ogg page granule (Opus granules are always 48 kHz)
lib/server/gemini.ts        server-only Gemini client + zod schemas
lib/client/ffmpeg.ts        load core, WORKERFS mount, extract + split
store/editor.ts             Zustand store + IndexedDB persistence
benchmark/                  run.ts, clips/, RESULTS.md
public/ffmpeg/              self-hosted core (copied by a postinstall script)
```

---

## 6. Data model (unchanged from v2)

```ts
type Word = { text: string; start: number; end: number; speaker?: string };
type Caption = {
  id: string;
  text: string;      // editable independently of words
  start: number;     // seconds
  end: number;
  words: Word[];     // kept for highlight + re-timing
  lines?: string[];
};
type Transcript = { language?: string; words: Word[]; captions: Caption[] };
```

---

## 7. Caption grouping spec (`groupWords(words, opts)`)

1. **Break** on sentence-end punctuation (`. ! ? …`), gap > `gapMs` (default 300, tune in
   Phase 0), speaker change, or max cue duration.
2. **Pack** ≤2 lines, ≤42 chars/line, ≤20 chars/sec.
3. **Normalize duration:** < 1.0s → extend toward the next cue (never past its start);
   > 6.0s → split at the largest internal gap or nearest clause punctuation.
4. **Fillers:** default removes only `um, uh, hmm` (+ Telugu equivalents). `like`, `you know`
   are opt-in.
5. Keep `words[]` on every cue through split/merge/re-time.

---

## 8. Phase-wise plan

Each phase ends with something runnable and an exit check.

### Phase 0 — Setup + benchmark (blocks Phase 1 decisions)

Goal: confirm the API from TypeScript and decide single-pass vs two-pass, chunk size, and
whether to expose a language selector.

- [x] Scaffold: Next.js 16.4.2 / React 19.3 (TS, App Router, Tailwind), pnpm, Vitest, ESLint.
- [x] `lib/gemini.ts`: REST call + zod schema, retries, `store: false`; input shape confirmed
      against the official docs. (Takes the key as an argument; Phase 1 adds a `server-only`
      wrapper that reads env.)
- [x] `lib/parse-offsets.ts`, `lib/align.ts` + tests.
- [ ] Collect 5–10 clips with hand-made ground truth (text + word timings): names/jargon,
      noisy/overlapping speech, Telugu–English code-switching, fast speech + long pauses.
- [x] `benchmark/run.ts` (`pnpm bench`), configs:
      A verbatim · B verbatim + word timestamps · C B with `language_codes` vs auto ·
      D verbatim + custom vocab. Tested end to end against a mocked API.
- [x] Metrics: WER/CER, mean timing error, % words within ±0.15s, per-script accuracy,
      glossary recall, **latency per audio minute**.
- [x] `benchmark/RESULTS.md` template with decision rules fixed before the run.
- [ ] Run the `_smoke` clip against the real API (needs `GEMINI_API_KEY`).
- [ ] Run the full set and fill in `benchmark/RESULTS.md`.

**Exit:** documented decisions on (1) single vs two-pass, (2) chunk length that finishes well
under 300s, (3) language selector yes/no, (4) default `gapMs`.

### Phase 1 — Pipeline slice (video → words)

Goal: a ≤10 min video produces a correct word list in the browser, end to end.

- [x] Extraction (`lib/client/extract-audio.ts`): **Mediabunny** (WebCodecs, streams the file)
      as the main engine → Ogg Opus mono 24 kbps; **ffmpeg.wasm** fallback (single-thread,
      WORKERFS mount) for formats the browser can't decode. Records where the audio starts on
      the video timeline (`startOffsetSec`).
- [x] ffmpeg.wasm served from `public/ffmpeg/` (copied on `postinstall`) and loaded at
      runtime with `turbopackIgnore`, because Turbopack can't bundle its worker loader.
- [x] `app/api/transcribe/route.ts` → `lib/server/transcribe-handler.ts`: 4.4 MB
      body cap, server-side duration from the Ogg stream (`lib/ogg-duration.ts`),
      quota + rate limit (Upstash, or in-memory for dev) with refund on failure, Gemini
      call, error mapping. No `runtime` export (Cache Components requires Node default).
- [x] Client upload (`lib/client/transcribe-client.ts`): progress, timeout, retry.
- [x] Debug page `/debug`: words with timings, click-to-seek, live highlight.
- [x] Unit tests (handler, quota, Ogg duration); Playwright specs in `e2e/` (mocked API,
      opt-in real call with `E2E_REAL=1`).
- [ ] Two-pass path — waiting on Phase 0 results.
- [ ] Manual check in the browser with real videos; run `pnpm test:e2e`.
- [ ] Measure Mediabunny vs ffmpeg.wasm time/memory on a large (1–2 GB) file.

**Exit:** on 3 test videos ≤10 min, words come back with timings that line up with playback;
quota blocks over-limit requests; the API key never appears in the client bundle
(grep the build output).

### Phase 2 — Editor + SRT/VTT export (MVP)

Goal: usable product for videos ≤10 min.

- [ ] `lib/group-words.ts` + table-driven tests for every rule in §7.
- [ ] Zustand store: transcript, captions, selection, undo/redo; IndexedDB autosave;
      "re-pick your video" flow on reload.
- [ ] Editor UI: video preview with caption overlay (synced with `requestVideoFrameCallback`),
      caption list with inline text edit, nudge ±100 ms, split at cursor, merge with next,
      active-word highlight, keyboard shortcuts (play/pause, next/prev cue).
- [ ] Grouping settings (chars/line, CPS, filler toggle) → re-group from stored words.
- [ ] `lib/export/srt.ts` / `vtt.ts` (UTF-8, `,` vs `.` millisecond separators) + tests.
- [ ] Privacy notice (v2 §3.6): video never leaves the device; audio goes to our server and
      Google; paid-tier key; no retention by us.
- [ ] Playwright e2e: pick fixture video → mocked transcription → edit → download SRT.
- [ ] Deploy to Vercel with env vars set.

**Exit:** a ≤10 min video becomes edited captions and valid SRT/VTT that play correctly in
VLC and a browser `<track>`; all `lib/` tests green; e2e green in CI.

### Phase 3 — Long videos + soft-embed

- [ ] Silence-aware splitting into ≤N-min chunks (N from Phase 0) with ~2s overlap.
- [ ] `lib/stitch.ts`: offsets + longest suffix/prefix token match de-dup + tests
      (including chunk boundaries inside a word and repeated phrases).
- [ ] Parallel chunk upload (cap 3), per-chunk retry, partial-result UI ("chunk 4 failed —
      retry").
- [ ] Soft-embed MP4: `-c:v copy -c:a copy -c:s mov_text` (MKV: `srt`); label it clearly and
      warn that some players hide embedded tracks; keep SRT/VTT alongside.

**Exit:** a 60+ min video round-trips with no duplicated or dropped words at chunk
boundaries; embedded MP4 shows the subtitle track in VLC and QuickTime.

### Phase 4 — Burned-in captions

- [ ] Add `COOP: same-origin` + `COEP: require-corp` via `next.config.ts` `headers()`,
      **scoped to `/editor`**; confirm nothing on that route loads cross-origin.
- [ ] Multi-thread core (`@ffmpeg/core-mt`) for burn-in only; fall back to single-thread.
- [ ] `subtitles`/`ass` filter with a bundled font; style presets (size, position, box).
- [ ] Progress bar + cancel; size/duration cap from testing; refuse over-cap with guidance.

**Exit:** a video under the cap produces a burned-in MP4 within the memory/time budget on a
mid-range laptop; over-cap videos are refused with a clear message.

### Phase 5 — Hardening (only if it becomes multi-user)

- [ ] Real accounts (Auth.js or Clerk); per-user quotas; usage page.
- [ ] Error tracking (Sentry) and request logging without audio or transcript content.
- [ ] Abuse controls: per-IP rate limit in `proxy.ts`, max video length, bot protection.
- [ ] Optional: speaker labels (diarization) as a toggle; local forced alignment
      (WhisperX-style) if Phase 0 timings were poor.

---

## 9. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Word timestamps hurt accuracy | Worse captions | Phase 0 decides; two-pass for glossary files |
| Gemini call > 300s | 504s | Chunk length from Phase 0 latency; Pro plan raises to 800s |
| Preview model changes/deprecates | Breakage | `GEMINI_MODEL` env var; zod catches shape changes early |
| FFmpeg.wasm slow / OOM on large files | Can't extract | WORKERFS; Mediabunny fallback |
| Overlap de-dup errors | Duplicated/missing words | Token-sequence matching + boundary test cases |
| COEP breaks other assets | Broken editor page | Only in Phase 4, only on `/editor`, self-host everything |
| Abuse of the API key | Cost | App-wide quota + rate limit (no auth yet); add auth before sharing the URL |

---

## 10. Decisions to confirm

1. **Hosting:** Vercel (recommended; plan fits Hobby limits) or self-hosted Node?
2. **Audience:** personal tool or multi-user product? (Access key removed for now; decides what auth Phase 5 adds.)
3. **Language default:** auto-detect, or default to `te-IN` + `en-IN` hints? (Phase 0 informs.)
4. **UI kit:** Tailwind + shadcn/ui OK?
5. **Start:** Phase 0 scaffold + benchmark (recommended).
