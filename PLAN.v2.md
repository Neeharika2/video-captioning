# Local-first AI caption editor — reviewed & executable plan

Status: draft v2 (supersedes the plan pasted in chat)
Date: 2026-10-18
Scope: browser audio extraction + thin backend + Gemini transcription + caption editor/export

---

## 1. Verdict

The architecture is sound and — importantly — it matches the **real** API. The pasted
plan named the right model, the right endpoint, the right config key, and the right
response shape. Its central risk (word timestamps may reduce text accuracy) is a
documented, real limitation, and the plan's "benchmark first" instinct is correct.

What the plan needs before coding:

1. **Chunking location is undecided.** The plan says "backend splits at silences," but a
   *thin backend* has no ffmpeg. Decide: browser splits (recommended) or backend gains ffmpeg.
2. **The two-pass fallback is under-specified** and, as written, would break alignment.
   Pass 1 must *not* use `smart` mode. The alignment step needs to be defined.
3. **Integration details are missing:** Files API vs inline bytes, async/timeout handling,
   overlap de-duplication algorithm, FFmpeg.wasm cross-origin isolation, the actual data model.
4. **Cost is stated as a to-do** — it's now known: **≈ $0.005/min**, i.e. **≈ $0.30/hour**.
5. **Privacy nuance:** "audio goes to Google" is true, but the free tier *trains on it*.
   The product must state paid-tier handling and that your backend sees the audio.

Everything else in the plan (grouping rules, export ordering, soft-embed before burn-in)
is reasonable and is carried forward.

---

## 2. Verified API facts (source of truth)

Verified 2026-10-18 against `ai.google.dev/gemini-api/docs/transcribe` and `/pricing`.

| Item | Verified value |
|---|---|
| Model id | `gemini-3.5-transcribe` (Preview; released 2026-09-25) |
| Endpoint | `POST https://generativelanguage.googleapis.com/v1beta/interactions` |
| Auth | `x-goog-api-key: <key>` (backend only) |
| SDK | `client.interactions.create(...)` (google-genai) |
| Config path | `generation_config.transcription_config.mode` |
| Word timestamps | `mode = {"type": "verbatim", "timestamp_granularities": ["word"]}` |
| Response text | `interaction.output_text` |
| Response timing | `steps[].content[].annotations[]` where `type == "word_info"` |
| Annotation fields | `text`, `speaker`, `start_offset: "0.100s"`, `end_offset: "0.450s"` (strings, seconds) |
| Language hints | `transcription_config.language_codes`, BCP-47 array (`te-IN`, `en-IN` supported) |
| Diarization | `mode.diarization_mode = "speaker"` (up to 8 spk; 3+ experimental) |
| Custom vocab | `transcription_config.custom_vocabulary`, up to 1000 terms |
| **Incompatibilities** | `custom_vocabulary` ✗ with timestamps ✗ with diarization; `smart` mode ✗ with timestamps/diarization |
| Duration limits | 1 hour unary; **30 min when timestamps or diarization enabled** |
| Accuracy note | Enabling word timestamps **may degrade overall transcription accuracy** (official) |
| Supported input | wav, mp3, aiff, aac, ogg, flac, mpeg, m4a, l16, **opus**, alaw, mulaw, webm |
| Pricing | $2.00/M input ($0.003/min audio) + $12.00/M output ($0.002/min text) |
| Pricing model | audio = 25 tokens/sec input; ~175 text tokens/min output → **≈ $0.005/min blended** |
| Large files | Files API recommended for >20MB / long recordings (48h retention) |

### Cost math (for quota + rate-limit design)

- 30 min audio ≈ **$0.15**; 60 min ≈ **$0.30**.
- Two-pass fallback ≈ 2× on affected files (only where custom vocab is used — see §5).
- Chunk overlap (~2s × N) adds ~0.1% per chunk. Negligible.
- Cost is low enough that the real risk is abuse, not unit economics → per-user quotas matter.

---

## 3. Corrections and sharpened risks

### 3.1 Chunking location (architecture change)
A thin backend holding only the Gemini key cannot silence-split audio without ffmpeg.
**Decision: split in the browser.** The browser already runs FFmpeg.wasm and owns the
audio. It emits N compressed Opus chunk files (with ~2s overlap) and uploads them; the
backend forwards each to Gemini and stitches. This keeps the backend stateless and
dependency-free. (Alternative: one upload + server ffmpeg + `silencedetect`. Rejected for v1.)

### 3.2 Two-pass fallback — corrected
The pasted plan implies pass 1 could be any plain transcription. It must be `verbatim`
(never `smart`) or formatting/renumbering destroys alignment:
- **Pass 1 (text):** `{"type": "verbatim"}` + `custom_vocabulary` (no timestamps).
- **Pass 2 (timing):** `{"type": "verbatim", "timestamp_granularities": ["word"]}`.
- **Align:** normalize/tokenize both, sequence-align (edit distance / difflib), map
  pass-1 tokens onto pass-2 tokens to inherit offsets; interpolate inserted tokens.
- **Only run two passes when a glossary is supplied.** Default path is single-pass with
  timestamps. This bounds extra cost to files that actually use custom vocabulary.

### 3.3 Overlap de-duplication (spec'd)
Each chunk's offsets are chunk-local. Per chunk: `global = local + chunkStart - overlapBefore`.
De-dup by **token sequence in the overlap window**, not by raw time: find the longest
suffix of chunk N−1 that matches a prefix of chunk N and drop the duplicate run.
Time-only matching is fragile because it double-counts or clips words.

### 3.4 FFmpeg.wasm needs cross-origin isolation
Multi-threaded wasm + larger memory requires `Cross-Origin-Opener-Policy: same-origin`
and `Cross-Origin-Embedder-Policy: require-corp` on the app origin. Without it, extraction
and (Phase 3) burn-in fall back to single-thread and may OOM. Set headers from day one.

### 3.5 Soft-embed specifics
`-c:v copy -c:a copy` preserves streams; the subtitle stream is new and must be muxed as
`mov_text` for MP4 (SRT is not an MP4 codec; MKV accepts `srt`/`ass`). Use
`-c:s mov_text` for `.mp4`. Keep the "players may ignore embedded tracks" warning, and
**always offer SRT/VTT** alongside.

### 3.6 Privacy statement must be precise
Say: (a) the video never leaves the device; (b) compressed audio is uploaded to *our
backend* and forwarded to Google; (c) on the **paid** tier Google does not use data to
improve products (free tier does) — so run the backend on a paid key; (d) audio is not
retained by us beyond the request (or state the retention you choose). This is a selling
point *only* if it's accurate.

### 3.7 Request lifecycle (missing)
A 30-min unary request is slow. Add: client-visible progress, server-side timeout +
bounded retries with idempotency keys, concurrency cap, and a clear failure/partial-result
path. Consider the Interactions **background execution** mode for long chunks.

### 3.8 Inline vs Files API
16 kHz mono Opus at ~24 kbps ≈ **5.4 MB per 30 min** (≈7.2 MB base64) — likely fits inline,
but verify the inline/payload limit. Files API is the fallback for large/long inputs; if
used, delete the uploaded file after the request (48h retention is not a cleanup plan).

### 3.9 Benchmark rigor
"Checked by eye" is fine for a smoke test but not a decision. Define metrics + ground truth
(see §6) so the single-vs-two-pass decision is defensible and repeatable.
Optional heavier alternative if timestamps hurt badly: local forced-alignment (e.g.
wav2vec2/WhisperX) over accurate text — keeps timings accurate without a second Gemini pass.
Keep as a fallback, not v1.

---

## 4. Revised architecture

```
Browser (React)
  1. Pick video (never uploaded)
  2. FFmpeg.wasm: demux → 16 kHz mono Opus (~24 kbps), optionally split into <=25 min
     chunks at silences with ~2s overlap
  3. Upload chunk audio (or single file if <=25 min)
        |
Backend (thin: auth + quota + Gemini key)
  4. Verify token, enforce per-user quota/rate limit
  5. Upload to Gemini (inline bytes, or Files API if large)
  6. interactions.create(gemini-3.5-transcribe, verbatim + word timestamps [, language_codes])
     (If glossary supplied: pass 1 verbatim+vocab, pass 2 timestamps, then align)
  7. Parse word_info annotations; "0.100s" -> 0.1 (number)
  8. Add chunk offset; de-dup overlap by token sequence
  9. Return {words:[{text,start,end,speaker?}]}
        |
Browser
 10. Group words into captions (see §7)
 11. Editor: preview + caption list; edit text; nudge/split/merge timing
 12. Export: SRT/VTT (Phase 1); soft-embed MP4 (Phase 2); burn-in (Phase 3)
```

---

## 5. Data model

```ts
type Word = { text: string; start: number; end: number; speaker?: string };
type Caption = {
  id: string;
  text: string;          // may be edited independently of words
  start: number;         // seconds
  end: number;
  words: Word[];         // preserved for word-highlight and re-timing
  lines?: string[];      // presentation wrapping
};
type Transcript = {
  language?: string;     // detected or hinted
  words: Word[];         // source of truth
  captions: Caption[];   // derived, editable
};
```

Keep per-word timings permanently — they enable word highlighting and cheap re-grouping
when the user changes line-length or reading-speed settings.

---

## 6. Phase 0 — benchmark (do this first)

**Goal:** decide single-pass (timestamps on) vs two-pass, and whether language hints help.

**Clips (5–10), each with a hand-made ground-truth transcript and ground-truth timestamps:**
- proper names + technical jargon (tests custom vocab)
- noisy/overlapping speech
- Telugu-English code-switching (the plan's hardest case)
- fast speech and long pauses (tests grouping)

**Runs per clip:**
| # | Config | Measures |
|---|---|---|
| A | verbatim, no timestamps, no vocab | text baseline (WER/CER) |
| B | verbatim + word timestamps | text WER/CER **and** timing error |
| C | verbatim + language_codes set vs auto | language/code-switch accuracy |
| D | verbatim + custom_vocabulary (no timestamps) | jargon recovery |

**Metrics:** WER/CER vs ground truth; timing error = mean |predicted − truth| over sampled
words; % words within ±0.15s; code-switch token accuracy.

**Decision rule:**
- If WER(B) − WER(A) is small → **single-pass with timestamps** (default).
- If WER(B) is clearly worse → **two-pass only when a glossary is present** (§3.2).
- If language hints improve C noticeably → expose a language selector (default auto).

Deliverable: `benchmark/run.ts` + `benchmark/clips/` + a results table in `benchmark/RESULTS.md`.

---

## 7. Caption grouping spec (concrete)

Input: `Word[]`. Output: `Caption[]`.

1. **Break points:** word ends with `.` `!` `?` `…`, OR inter-word gap > 300 ms, OR speaker
   change, OR cue reaches max duration.
2. **Pack lines:** max 2 lines; target ≤42 chars/line; also enforce CPS (chars/sec) ≤ ~20.
3. **Duration normalization:**
   - cue < 1.0s → extend end toward next cue (never past next cue start), min 1.0s where possible.
   - cue > 6.0s → split at the largest internal gap or nearest clause punctuation.
4. **Filler removal:** default on; language-aware filler list (`um, uh, hmm, like, you know`,
   Telugu equivalents) with a toggle to keep.
5. Preserve `words[]` on each cue after split/merge/re-time.

Unit-testable pure function: `groupWords(words, opts) -> Caption[]`.

---

## 8. Phased work plan

### Phase 0 — Benchmark (blocking)
- [ ] Collect clips + ground truth (text + timings).
- [ ] `benchmark/run.ts` calling the API with configs A–D.
- [ ] Compute metrics; write `benchmark/RESULTS.md` with the go/no-go decision.
- **Exit:** single-pass vs two-pass decided and documented.

### Phase 1 — MVP
- [ ] Browser: FFmpeg.wasm extraction → 16 kHz mono Opus; COOP/COEP headers; progress UI.
- [ ] Backend: auth, per-user quota, Gemini proxy, word-info parsing, `"0.100s"→0.1`.
- [ ] Browser: `groupWords()` + unit tests.
- [ ] Editor: preview with live captions; edit text; nudge/split/merge; keep word timings.
- [ ] Export SRT + VTT (UTF-8, correct `,`/`.` separators; 2-line wrap per rules).
- [ ] Privacy notice (precise per §3.6).
- **Exit:** ≤25 min video → edited captions → correct SRT/VTT; grouping tests green.

### Phase 2 — Long videos + soft-embed
- [ ] Browser chunking (silence split, ~2s overlap, ≤25 min chunks) + offset math.
- [ ] Backend stitch + token-sequence overlap de-dup (§3.3).
- [ ] Soft-embed MP4: `-c:v copy -c:a copy -c:s mov_text`; labeled separately; warning copy.
- **Exit:** 60+ min video round-trips with no duplicated/dropped words; embedded MP4 plays
  the subtitle track in a mainstream player.

### Phase 3 — Burned-in captions
- [ ] Re-encode in FFmpeg.wasm with bundled font + progress bar.
- [ ] Size/duration caps from testing; warning above cap.
- **Exit:** ≤cap video produces burned-in MP4 within memory/time budget; over-cap is refused
  with clear guidance.

---

## 9. Decisions to confirm

1. Backend runtime/deploy (affects auth + quota): Node/Express, Next.js route handlers,
   or Cloudflare Workers?
2. Solo tool vs multi-user product (affects auth, quotas, abuse controls).
3. Audio format for upload: 16 kHz mono Opus (recommended) — confirm.
4. Auth in v1: real accounts, or a shared access key for personal use?
5. Start point: benchmark harness (recommended, it gates the rest) or `groupWords()`.

---

## 10. Suggested order of work (mapped to the original)

1. Benchmark harness + run it  ← Phase 0, **start here**
2. Backend endpoint + word-info parsing  ← Phase 1
3. `groupWords()` + tests  ← Phase 1
4. Editor UI + SRT/VTT export  ← Phase 1
5. Soft-embed → chunking → burn-in  ← Phases 2–3
