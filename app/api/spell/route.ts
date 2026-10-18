import { handleSpell } from "@/lib/server/spell-handler";

// One batch takes a few seconds; allow for a retry. No `runtime` export:
// Cache Components requires the default Node.js runtime.
export const maxDuration = 120;

export async function POST(request: Request) {
  return handleSpell(request);
}
