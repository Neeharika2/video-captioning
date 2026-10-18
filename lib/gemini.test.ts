import { describe, expect, it, vi } from "vitest";
import { buildTranscriptionBody, GeminiError, parseInteraction, transcribe } from "./gemini";

// Response example from https://ai.google.dev/gemini-api/docs/transcribe
const docsResponse = {
  id: "interactions/abc123xyz",
  status: "completed",
  steps: [
    {
      id: "step_001",
      type: "model_output",
      content: [
        {
          type: "text",
          text: "Hello world",
          annotations: [
            { type: "word_info", text: "Hello", speaker: "spk_1", start_offset: "0.100s", end_offset: "0.450s" },
            { type: "word_info", text: "world", speaker: "spk_1", start_offset: "0.500s", end_offset: "0.850s" },
          ],
        },
      ],
    },
  ],
};

describe("buildTranscriptionBody", () => {
  it("builds a verbatim + word timestamp request with store=false", () => {
    const body = buildTranscriptionBody("m", "QUJD", "audio/ogg", {
      timestamps: true,
      languageCodes: ["te-IN", "en-IN"],
    });
    expect(body).toEqual({
      model: "m",
      input: [{ type: "audio", data: "QUJD", mime_type: "audio/ogg" }],
      generation_config: {
        transcription_config: {
          mode: { type: "verbatim", timestamp_granularities: ["word"] },
          language_codes: ["te-IN", "en-IN"],
        },
      },
      store: false,
    });
  });

  it("adds custom vocabulary without timestamps", () => {
    const body = buildTranscriptionBody("m", "", "audio/ogg", { customVocabulary: ["Kubernetes", " "] });
    expect(body.generation_config.transcription_config).toEqual({
      mode: { type: "verbatim" },
      custom_vocabulary: ["Kubernetes"],
    });
  });

  it("rejects vocabulary combined with timestamps or diarization", () => {
    expect(() => buildTranscriptionBody("m", "", "a", { customVocabulary: ["x"], timestamps: true })).toThrow(
      GeminiError,
    );
    expect(() => buildTranscriptionBody("m", "", "a", { customVocabulary: ["x"], diarization: true })).toThrow(
      GeminiError,
    );
  });
});

describe("parseInteraction", () => {
  it("parses the documented response", () => {
    const res = parseInteraction(docsResponse);
    expect(res.text).toBe("Hello world");
    expect(res.interactionId).toBe("interactions/abc123xyz");
    expect(res.words).toEqual([
      { text: "Hello", start: 0.1, end: 0.45, speaker: "spk_1" },
      { text: "world", start: 0.5, end: 0.85, speaker: "spk_1" },
    ]);
  });

  it("prefers output_text and ignores user_input steps and unknown annotations", () => {
    const res = parseInteraction({
      output_text: "Hi",
      steps: [
        { type: "user_input", content: [{ type: "text", text: "ignored" }] },
        { type: "model_output", content: [{ type: "text", text: "Hi", annotations: [{ type: "citation" }] }] },
      ],
    });
    expect(res.text).toBe("Hi");
    expect(res.words).toEqual([]);
  });

  it("fails loudly on malformed word_info or incomplete status", () => {
    expect(() =>
      parseInteraction({
        steps: [{ content: [{ type: "text", annotations: [{ type: "word_info", text: "x" }] }] }],
      }),
    ).toThrow(/Malformed word_info/);
    expect(() => parseInteraction({ status: "in_progress" })).toThrow(/not completed/);
  });
});

describe("transcribe", () => {
  const audio = new Uint8Array([1, 2, 3]);
  const ok = () => new Response(JSON.stringify(docsResponse), { status: 200 });

  it("sends the key in a header and returns words", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => ok());
    const res = await transcribe({ apiKey: "k", audio, mimeType: "audio/ogg", timestamps: true, fetch: fetchMock });
    expect(res.words).toHaveLength(2);
    const init = fetchMock.mock.calls[0][1]!;
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("k");
    expect(JSON.parse(init.body as string).input[0].data).toBe("AQID");
  });

  it("retries on 503 then succeeds", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "busy" } }), { status: 503 }))
      .mockResolvedValueOnce(ok());
    const p = transcribe({ apiKey: "k", audio, mimeType: "audio/ogg", fetch: fetchMock });
    await vi.runAllTimersAsync();
    const res = await p;
    expect(res.attempts).toBe(2);
    vi.useRealTimers();
  });

  it("does not retry on 400", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ error: { message: "bad config" } }), { status: 400 }),
    );
    await expect(transcribe({ apiKey: "k", audio, mimeType: "audio/ogg", fetch: fetchMock })).rejects.toThrow(
      "Gemini 400: bad config",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
