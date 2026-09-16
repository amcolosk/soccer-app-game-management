const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapes the five HTML-significant characters. Apply to every dynamic
 * string interpolated into an HTML email/document body — do NOT apply to
 * plain-text bodies (unnecessary there, and would show literal "&amp;" etc.
 * to the reader). */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPE_MAP[char]);
}
