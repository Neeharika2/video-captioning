"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  FONT_GROUPS,
  FONT_LABELS,
  fontStack,
  sameStyle,
  type CaptionStyle,
  type FontFamily,
} from "@/lib/caption-style";
import { PRESETS, PRESET_CATEGORIES, type Preset } from "@/lib/caption-presets";
import { ensureCaptionFont } from "@/lib/client/caption-fonts";
import { drawCaption } from "@/lib/client/caption-renderer";
import { subscribeFrame } from "@/lib/client/raf-ticker";
import type { Caption } from "@/lib/types";

type Props = {
  style: CaptionStyle;
  onChange: (style: CaptionStyle) => void;
  /** True when at least one caption has its own placement. */
  hasPlacements?: boolean;
  /** Clear every per-caption placement (and the default offset). */
  onResetPlacements?: () => void;
};

/**
 * Preset-first style inspector: a live preview, a font per role, two colours and
 * an outline toggle. Every other axis is baked into the presets.
 */
export function StylePicker({ style, onChange, hasPlacements = false, onResetPlacements }: Props) {
  const active = PRESETS.find((p) => sameStyle(p.style, style));
  const patch = (part: Partial<CaptionStyle>) => onChange({ ...style, ...part });
  // True when the current style paints anything in the highlight colour;
  // otherwise the Highlight swatch looks broken, so we say so.
  const highlightUsed =
    (style.emphasis !== "none" && style.emphasis !== "weight" && style.emphasis !== "fill") ||
    style.treatment === "glow" ||
    style.emphasisTarget === "keyword" ||
    style.keywordGradient ||
    style.gradient ||
    style.speakerColors;
  // True when some word is set in the punchline face, so the second font
  // control is worth showing.
  const punchlineStyled = style.emphasisTarget === "keyword" || style.layout !== "block";

  return (
    <div className="flex flex-col gap-6 p-4 text-sm">
      {/* Live preview of the current style, drawn by the same renderer as the
          export. It stays pinned while the panel scrolls, so font, colour and
          outline tweaks are always visible next to the controls. */}
      <div className="sticky top-0 z-10 -mx-4 -mt-4 border-b border-zinc-200 bg-white px-4 pt-4 pb-3 dark:border-zinc-800 dark:bg-zinc-950">
        <FeaturedPreview style={style} />
      </div>

      <section className="flex flex-col gap-4">
        <SectionLabel>Look</SectionLabel>

        <Field label="Font">
          <FontPicker value={style.fontFamily} onChange={(fontFamily) => patch({ fontFamily })} />
        </Field>

        {punchlineStyled && (
          <Field label="Punchline font">
            <FontPicker
              label="Punchline font"
              value={style.keywordFontFamily}
              onChange={(keywordFontFamily) => patch({ keywordFontFamily })}
            />
            <p className="text-xs text-zinc-400 dark:text-zinc-500">
              The face used for the punchline word, in its own colour.
            </p>
          </Field>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Swatch label="Text" value={style.textColor} onChange={(textColor) => patch({ textColor })} />
          <Swatch
            label="Highlight"
            value={style.highlightColor}
            onChange={(highlightColor) => patch({ highlightColor })}
          />
        </div>
        {!highlightUsed && (
          <p className="-mt-2 text-xs text-zinc-400 dark:text-zinc-500">
            This preset doesn&rsquo;t use the highlight colour — try Karaoke, Word Tiles or a punchline preset.
          </p>
        )}

        <Toggle
          label="Outline"
          hint="Add a dark stroke around the letters."
          checked={style.outline}
          onChange={(outline) => patch({ outline })}
        />

        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-zinc-500">
            Drag a caption to move it, or a corner to resize it — each caption keeps its own spot and size.
          </p>
          {(style.offsetX !== 0 || style.offsetY !== 0 || hasPlacements) && (
            <button
              type="button"
              onClick={() => {
                patch({ offsetX: 0, offsetY: 0 });
                onResetPlacements?.();
              }}
              className="self-start text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              Reset all positions
            </button>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <SectionLabel>Presets</SectionLabel>
        {PRESET_CATEGORIES.map((category) => (
          <div key={category.id} role="group" aria-label={category.label} className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">{category.label}</span>
            <div className="grid grid-cols-2 gap-2">
              {PRESETS.filter((p) => p.category === category.id).map((p) => (
                <PresetChip key={p.id} preset={p} selected={active?.id === p.id} onSelect={() => onChange({ ...p.style })} />
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

/**
 * Font chooser that renders each option in its own face. A native `<select>`
 * can't: the OS draws the option list and ignores `font-family`, which makes
 * the choice meaningless for a type-driven editor.
 */
function FontPicker({
  value,
  onChange,
  label = "Font",
}: {
  value: FontFamily;
  onChange: (family: FontFamily) => void;
  /** Accessible name, so the base and punchline pickers stay distinct. */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const closeOnEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-left text-zinc-900 transition hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-600"
      >
        <span className="truncate" style={{ fontFamily: fontStack(value) }}>
          {FONT_LABELS[value]}
        </span>
        <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true">
          <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={label}
          className="absolute z-30 mt-1 max-h-80 w-full overflow-y-auto rounded-xl border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          {FONT_GROUPS.map((group) => (
            <div key={group.label} role="group" aria-label={group.label} className="py-0.5">
              <div className="px-2 pt-1.5 pb-1 text-[10px] font-medium tracking-wide text-zinc-400 uppercase">
                {group.label}
              </div>
              {group.fonts.map((family) => {
                const selected = family === value;
                return (
                  <button
                    key={family}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      onChange(family);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left transition ${
                      selected
                        ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                        : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    }`}
                  >
                    <span className="truncate text-base leading-tight" style={{ fontFamily: fontStack(family) }}>
                      {FONT_LABELS[family]}
                    </span>
                    {selected && (
                      <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0" aria-hidden="true">
                        <path
                          d="m5 13 4 4L19 7"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <span className="text-xs font-medium tracking-wide text-zinc-400 uppercase">{children}</span>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">{label}</span>
      {children}
    </div>
  );
}

function Swatch({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 px-2.5 py-2 dark:border-zinc-800">
      <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">{label}</span>
      <span
        className="relative h-6 w-9 shrink-0 overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700"
        style={{ background: value }}
      >
        <input
          type="color"
          aria-label={`${label} colour`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </span>
    </label>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-3">
      <span className="flex flex-col">
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">{label}</span>
        {hint && <span className="text-xs text-zinc-400 dark:text-zinc-500">{hint}</span>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-zinc-900 dark:accent-zinc-100"
      />
    </label>
  );
}

/** A short spoken line the preset cards act out. */
const DEMO: Caption = {
  id: "demo",
  text: "Made for creators",
  start: 0,
  end: 2.4,
  words: [
    { text: "Made", start: 0.2, end: 1, alt: "తయారు", speaker: "0" },
    { text: "for", start: 1, end: 1.6, alt: "కోసం", speaker: "1" },
    { text: "creators", start: 1.6, end: 2.3, alt: "క్రియేటర్లు", speaker: "0" },
  ],
};

/** The demo split into captions of at most `n` words, as the editor would group it. */
function demoCaptions(n: number): Caption[] {
  if (n >= DEMO.words.length) return [DEMO];
  const out: Caption[] = [];
  for (let i = 0; i < DEMO.words.length; i += n) {
    const words = DEMO.words.slice(i, i + n);
    const next = DEMO.words[i + n];
    out.push({ id: `demo-${i}`, text: words.map((w) => w.text).join(" "), start: i ? words[0].start : DEMO.start, end: next ? next.start : DEMO.end, words });
  }
  return out;
}
/** The demo plays from the first word's onset to the caption's end, on a loop. */
const DEMO_FROM = DEMO.words[0].start;
/**
 * Resting frame: "for" is being spoken while "creators" is the punchline, so a
 * spoken preset and a punchline preset show visibly different frames.
 */
const DEMO_REST = 1.45;

/**
 * Live miniature of a preset, drawn by the same renderer as the preview and
 * export. Plays continuously while the card is on screen (or hovered), so the
 * gallery shows each preset's motion rather than a row of still frames; off
 * screen it rests on `DEMO_REST`. Every preview shares one animation loop.
 * `textPx` sets the base text height, so the featured card can render larger
 * than the little grid cards while showing the same look.
 */
function PresetPreview({ style, playing, textPx = 13 }: { style: CaptionStyle; playing: boolean; textPx?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [fontTick, setFontTick] = useState(0);

  useEffect(() => {
    let live = true;
    // The punchline line uses a second face, so make sure it's loaded too.
    const faces: [FontFamily, number][] = [[style.fontFamily, style.weight]];
    if (style.emphasisTarget === "keyword") faces.push([style.keywordFontFamily, style.keywordWeight]);
    void Promise.all(faces.map(([family, weight]) => ensureCaptionFont(family, weight))).then(
      () => live && setFontTick((n) => n + 1),
    );
    return () => {
      live = false;
    };
  }, [style.fontFamily, style.weight, style.emphasisTarget, style.keywordFontFamily, style.keywordWeight]);

  // Animate only what's on screen, so a long gallery never runs dozens of
  // off-screen canvases.
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setVisible(entry.isIntersecting);
      },
      { threshold: 0.2 },
    );
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  const animate = playing || visible;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const draw = (t: number, still: boolean) => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) return;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (t >= DEMO.end) return;
      // Centre it and size the text for the card rather than for a video frame.
      const mini: CaptionStyle = { ...style, position: "middle", offsetX: 0, offsetY: 0, scale: textPx / Math.min(w, h) };
      const cue = demoCaptions(style.wordsPerCaption).find((c) => t >= c.start && t < c.end);
      if (cue) drawCaption(ctx, cue, w, h, mini, t, { still });
    };
    if (!animate) {
      draw(DEMO_REST, true);
      return;
    }
    const t0 = performance.now();
    return subscribeFrame((now) => {
      // Loop across the words' own span (not from frame 0), so no card ever
      // flashes empty between repeats.
      const span = DEMO.end - DEMO_FROM;
      draw(DEMO_FROM + (((now - t0) / 1000) % span), false);
    });
  }, [style, animate, fontTick, textPx]);

  return <canvas ref={ref} aria-hidden="true" className="h-full w-full" />;
}

/** What drives a preset, shown as a small tag on its card. */
function presetBadge(style: CaptionStyle): string {
  if (style.bilingual) return "bilingual";
  if (style.speakerColors) return "speakers";
  if (style.emphasisTarget === "keyword") return style.layout === "stack" ? "stack" : "punchline";
  if (style.emphasis !== "none") return "spoken";
  return "block";
}

function PresetChip({ preset, selected, onSelect }: { preset: Preset; selected: boolean; onSelect: () => void }) {
  const [playing, setPlaying] = useState(false);
  return (
    <button
      type="button"
      onClick={onSelect}
      onPointerEnter={() => setPlaying(true)}
      onPointerLeave={() => setPlaying(false)}
      onFocus={() => setPlaying(true)}
      onBlur={() => setPlaying(false)}
      aria-pressed={selected}
      aria-label={preset.name}
      title={preset.description}
      className={`flex flex-col gap-1.5 rounded-xl border p-1.5 text-left transition ${
        selected
          ? "border-zinc-900 ring-1 ring-zinc-900 dark:border-zinc-100 dark:ring-zinc-100"
          : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
      }`}
    >
      <span className="relative block h-24 overflow-hidden rounded-lg bg-zinc-900">
        <PresetPreview style={preset.style} playing={playing} textPx={16} />
      </span>
      <span className="px-0.5">
        <span className="flex items-baseline justify-between gap-1">
          <span className="truncate text-[11px] font-medium">{preset.name}</span>
          <span className="shrink-0 rounded-full bg-zinc-100 px-1.5 text-[9px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            {presetBadge(preset.style)}
          </span>
        </span>
        <span className="line-clamp-2 text-[10px] text-zinc-400 dark:text-zinc-500">{preset.description}</span>
      </span>
    </button>
  );
}

/**
 * The large "what am I looking at" preview above the grid: the style currently
 * in the editor, animated, at a size where the type, colour and layout actually
 * read. It's the same renderer as the export, so what you see is what burns in.
 */
function FeaturedPreview({ style }: { style: CaptionStyle }) {
  return (
    <div className="relative h-40 overflow-hidden rounded-xl bg-zinc-900">
      <PresetPreview style={style} playing textPx={30} />
    </div>
  );
}


