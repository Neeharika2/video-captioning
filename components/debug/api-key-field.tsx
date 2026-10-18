"use client";

import { useState } from "react";
import { API_KEY_HEADER } from "@/lib/api-types";
import { maskApiKey } from "@/lib/client/api-key";

type TestState =
  | { step: "idle" }
  | { step: "testing" }
  | { step: "ok"; model: string }
  | { step: "error"; message: string };

/**
 * The visitor's own Gemini API key. Saved to localStorage by the caller, sent on
 * every Gemini-backed request, and never stored server-side.
 */
export function ApiKeyField({ value, onChange }: { value: string | null; onChange: (key: string | null) => void }) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [test, setTest] = useState<TestState>({ step: "idle" });

  const save = () => {
    const key = draft.trim();
    if (!key) return;
    onChange(key);
    setDraft("");
    setEditing(false);
    setTest({ step: "idle" });
  };

  const runTest = async () => {
    if (!value) return;
    setTest({ step: "testing" });
    try {
      const res = await fetch("/api/key-check", { method: "POST", headers: { [API_KEY_HEADER]: value } });
      const json = (await res.json()) as { ok: boolean; model?: string; error?: string };
      setTest(
        json.ok
          ? { step: "ok", model: json.model ?? "" }
          : { step: "error", message: json.error ?? "The key was rejected" },
      );
    } catch (err) {
      setTest({ step: "error", message: (err as Error).message });
    }
  };

  const showInput = !value || editing;

  return (
    <div className="flex flex-col gap-2" data-testid="api-key">
      <div className="flex items-center gap-2">
        <span className="font-medium">Your Gemini API key</span>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium tracking-wide text-amber-700 uppercase dark:bg-amber-500/15 dark:text-amber-400">
          required
        </span>
      </div>

      {showInput ? (
        <div className="flex items-center gap-2">
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            data-testid="api-key-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save();
              }
            }}
            placeholder="AIza… or AQ.…"
            className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-transparent px-3 py-2 font-mono text-xs dark:border-zinc-700"
          />
          <button
            type="button"
            data-testid="api-key-save"
            onClick={save}
            disabled={!draft.trim()}
            className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Save
          </button>
          {value && (
            <button type="button" onClick={() => setEditing(false)} className="text-sm text-zinc-500 hover:text-zinc-900">
              Cancel
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded-lg bg-zinc-100 px-2 py-1 font-mono text-xs dark:bg-zinc-900">{maskApiKey(value)}</code>
          <button type="button" data-testid="api-key-test" onClick={runTest} className="text-sm underline">
            Test
          </button>
          <button type="button" onClick={() => setEditing(true)} className="text-sm underline">
            Change
          </button>
          <button
            type="button"
            data-testid="api-key-remove"
            onClick={() => {
              onChange(null);
              setTest({ step: "idle" });
            }}
            className="text-sm text-zinc-500 underline hover:text-red-600"
          >
            Remove
          </button>
        </div>
      )}

      {test.step === "testing" && <p className="text-xs text-zinc-500">Checking key…</p>}
      {test.step === "ok" && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400" data-testid="api-key-status">
          Key works{test.model ? ` (${test.model})` : ""}.
        </p>
      )}
      {test.step === "error" && (
        <p className="text-xs text-red-600" data-testid="api-key-status">
          {test.message}
        </p>
      )}

      <p className="text-xs text-zinc-500">
        Stored only in this browser and sent with each request; it is never saved on the server. Usage and limits are
        billed to your own Google account. Get a key at{" "}
        <a
          href="https://aistudio.google.com/apikey"
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          aistudio.google.com/apikey
        </a>
        . Free-tier keys allow 25 transcription requests per day.
      </p>
    </div>
  );
}
