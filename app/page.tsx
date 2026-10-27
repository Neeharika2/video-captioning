import Link from "next/link";

const STEPS = [
  {
    title: "Drop in a video",
    body: "MP4, MOV, MKV, WebM and more. The video is read right here in your browser — nothing is uploaded.",
  },
  {
    title: "Get timed captions",
    body: "Speech is transcribed with word-level timings, in English or any language it hears.",
  },
  {
    title: "Style, then export",
    body: "Pick a look, nudge a line, then download .srt / .vtt or burn the captions into an MP4.",
  },
];

const FEATURES = [
  {
    title: "Preset-first styling",
    body: "23 hand-tuned looks across punchlines, spoken-word, blocks and bilingual captions. Swap the look without re-transcribing.",
  },
  {
    title: "Reopen past projects",
    body: "Every transcription is saved in this browser — video included when it fits — so you can come back and keep editing.",
  },
  {
    title: "40 shipped fonts",
    body: "From clean workhorses to bold display, cursive and rounded faces — plus a separate face for the punchline word.",
  },
];

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-16 px-6 py-16 sm:py-24">
      <header className="flex flex-col items-start gap-5">
        <span className="rounded-full border border-zinc-200 px-3 py-1 text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          Local-first · your video never leaves your device
        </span>
        <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">Captions for any video</h1>
        <p className="max-w-xl text-lg text-zinc-600 dark:text-zinc-400">
          Pick a clip and get accurately transcribed, time-coded captions you can style in seconds. Download them as{" "}
          <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-base dark:bg-zinc-900">.srt</code> or{" "}
          <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-base dark:bg-zinc-900">.vtt</code> — or burn them
          straight into an MP4.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/debug"
            className="rounded-full bg-zinc-900 px-6 py-3 text-sm font-medium text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Make captions
          </Link>
          <Link
            href="/debug"
            className="rounded-full border border-zinc-300 px-6 py-3 text-sm font-medium transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Open your projects
          </Link>
        </div>
      </header>

      <section className="grid gap-6 sm:grid-cols-3">
        {STEPS.map((step, i) => (
          <div key={step.title} className="flex flex-col gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-zinc-900 text-xs font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900">
              {i + 1}
            </span>
            <h2 className="font-medium">{step.title}</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{step.body}</p>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold tracking-tight">Built for creators</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="rounded-2xl border border-zinc-200 bg-white p-5 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
            >
              <h3 className="mb-1.5 font-medium">{feature.title}</h3>
              <p className="text-zinc-600 dark:text-zinc-400">{feature.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-5 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-950 sm:p-6">
        <h2 className="mb-3 font-medium">Your privacy</h2>
        <ul className="space-y-2 text-zinc-600 dark:text-zinc-400">
          <li>Your video never leaves your device. Audio is extracted in your browser.</li>
          <li>The compressed audio is sent to our server and forwarded to Google Gemini for transcription.</li>
          <li>
            We use a paid Gemini key, so Google does not use your audio to improve its products, and we ask Google not
            to store the request.
          </li>
          <li>We don&apos;t keep your audio or transcript on our server after the request finishes.</li>
          <li>Your projects are saved in this browser, not on our servers.</li>
        </ul>
      </section>
    </main>
  );
}
