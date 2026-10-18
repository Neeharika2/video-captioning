import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-8 px-6 py-16">
      <div className="flex flex-col items-start gap-4">
        <span className="rounded-full border border-zinc-200 px-3 py-1 text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          Local-first · your video never leaves your device
        </span>
        <h1 className="text-4xl font-semibold tracking-tight text-balance">Captions for any video</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Pick a video and get accurately transcribed, time-coded captions. Download them as{" "}
          <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-sm dark:bg-zinc-900">.srt</code> or{" "}
          <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-sm dark:bg-zinc-900">.vtt</code> — or burn them
          straight into an MP4.
        </p>
        <Link
          href="/debug"
          className="rounded-full bg-zinc-900 px-6 py-3 text-sm font-medium text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Make captions
        </Link>
      </div>

      <section className="rounded-2xl border border-zinc-200 bg-white p-5 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-950 sm:p-6">
        <h2 className="mb-3 font-medium">Your privacy</h2>
        <ul className="space-y-2 text-zinc-600 dark:text-zinc-400">
          <li>Your video never leaves your device. Audio is extracted in your browser.</li>
          <li>The compressed audio is sent to our server and forwarded to Google Gemini for transcription.</li>
          <li>We use a paid Gemini key, so Google does not use your audio to improve its products, and we ask Google not to store the request.</li>
          <li>We don&apos;t keep your audio or transcript on our server after the request finishes.</li>
        </ul>
      </section>
    </main>
  );
}
