/**
 * The visitor's own Gemini API key, kept in this browser only.
 *
 * Stored under its own localStorage key (not in the settings blob) so it is easy
 * to clear and never accidentally exported with words JSON. It is sent on each
 * request in the `x-gemini-api-key` header; the server forwards it to Google and
 * does not store it.
 */
import { API_KEY_HEADER } from "../api-types";

export const API_KEY_STORAGE_KEY = "vc.geminiApiKey";

export function getApiKey(): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const key = localStorage.getItem(API_KEY_STORAGE_KEY)?.trim();
    return key ? key : null;
  } catch {
    return null;
  }
}

export function setApiKey(key: string): void {
  try {
    localStorage.setItem(API_KEY_STORAGE_KEY, key.trim());
  } catch {
    /* storage unavailable: the key just won't persist */
  }
}

export function clearApiKey(): void {
  try {
    localStorage.removeItem(API_KEY_STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
}

/** "AIzaSy…f4c9" — enough to recognise a key without showing all of it. */
export function maskApiKey(key: string): string {
  if (key.length <= 12) return `${key.slice(0, 3)}…`;
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

export function apiKeyHeaders(key?: string | null): Record<string, string> {
  return key ? { [API_KEY_HEADER]: key } : {};
}
