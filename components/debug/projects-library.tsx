"use client";

import { formatBytes, formatDuration, type ProjectSummary, type StorageEstimate } from "@/lib/client/project-store";

type Props = {
  projects: ProjectSummary[];
  loading: boolean;
  storage: StorageEstimate | null;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
};

/**
 * The Projects home: recent transcriptions saved in this browser, with a
 * read-out of how much storage they are using. Everything here lives on the
 * device — the grid reads only the light project records, never the video bytes.
 */
export function ProjectsLibrary({ projects, loading, storage, onOpen, onDelete }: Props) {
  return (
    <section className="flex flex-col gap-4" data-testid="projects">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Your projects</h2>
          <p className="text-sm text-zinc-500">
            Saved in this browser only — reopen a project any time to keep editing it.
          </p>
        </div>
        {storage && <StorageMeter storage={storage} />}
      </div>

      {loading ? (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <li
              key={i}
              className="h-56 animate-pulse rounded-2xl border border-zinc-200 bg-zinc-100/70 dark:border-zinc-800 dark:bg-zinc-900/60"
            />
          ))}
        </ul>
      ) : projects.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} onOpen={onOpen} onDelete={onDelete} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ProjectCard({
  project,
  onOpen,
  onDelete,
}: {
  project: ProjectSummary;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const meta = [
    formatDuration(project.durationSec),
    project.bytes > 0 ? formatBytes(project.bytes) : "",
    `${project.wordCount} word${project.wordCount === 1 ? "" : "s"}`,
  ].filter(Boolean);
  const edited = new Date(project.updatedAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

  return (
    <li
      data-testid="project-card"
      className="group relative overflow-hidden rounded-2xl border border-zinc-200 bg-white transition hover:border-zinc-400 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600"
    >
      <button type="button" aria-label={project.name} onClick={() => onOpen(project.id)} className="block w-full text-left">
        <span className="relative flex h-36 w-full items-center justify-center overflow-hidden bg-zinc-900">
          {project.thumbnail ? (
            // A saved frame; object-cover keeps cards the same shape.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={project.thumbnail} alt="" className="h-full w-full object-cover" />
          ) : (
            <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8 text-zinc-600" aria-hidden="true">
              <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10 9.5v5l4-2.5-4-2.5Z" fill="currentColor" />
            </svg>
          )}
          {!project.hasVideo && (
            <span className="absolute right-2 bottom-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-medium text-white/90">
              video not saved
            </span>
          )}
        </span>

        <span className="flex flex-col gap-1 p-3">
          <span className="truncate text-sm font-semibold" title={project.name}>
            {project.name}
          </span>
          <span className="flex flex-wrap items-center gap-x-2 text-xs text-zinc-500">
            <span>{meta.join(" · ")}</span>
            <span className="text-zinc-400 dark:text-zinc-600">·</span>
            <span>{edited}</span>
          </span>
        </span>
      </button>

      <button
        type="button"
        aria-label={`Delete ${project.name}`}
        title="Delete project"
        onClick={() => onDelete(project.id)}
        className="absolute top-2 right-2 grid h-8 w-8 place-items-center rounded-full bg-black/55 text-white opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100 hover:bg-black/80"
      >
        <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
          <path
            d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-8 0 1 12a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-12"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </li>
  );
}

function EmptyState() {
  return (
    <div
      className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-zinc-200 px-6 py-10 text-center dark:border-zinc-800"
      data-testid="projects-empty"
    >
      <span className="grid h-11 w-11 place-items-center rounded-full bg-zinc-100 dark:bg-zinc-900">
        <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 text-zinc-500" aria-hidden="true">
          <path
            d="M4 6a2 2 0 0 1 2-2h5l2 2h5a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <p className="text-sm font-medium">No projects yet</p>
      <p className="max-w-sm text-sm text-zinc-500">
        Once you make captions, the video (when it fits) and its transcript are saved here automatically.
      </p>
    </div>
  );
}

function StorageMeter({ storage }: { storage: StorageEstimate }) {
  const ratio = storage.quota > 0 ? Math.min(1, storage.usage / storage.quota) : 0;
  return (
    <div className="flex w-full max-w-xs flex-col gap-1" title="Space this site is using in your browser">
      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span>Browser storage</span>
        <span className="font-mono tabular-nums">
          {formatBytes(storage.usage)}
          {storage.quota > 0 && ` / ${formatBytes(storage.quota)}`}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
        <div
          className={`h-full rounded-full ${ratio > 0.9 ? "bg-red-500" : "bg-zinc-900 dark:bg-zinc-100"}`}
          style={{ width: `${Math.max(ratio * 100, storage.usage > 0 ? 2 : 0)}%` }}
        />
      </div>
    </div>
  );
}
