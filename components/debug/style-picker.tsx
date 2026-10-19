"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  ANIMATION_LABELS,
  FONT_GROUPS,
  FONT_LABELS,
  PRESETS,
  fontStack,
  sameStyle,
  withAlpha,
  type CaptionAnimation,
  type CaptionStyle,
  type FontFamily,
  type Preset,
} from "@/lib/caption-style";

type Props = {
  style: CaptionStyle;
  onChange: (style: CaptionStyle) => void;
  /** True when at least one caption has its own placement. */
  hasPlacements?: boolean;
  /** Clear every per-caption placement (and the default offset). */
  onResetPlacements?: () => void;
};

const ANIMATIONS: { value: CaptionAnimation; label: string }[] = (["none", "fade", "pop", "rise"] as const).map((value) => ({
  value,
  label: ANIMATION_LABELS[value],
}));

/**
 * Style inspector. A one-click preset gallery on top, then only the controls
 * people actually reach for: font, colours, word highlight, outline and
 * animation. Size and position are set by dragging the caption itself (with a
 * sync action per axis), and treatment, box colour and uppercase stay baked
 * into each preset. Style is independent of the transcript, so changes show
 * live in the preview and in the burned-in export, which share this
 * `CaptionStyle`.
 */
export function StylePicker({ style, onChange, hasPlacements = false, onResetPlacements }: Props) {
  const active = PRESETS.find((p) => sameStyle(p.style, style));
  const patch = (part: Partial<CaptionStyle>) => onChange({ ...style, ...part });

  return (
    <div className="flex flex-col gap-6 p-4 text-sm">
      <section className="flex flex-col gap-2">
        <SectionLabel>Presets</SectionLabel>
        <div className="grid grid-cols-2 gap-2">
          {PRESETS.map((p) => (
            <PresetChip key={p.id} preset={p} selected={active?.id === p.id} onSelect={() => onChange({ ...p.style })} />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <SectionLabel>Fine-tune</SectionLabel>

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

        <Toggle
          label="Word highlight"
          hint="Colour each word as it's spoken."
          checked={style.emphasis === "highlight"}
          onChange={(on) => patch({ emphasis: on ? "highlight" : "none" })}
        />

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

        <Field label="Animation">
          <Segmented value={style.animation} options={ANIMATIONS} onChange={(animation) => patch({ animation })} />
          <p className="text-xs text-zinc-500">How the caption appears.</p>
        </Field>
      </section>
    </div>
  );
}

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

/** A miniature of the actual treatment, so presets read as looks, not labels. */
function PresetChip({ preset, selected, onSelect }: { preset: Preset; selected: boolean; onSelect: () => void }) {
  const highlight = preset.style.emphasis === "highlight";
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={preset.name}
      title={preset.description}
      className={`flex flex-col gap-1.5 rounded-xl border p-1.5 text-left transition ${
        selected
          ? "border-zinc-900 ring-1 ring-zinc-900 dark:border-zinc-100 dark:ring-zinc-100"
          : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
      }`}
    >
      <span className="flex h-14 items-center justify-center overflow-hidden rounded-lg bg-zinc-900 px-1.5 text-center">
        <span style={previewStyle(preset.style)}>
          {highlight ? (
            <>
              Hello <span style={{ color: preset.style.highlightColor }}>there</span>
            </>
          ) : (
            "Hello there"
          )}
        </span>
      </span>
      <span className="px-0.5">
        <span className="block truncate text-[11px] font-medium">{preset.name}</span>
        <span className="line-clamp-2 text-[10px] text-zinc-400 dark:text-zinc-500">{preset.description}</span>
      </span>
    </button>
  );
}

function previewStyle(style: CaptionStyle): CSSProperties {
  const base: CSSProperties = {
    fontFamily: fontStack(style.fontFamily),
    fontSize: 12,
    color: style.textColor,
    fontWeight: style.weight,
    lineHeight: 1.2,
    textTransform: style.uppercase ? "uppercase" : undefined,
  };
  if (style.treatment === "shadow") {
    base.textShadow = "0 1px 3px rgba(0, 0, 0, 0.75)";
  } else if (style.treatment === "glow") {
    base.textShadow = `0 0 6px ${style.highlightColor}`;
  } else if (style.treatment === "box") {
    base.background = withAlpha(style.boxColor, style.boxOpacity);
    base.padding = "3px 7px";
    base.borderRadius = 6;
  }
  if (style.outline) {
    base.WebkitTextStrokeWidth = 1;
    base.WebkitTextStrokeColor = "rgba(0, 0, 0, 0.9)";
    base.paintOrder = "stroke";
  }
  return base;
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`flex-1 rounded-lg border px-2 py-1 text-xs font-medium whitespace-nowrap transition ${
            value === o.value
              ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
              : "border-zinc-200 text-zinc-500 hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-800 dark:hover:border-zinc-600 dark:hover:text-zinc-100"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
