"use client";

import { type CSSProperties, useState } from "react";
import {
  ANIMATION_LABELS,
  FONT_LABELS,
  PRESETS,
  sameStyle,
  type CaptionAnimation,
  type CaptionPosition,
  type CaptionStyle,
  type CaptionTreatment,
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

const TREATMENTS: { value: CaptionTreatment; label: string }[] = [
  { value: "plain", label: "Plain" },
  { value: "shadow", label: "Shadow" },
  { value: "outline", label: "Outline" },
  { value: "box", label: "Box" },
];

const POSITIONS: { value: CaptionPosition; label: string }[] = [
  { value: "top", label: "Top" },
  { value: "middle", label: "Middle" },
  { value: "bottom", label: "Bottom" },
];

const ANIMATIONS: { value: CaptionAnimation; label: string }[] = (["none", "fade", "pop", "rise"] as const).map((value) => ({
  value,
  label: ANIMATION_LABELS[value],
}));

/**
 * Style inspector. Style lives apart from the transcript, so every change shows
 * up live in the preview (and in the burned-in export, which shares the style).
 */
export function StylePicker({ style, onChange, hasPlacements = false, onResetPlacements }: Props) {
  const [copied, setCopied] = useState(false);
  const active = PRESETS.find((p) => sameStyle(p.style, style));
  const patch = (part: Partial<CaptionStyle>) => onChange({ ...style, ...part });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(style, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 p-4 text-sm">
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium tracking-wide text-zinc-400 uppercase">Presets</span>
        <div className="grid grid-cols-3 gap-2">
          {PRESETS.map((p) => (
            <PresetChip key={p.id} preset={p} selected={active?.id === p.id} onSelect={() => onChange(p.style)} />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <span className="text-xs font-medium tracking-wide text-zinc-400 uppercase">Fine-tune</span>

        <label className="flex flex-col gap-1.5">
          <span className="font-medium">Font</span>
          <select
            className="rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
            value={style.fontFamily}
            onChange={(e) => patch({ fontFamily: e.target.value as FontFamily })}
          >
            {(Object.keys(FONT_LABELS) as FontFamily[]).map((f) => (
              <option key={f} value={f}>
                {FONT_LABELS[f]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="flex items-center justify-between font-medium">
            Size
            <span className="font-normal text-zinc-500">{Math.round(style.scale * 1080)}px</span>
          </span>
          <input
            type="range"
            min={0.03}
            max={0.085}
            step={0.002}
            value={style.scale}
            onChange={(e) => patch({ scale: Number(e.target.value) })}
            className="accent-zinc-900 dark:accent-zinc-100"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex items-center justify-between gap-3">
            <span className="font-medium">Text</span>
            <input
              type="color"
              aria-label="Text colour"
              value={style.textColor}
              onChange={(e) => patch({ textColor: e.target.value })}
              className="h-8 w-12 rounded border border-zinc-300 bg-transparent dark:border-zinc-700"
            />
          </label>
          <label className="flex items-center justify-between gap-3">
            <span className="font-medium">Highlight</span>
            <input
              type="color"
              aria-label="Highlight colour"
              value={style.highlightColor}
              onChange={(e) => patch({ highlightColor: e.target.value })}
              className="h-8 w-12 rounded border border-zinc-300 bg-transparent dark:border-zinc-700"
            />
          </label>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="font-medium">Treatment</span>
          <Segmented value={style.treatment} options={TREATMENTS} onChange={(treatment) => patch({ treatment })} />
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="font-medium">Position</span>
          <Segmented
            value={style.position}
            options={POSITIONS}
            onChange={(position) => patch({ position, offsetX: 0, offsetY: 0 })}
          />
          <span className="text-xs text-zinc-500">
            Drag a caption in the preview to give it its own spot — captions can sit in different places. This is
            where captions you haven&apos;t moved start out.
          </span>
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

        <div className="flex flex-col gap-1.5">
          <span className="font-medium">Animation</span>
          <Segmented value={style.animation} options={ANIMATIONS} onChange={(animation) => patch({ animation })} />
          <span className="text-xs text-zinc-500">How the caption appears when it comes on screen.</span>
        </div>

        {style.treatment === "box" && (
          <label className="flex flex-col gap-1.5">
            <span className="flex items-center justify-between font-medium">
              Box opacity
              <span className="font-normal text-zinc-500">{Math.round(style.boxOpacity * 100)}%</span>
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={style.boxOpacity}
              onChange={(e) => patch({ boxOpacity: Number(e.target.value) })}
              className="accent-zinc-900 dark:accent-zinc-100"
            />
          </label>
        )}

        <label className="flex items-start gap-2 text-zinc-600 dark:text-zinc-400">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-zinc-900 dark:accent-zinc-100"
            checked={style.emphasis === "highlight"}
            onChange={(e) => patch({ emphasis: e.target.checked ? "highlight" : "none" })}
          />
          <span>
            Word highlight
            <span className="block text-xs text-zinc-500">Colour each word as it&apos;s spoken.</span>
          </span>
        </label>
      </div>

      <button
        type="button"
        onClick={copy}
        className="self-start text-xs text-zinc-500 underline underline-offset-4 hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        {copied ? "Copied!" : "Copy style configuration"}
      </button>
    </div>
  );
}

/** A miniature of the actual treatment, so presets read as looks, not labels. */
function PresetChip({ preset, selected, onSelect }: { preset: Preset; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      title={preset.description}
      className={`flex flex-col gap-1.5 rounded-xl border p-1.5 text-left transition ${
        selected
          ? "border-zinc-900 ring-1 ring-zinc-900 dark:border-zinc-100 dark:ring-zinc-100"
          : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
      }`}
    >
      <span className="flex h-12 items-center justify-center overflow-hidden rounded-lg bg-zinc-900 px-1 text-center">
        <span style={previewStyle(preset.style)}>
          {preset.id === "viral" ? (
            <>
              Hello <span style={{ color: preset.style.highlightColor }}>there</span>
            </>
          ) : (
            "Hello there"
          )}
        </span>
      </span>
      <span className="px-0.5 text-[11px] font-medium">{preset.name}</span>
    </button>
  );
}

function previewStyle(style: CaptionStyle): CSSProperties {
  const base: CSSProperties = { fontSize: 12, color: style.textColor, fontWeight: style.weight, lineHeight: 1.2 };
  if (style.treatment === "shadow") {
    base.textShadow = "0 1px 3px rgba(0, 0, 0, 0.75)";
  } else if (style.treatment === "box") {
    base.background = `rgba(0, 0, 0, ${style.boxOpacity})`;
    base.padding = "3px 6px";
    base.borderRadius = 5;
  } else if (style.treatment === "outline") {
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
    <div className="flex rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-800">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`flex-1 rounded-md px-2 py-1 text-xs font-medium transition ${
            value === o.value
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
