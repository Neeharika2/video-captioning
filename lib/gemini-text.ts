/**
 * Minimal Gemini text client (generateContent) returning structured JSON.
 * Server/benchmark only: takes the API key as an argument, never reads env.
 */
import { z } from "zod";
import { backoffMs, GeminiError, RETRYABLE_STATUS, sleep } from "./gemini";

export const GENERATE_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
/** Fast and cheap; matched gemini-3.8-flash on spelling in our tests. */
export const DEFAULT_TEXT_MODEL = "gemini-3.5-flash-lite";

export type GenerateJsonRequest = {
  apiKey: string;
  model?: string;
  system: string;
  prompt: string;
  /** JSON Schema the response must follow. */
  schema: object;
  /** Per-attempt timeout. Default 60 s. */
  timeoutMs?: number;
  /** Total attempts for 429 / 5xx / network errors. Default 2. */
  maxAttempts?: number;
  fetch?: typeof fetch;
  signal?: AbortSignal;
};

export type GenerateJsonResult = {
  json: unknown;
  usage?: unknown;
  latencyMs: number;
  attempts: number;
  finishReason?: string;
};

const ResponseSchema = z.looseObject({
  candidates: z
    .array(
      z.looseObject({
        finishReason: z.string().optional(),
        content: z
          .looseObject({
            parts: z.array(z.looseObject({ text: z.string().optional(), thought: z.boolean().optional() })).optional(),
          })
          .optional(),
      }),
    )
    .optional(),
  usageMetadata: z.unknown().optional(),
  promptFeedback: z.looseObject({ blockReason: z.string().optional() }).optional(),
});

export async function generateJson(req: GenerateJsonRequest): Promise<GenerateJsonResult> {
  const doFetch = req.fetch ?? globalThis.fetch;
  const url = `${GENERATE_ENDPOINT}/${encodeURIComponent(req.model ?? DEFAULT_TEXT_MODEL)}:generateContent`;
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: req.system }] },
    contents: [{ role: "user", parts: [{ text: req.prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseJsonSchema: req.schema,
      // Spelling is a lookup task; long reasoning only adds latency.
      thinkingConfig: { thinkingLevel: "low" },
    },
  });
  const maxAttempts = req.maxAttempts ?? 2;
  const started = Date.now();

  for (let attempt = 1; ; attempt++) {
    const timeout = AbortSignal.timeout(req.timeoutMs ?? 60_000);
    const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout;
    let res: Response;
    try {
      res = await doFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": req.apiKey },
        body,
        signal,
      });
    } catch (err) {
      if (timeout.aborted) throw new GeminiError("Gemini request timed out", undefined, true);
      if (req.signal?.aborted) throw err;
      if (attempt >= maxAttempts) throw new GeminiError(`Network error: ${(err as Error).message}`, undefined, true);
      await sleep(backoffMs(attempt));
      continue;
    }

    if (res.ok) {
      const parsed = ResponseSchema.safeParse(await res.json());
      if (!parsed.success) throw new GeminiError(`Unexpected response shape: ${parsed.error.message}`);
      const data = parsed.data;
      if (data.promptFeedback?.blockReason) {
        throw new GeminiError(`Request blocked (${data.promptFeedback.blockReason})`);
      }
      const candidate = data.candidates?.[0];
      const text = (candidate?.content?.parts ?? [])
        .filter((p) => !p.thought && p.text)
        .map((p) => p.text)
        .join("");
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        // Usually a cut-off answer (finishReason MAX_TOKENS).
        throw new GeminiError(`Model returned invalid JSON (finish: ${candidate?.finishReason ?? "unknown"})`);
      }
      return {
        json,
        usage: data.usageMetadata,
        latencyMs: Date.now() - started,
        attempts: attempt,
        finishReason: candidate?.finishReason,
      };
    }

    const errBody = await res.json().catch(() => undefined);
    const message = (errBody as { error?: { message?: string } } | undefined)?.error?.message ?? res.statusText;
    const retryable = RETRYABLE_STATUS.has(res.status);
    if (!retryable || attempt >= maxAttempts) {
      throw new GeminiError(`Gemini ${res.status}: ${message}`, res.status, retryable, errBody);
    }
    const retryAfter = Number(res.headers.get("retry-after"));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoffMs(attempt));
  }
}
