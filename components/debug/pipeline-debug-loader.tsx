"use client";

import dynamic from "next/dynamic";

// Browser-only page: it reads localStorage and uses WebCodecs / Workers.
export const PipelineDebugLoader = dynamic(
  () => import("./pipeline-debug").then((m) => m.PipelineDebug),
  { ssr: false, loading: () => <p className="p-8 text-sm text-zinc-500">Loading…</p> },
);
