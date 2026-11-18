/**
 * Clipboard helpers that work on iOS Safari and degrade where the async
 * Clipboard API is missing (older browsers, non-secure origins, some in-app
 * webviews). Call them directly from a click handler: both routes need the
 * user gesture.
 */

function legacyCopy(text: string): boolean {
  const el = document.createElement("textarea");
  el.value = text;
  // Off-screen but still selectable. 16px stops iOS zooming to the field.
  el.setAttribute("readonly", "");
  el.setAttribute("aria-hidden", "true");
  el.style.position = "fixed";
  el.style.top = "0";
  el.style.left = "-9999px";
  el.style.fontSize = "16px";
  el.style.opacity = "0";
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  document.body.appendChild(el);
  let ok = false;
  try {
    el.focus({ preventScroll: true });
    el.select();
    // iOS ignores select() on its own; an explicit range makes it stick.
    el.setSelectionRange(0, text.length);
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  el.remove();
  previous?.focus({ preventScroll: true });
  return ok;
}

/** True when the text reached the clipboard. Never throws. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied or the document lost focus: try the old way.
  }
  return legacyCopy(text);
}

/**
 * The clipboard's text, or null when the browser will not hand it over
 * (unsupported, or the person declined). Never throws.
 */
export async function readClipboardText(): Promise<string | null> {
  try {
    if (typeof navigator === "undefined" || !navigator.clipboard?.readText) return null;
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}
