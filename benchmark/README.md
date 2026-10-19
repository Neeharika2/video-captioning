# Phase 0 benchmark

Compares Gemini transcription configs on clips where you know the right answer, so the
single-pass vs two-pass decision (PLAN.md §8, Phase 0) is based on numbers.

| Config | What it sends | Answers |
|---|---|---|
| A | verbatim | text accuracy baseline |
| B | verbatim + word timestamps | do timestamps hurt accuracy? timing error |
| D | verbatim + `custom_vocabulary` from `truth.json` | does a glossary fix jargon? |

D only runs for clips that have `glossary`.

## Setup

1. Copy `.env.example` to `.env.local` and set `GEMINI_API_KEY` (use a **paid-tier** key —
   free-tier audio can be used for training).
2. Check the plumbing with the synthetic clip (≈ $0.003):
   ```bash
   pnpm bench --clips _smoke --dry-run   # converts audio, prints plan, no API calls
   pnpm bench --clips _smoke
   ```

## Adding a clip

One folder per clip in `benchmark/clips/<id>/` (audio files are git-ignored):

```
benchmark/clips/telugu-vlog-1/
  audio.mp4        any audio/video file (wav, mp3, m4a, mp4, mkv, webm, …), 1–10 min
  truth.json
```

`truth.json`:

```json
{
  "text": "Verbatim transcript of everything said, including um and uh.",
  "glossary": ["Kubernetes", "Ravi Teja"],
  "words": [
    { "text": "Kubernetes", "start": 12.34, "end": 13.02 },
    { "text": "నమస్కారం", "start": 0.48, "end": 1.21 }
  ],
  "notes": "optional free text"
}
```

- **`text`** (required): verbatim, including fillers and false starts, since every config is
  verbatim. Case and punctuation don't matter (scoring normalizes them).
- **Code-switching convention:** write each word in the script it should appear in captions
  (e.g. English words in Latin script inside Telugu speech). The model is scored against this,
  so pick one convention and use it in every clip.
- **`words`** (optional, enables timing metrics): 20–30 hand-timed words per clip is enough.
  Spread them across the clip. Easiest way: open the audio in Audacity, zoom in, and read
  the start/end of each word from the selection toolbar.
- `glossary` is optional and enables config D.

Target set (5–10 clips): names + jargon, noisy/overlapping speech, code-switching,
fast speech, long pauses.

## Running

```bash
pnpm bench                              # all clips, configs A, B, D
pnpm bench --clips a,b --configs A,B    # subset
pnpm bench --repeat 3                   # repeat to see run-to-run variance
pnpm bench --model gemini-3.5-transcribe
```

Each run writes `benchmark/results/<timestamp>/`:
- `report.md`: per-run and per-config tables, plus decision hints
- `rows.json`: the numbers
- `runs/<clip>.<config>.<n>.json`: transcript, words, and raw API response

Audio is converted once to the app's upload format (16 kHz mono Opus, 24 kbps) and cached in
`benchmark/.cache/`, so the benchmark measures exactly what the app will send.

## Metrics

- **WER / CER**: word / character error rate vs `text` (CER counts Telugu grapheme clusters).
- **Telugu / Latin acc**: share of reference words in each script that came back exactly right.
- **Glossary**: share of glossary-term occurrences in the reference found in the output.
- **Timing**: for each hand-timed word, the nearest same-text output word within 2 s; mean
  start error and share with start and end both within ±0.15 s.
- **s per audio min**: request latency divided by clip length. Used to pick the chunk size.
