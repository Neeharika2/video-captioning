import { handleKeyCheck } from "@/lib/server/key-check-handler";

// One metadata read from Gemini; fast. No `runtime` export: Cache Components
// requires the default Node.js runtime.
export const maxDuration = 30;

export async function POST(request: Request) {
  return handleKeyCheck(request);
}
