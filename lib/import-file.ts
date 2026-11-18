/**
 * Reads a dropped or chosen file as text, with friendly refusals for things
 * that cannot be a Flume summary. Never throws.
 */

export type FileRead = { ok: true; text: string } | { ok: false; message: string };

/** A category summary is a few kilobytes. This leaves room for a long chat log. */
const MAX_BYTES = 2 * 1024 * 1024;

const TEXT_EXTENSIONS = /\.(csv|tsv|txt|text|md|markdown|json|log)$/i;
const TEXT_TYPES = /^(text\/|application\/(json|csv|x-csv|vnd\.ms-excel)$)/i;

export async function readImportFile(file: File): Promise<FileRead> {
  const name = file.name || "That file";
  const looksLikeText = TEXT_EXTENSIONS.test(file.name) || TEXT_TYPES.test(file.type) || file.type === "";

  if (!looksLikeText) {
    return {
      ok: false,
      message: `${name} isn't a text file. Flume reads a .csv or .txt file, or the reply pasted straight from your agent.`,
    };
  }
  if (file.size > MAX_BYTES) {
    return {
      ok: false,
      message: `${name} is too large to be a summary. Flume needs the short table of category totals from your agent, not a full transaction export.`,
    };
  }

  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, message: `${name} couldn't be opened. Try choosing it again, or paste its contents instead.` };
  }

  // A spreadsheet or image with a misleading name: mostly unprintable bytes.
  if (text.includes("\u0000")) {
    return {
      ok: false,
      message: `${name} isn't plain text. If it is a spreadsheet, export it as .csv first, or paste the rows here.`,
    };
  }
  return { ok: true, text };
}
