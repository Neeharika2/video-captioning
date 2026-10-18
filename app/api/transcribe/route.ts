import { handleTranscribe } from "@/lib/server/transcribe-handler";

// Vercel Hobby's ceiling. No `runtime` export: Cache Components requires the
// default Node.js runtime.
export const maxDuration = 300;

export async function POST(request: Request) {
  return handleTranscribe(request);
}
