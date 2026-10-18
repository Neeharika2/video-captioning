# Phase 0 results

Status: **not run yet** — needs real clips and an API key (see README.md).

## Decision rules (agreed before looking at the numbers)

| Question | Rule | Outcome if true |
|---|---|---|
| Single-pass with timestamps? | WER(B) − WER(A) ≤ **1.0 pp** on the full set, and no clip worse by > 3 pp | Single-pass is the default |
| Otherwise | | Two-pass (text pass ∥ timing pass + align) only when a glossary is given |
| Glossary worth supporting? | Glossary recall D − A ≥ **20 pp** on jargon clips | Ship the glossary feature (needs two-pass) |
| Language selector? | WER(C) − WER(B) ≤ **−2 pp** on code-switching clips | Show a language picker (default auto) |
| Timing good enough? | ≥ **80%** of timed words within ±0.15 s in B | Use Gemini timings; otherwise plan forced alignment |
| Chunk length | 2× safety margin under the 300 s function limit | Use the chunk length from the report |

## Clips

| Id | Length | Content | Languages | Glossary | Timed words |
|---|---|---|---|---|---|
| | | | | | |

## Results

Paste the "Per config" table and decision hints from `results/<timestamp>/report.md`.

## Decisions

1. Single vs two-pass:
2. Glossary feature:
3. Language selector:
4. Gemini timings vs forced alignment:
5. Chunk length (minutes):
6. Caption gap threshold (`gapMs`, default 300):
