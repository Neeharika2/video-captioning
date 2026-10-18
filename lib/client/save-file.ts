/**
 * Saving large outputs. Where the File System Access API exists (Chrome, Edge),
 * write straight to disk so a long video never has to fit in memory;
 * elsewhere, build a Blob and trigger a normal download.
 */

type SaveFilePickerOptions = {
  suggestedName?: string;
  types?: { description?: string; accept: Record<string, string[]> }[];
};

type WindowWithPicker = Window & {
  showSaveFilePicker?: (opts?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
};

export type SaveTarget =
  | { kind: "disk"; writable: FileSystemWritableFileStream; name: string }
  | { kind: "download"; name: string };

export class SaveCancelledError extends Error {
  constructor() {
    super("Save cancelled");
    this.name = "SaveCancelledError";
  }
}

/**
 * Ask where to save. Must be called first thing in a click handler (the
 * picker needs the user gesture).
 */
export async function chooseSaveTarget(name: string, mimeType: string, extension: string): Promise<SaveTarget> {
  const picker = (window as WindowWithPicker).showSaveFilePicker;
  if (!picker) return { kind: "download", name };
  try {
    const handle = await picker({
      suggestedName: name,
      types: [{ description: "Video", accept: { [mimeType]: [extension] } }],
    });
    return { kind: "disk", writable: await handle.createWritable(), name: handle.name };
  } catch (err) {
    if ((err as DOMException)?.name === "AbortError") throw new SaveCancelledError();
    // Picker blocked (e.g. in an iframe): fall back to a normal download.
    return { kind: "download", name };
  }
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function downloadText(text: string, name: string, mimeType: string) {
  downloadBlob(new Blob([text], { type: `${mimeType};charset=utf-8` }), name);
}

/** "My Clip.mp4" → "My Clip.captioned.mp4" */
export function outputName(inputName: string, suffix: string, extension: string) {
  const base = inputName.replace(/\.[^./\\]+$/, "") || "video";
  return `${base}.${suffix}${extension}`;
}
