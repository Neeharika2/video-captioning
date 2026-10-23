"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ANIMATE_BY_LABELS,
  ANIMATION_LABELS,
  EMPHASIS_LABELS,
  FONT_GROUPS,
  FONT_LABELS,
  LOOP_LABELS,
  PRESETS,
  PRESET_CATEGORIES,
  TEXT_CASE_LABELS,
  TREATMENT_LABELS,
  WORDS_PER_CAPTION,
  WORD_MOTION_LABELS,
  fontStack,
  sameStyle,
  type CaptionStyle,
  type FontFamily,
  type Preset,
} from "@/lib/caption-style";
import { ensureCaptionFont } from "@/lib/client/caption-fonts";
import { drawCaption } from "@/lib/client/caption-renderer";
import type { Caption } from "@/lib/types";

type Props = {
  style: CaptionStyle;
  onChange: (style: CaptionStyle) => void;
  /** True when at least one caption has its own placement. */
  hasPlacements?: boolean;
  /** Clear every per-caption placement (and the default offset). */
  onResetPlacements?: () => void;
};

/** `{ value, label }` options from a label map, in its declared order. */
function optionsOf<T extends string>(labels: Record<T, string>): { value: T; label: string }[] {
  return (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));
}

const ANIMATIONS = optionsOf(ANIMATION_LABELS);
const ANIMATE_BY = optionsOf(ANIMATE_BY_LABELS);
const EMPHASES = optionsOf(EMPHASIS_LABELS);
const WORD_MOTIONS = optionsOf(WORD_MOTION_LABELS);
const LOOPS = optionsOf(LOOP_LABELS);
const TREATMENTS = optionsOf(TREATMENT_LABELS);
const CASES = optionsOf(TEXT_CASE_LABELS);
const WORD_COUNTS = WORDS_PER_CAPTION.map((n) => ({ value: String(n), label: String(n) }));

/**
 * Style inspector. A one-click preset gallery on top (each card plays its
 * effect on hover), then the look (font, colours, outline) and the effects:
 * entrance, what marks the spoken word, how it moves, and an idle loop. Size
 * and position are set by dragging the caption itself. Style is independent of
 * the transcript, so changes show live in the preview and in the burned-in
 * export, which are drawn by the same renderer.
 */
export function StylePicker({ style, onChange, hasPlacements = false, onResetPlacements }: Props) {
  const active = PRESETS.find((p) => sameStyle(p.style, style));
  const patch = (part: Partial<CaptionStyle>) => onChange({ ...style, ...part });
  const highlightUsed =
    (style.emphasis !== "none" && style.emphasis !== "weight" && style.emphasis !== "fill") ||
    style.treatment === "glow" ||
    style.keywords ||
    style.gradient ||
    style.speakerColors;
  const boxUsed = style.treatment === "box" || style.treatment === "tiles";

  return (
    <div className="flex flex-col gap-6 p-4 text-sm">
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

      <section className="flex flex-col gap-4">
        <SectionLabel>Look</SectionLabel>

        <Field label="Font">
          <FontPicker value={style.fontFamily} onChange={(fontFamily) => patch({ fontFamily })} />
        </Field>

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
            Highlight colours the spoken word — pick a style under Spoken word.
          </p>
        )}

        <Field label="Background">
          <Choices label="Background" value={style.treatment} options={TREATMENTS} onChange={(treatment) => patch({ treatment })} />
        </Field>
        {boxUsed && <Swatch label="Box" value={style.boxColor} onChange={(boxColor) => patch({ boxColor })} />}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Case">
            <Segmented label="Case" value={style.textCase} options={CASES} onChange={(textCase) => patch({ textCase })} />
          </Field>
          <Field label="Words on screen">
            <Segmented
              label="Words on screen"
              value={String(style.wordsPerCaption)}
              options={WORD_COUNTS}
              onChange={(n) => patch({ wordsPerCaption: Number(n) })}
            />
          </Field>
        </div>

        <Toggle
          label="Outline"
          hint="Add a dark stroke around the letters."
          checked={style.outline}
          onChange={(outline) => patch({ outline })}
        />
        <Toggle
          label="Gradient"
          hint="Fade the text colour into the highlight colour, top to bottom."
          checked={style.gradient}
          onChange={(gradient) => patch({ gradient })}
        />
        <Toggle
          label="Pop key words"
          hint="Numbers and the most important word in each caption get bigger, in the highlight colour."
          checked={style.keywords}
          onChange={(keywords) => patch({ keywords })}
        />
        <Toggle
          label="Bilingual line"
          hint="Show the other script (original ↔ English letters) smaller underneath."
          checked={style.bilingual}
          onChange={(bilingual) => patch({ bilingual })}
        />
        <Toggle
          label="Speaker colours"
          hint="A colour per speaker: text colour, then highlight, then more. Needs Detect speakers before transcribing."
          checked={style.speakerColors}
          onChange={(speakerColors) => patch({ speakerColors })}
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

      <section className="flex flex-col gap-4">
        <SectionLabel>Effects</SectionLabel>

        <Field label="Entrance">
          <Choices label="Entrance" value={style.animation} options={ANIMATIONS} onChange={(animation) => patch({ animation })} />
          <Segmented label="Animate by" value={style.animateBy} options={ANIMATE_BY} onChange={(animateBy) => patch({ animateBy })} />
          <p className="text-xs text-zinc-500">
            {style.animateBy === "caption"
              ? "The whole caption animates in when it starts."
              : `Each ${style.animateBy} appears as it's spoken.`}
          </p>
        </Field>

        <Field label="Spoken word">
          <Choices label="Spoken word" value={style.emphasis} options={EMPHASES} onChange={(emphasis) => patch({ emphasis })} />
          <p className="text-xs text-zinc-500">{EMPHASIS_HINTS[style.emphasis]}</p>
        </Field>

        <Field label="Word motion">
          <Choices
            label="Word motion"
            value={style.wordMotion}
            options={WORD_MOTIONS}
            onChange={(wordMotion) => patch({ wordMotion })}
          />
        </Field>

        <Field label="Loop">
          <Choices label="Loop" value={style.loop} options={LOOPS} onChange={(loop) => patch({ loop })} />
          <p className="text-xs text-zinc-500">{LOOP_HINTS[style.loop]}</p>
        </Field>

        <Toggle
          label="Dim upcoming words"
          hint="Words fade up to full as they're spoken."
          checked={style.dimUpcoming}
          onChange={(dimUpcoming) => patch({ dimUpcoming })}
        />

        <p className="text-xs text-zinc-400 dark:text-zinc-500">Effects play while the video plays; pause to see the resting look.</p>
      </section>
    </div>
  );
}

const EMPHASIS_HINTS: Record<CaptionStyle["emphasis"], string> = {
  none: "No highlight on the spoken word.",
  color: "The spoken word switches to the highlight colour.",
  sweep: "Colour fills each word left to right as it's spoken.",
  box: "A box glides from word to word; its text stays readable automatically.",
  marker: "A highlighter stroke grows under each word and stays.",
  underline: "An underline glides along under the spoken word.",
  weight: "The spoken word turns bold; the rest stay light.",
  fill: "Words start as outlines and fill solid as they're spoken.",
};

const LOOP_HINTS: Record<CaptionStyle["loop"], string> = {
  none: "No motion once the caption has landed.",
  float: "The caption gently bobs while it's on screen.",
  wave: "Letters ripple in a wave (Indian scripts wave word by word).",
  shine: "A band of light sweeps across the text every few seconds.",
  glitch: "Glitches as it lands, then in short random bursts.",
};

/**
 * Font chooser that renders each option in its own face. A native `<select>`
 * can't: the OS draws the option list and ignores `font-family`, which makes
 * the choice meaningless for a type-driven editor.
 */
function FontPicker({ value, onChange }: { value: FontFamily; onChange: (family: FontFamily) => void }) {
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
        aria-label="Font"
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
          aria-label="Font"
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
  text: "Make it pop",
  start: 0,
  end: 1.9,
  words: [
    { text: "Make", start: 0.1, end: 0.45, alt: "మేక్", speaker: "0" },
    { text: "it", start: 0.45, end: 0.7, alt: "ఇట్", speaker: "0" },
    { text: "pop", start: 0.7, end: 1.5, alt: "పాప్", speaker: "1" },
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
/** One play-through of the demo, including a short blank beat before it repeats. */
const DEMO_LOOP = 2.3;
/** Resting frame: the last word being spoken, so highlights are visible. */
const DEMO_REST = 1.2;

/**
 * Live miniature of a preset, drawn by the same renderer as the preview and
 * export. Rests on one frame and acts out the effect while hovered.
 */
function PresetPreview({ style, playing }: { style: CaptionStyle; playing: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [fontTick, setFontTick] = useState(0);

  useEffect(() => {
    let live = true;
    void ensureCaptionFont(style.fontFamily, style.weight).then(() => live && setFontTick((n) => n + 1));
    return () => {
      live = false;
    };
  }, [style.fontFamily, style.weight]);

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
      const mini: CaptionStyle = { ...style, position: "middle", offsetX: 0, offsetY: 0, scale: 15 / Math.min(w, h) };
      const cue = demoCaptions(style.wordsPerCaption).find((c) => t >= c.start && t < c.end);
      if (cue) drawCaption(ctx, cue, w, h, mini, t, { still });
    };
    if (!playing) {
      draw(DEMO_REST, true);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const loop = (now: number) => {
      draw(((now - t0) / 1000) % DEMO_LOOP, false);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [style, playing, fontTick]);

  return <canvas ref={ref} aria-hidden="true" className="h-full w-full" />;
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
      <span className="block h-14 overflow-hidden rounded-lg bg-zinc-900">
        <PresetPreview style={preset.style} playing={playing} />
      </span>
      <span className="px-0.5">
        <span className="block truncate text-[11px] font-medium">{preset.name}</span>
        <span className="line-clamp-2 text-[10px] text-zinc-400 dark:text-zinc-500">{preset.description}</span>
      </span>
    </button>
  );
}

/** A wrapping grid of single-choice buttons. */
function Choices<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="grid grid-cols-3 gap-1">
      {options.map((o) => (
        <ChoiceButton key={o.value} selected={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </ChoiceButton>
      ))}
    </div>
  );
}

function ChoiceButton({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`rounded-lg border px-2 py-1 text-xs font-medium whitespace-nowrap transition ${
        selected
          ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
          : "border-zinc-200 text-zinc-500 hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-800 dark:hover:border-zinc-600 dark:hover:text-zinc-100"
      }`}
    >
      {children}
    </button>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex gap-1 [&>button]:flex-1">
      {options.map((o) => (
        <ChoiceButton key={o.value} selected={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </ChoiceButton>
      ))}
    </div>
  );
}
