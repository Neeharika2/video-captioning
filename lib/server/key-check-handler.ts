import "server-only";
import { checkApiKey } from "../gemini";
import { missingKeyMessage, readApiKey } from "./api-key";
import { getConfig, type ServerConfig } from "./config";

export type KeyCheckDeps = {
  config?: ServerConfig;
  check?: typeof checkApiKey;
};

/**
 * POST /api/key-check
 *
 * Verifies the visitor's key by reading model metadata (free, instant). Always
 * answers 200 with `{ ok }` so the UI can show the reason inline. The key is
 * forwarded to Google and never stored or logged.
 */
export async function handleKeyCheck(request: Request, deps: KeyCheckDeps = {}): Promise<Response> {
  const config = deps.config ?? getConfig();
  const apiKey = readApiKey(request);
  if (!apiKey.ok) {
    return Response.json(
      { ok: false, error: missingKeyMessage(apiKey.reason) },
      { headers: { "cache-control": "no-store" } },
    );
  }
  const result = await (deps.check ?? checkApiKey)({
    apiKey: apiKey.key,
    model: config.geminiModel,
    signal: request.signal,
  });
  return Response.json(result, { headers: { "cache-control": "no-store" } });
}
