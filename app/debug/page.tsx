import type { Metadata } from "next";
import { PipelineDebugLoader } from "@/components/debug/pipeline-debug-loader";

export const metadata: Metadata = {
  title: "Pipeline debug · Captions",
  robots: { index: false },
};

export default function DebugPage() {
  return <PipelineDebugLoader />;
}
