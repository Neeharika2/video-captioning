import { describe, expect, it } from "vitest";
import { API_KEY_HEADER } from "../api-types";
import { apiKeyId, readApiKey } from "./api-key";

const request = (key?: string | null) =>
  new Request("http://localhost/api/transcribe", key ? { headers: { [API_KEY_HEADER]: key } } : undefined);

const VALID = "AIzaSyTEST-key_0123456789";

describe("readApiKey", () => {
  it("accepts a plausible Google key and derives a stable id", () => {
    const first = readApiKey(request(VALID));
    const second = readApiKey(request(`  ${VALID}  `));
    expect(first).toMatchObject({ ok: true, key: VALID });
    expect(second).toMatchObject({ ok: true, key: VALID });
    expect(first.ok && first.id).toBe(second.ok && second.id);
    expect(first.ok && first.id).toBe(apiKeyId(VALID));
  });

  it("reports a missing key", () => {
    expect(readApiKey(request())).toEqual({ ok: false, reason: "missing" });
  });

  it("rejects keys that are too short or contain spaces", () => {
    expect(readApiKey(request("short"))).toMatchObject({ ok: false, reason: "invalid" });
    expect(readApiKey(request("AIza Sy with a space 123456"))).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("never leaks the key through the id", () => {
    const id = apiKeyId(VALID);
    expect(id).toHaveLength(16);
    expect(VALID).not.toContain(id);
    expect(id).not.toContain(VALID.slice(0, 8));
    expect(apiKeyId("AIzaSyOTHER-key_9876543210")).not.toBe(id);
  });
});
