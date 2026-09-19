const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi;

/** Trailing punctuation is almost always sentence punctuation, not part of the URL. */
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;

/**
 * Extracts URLs as normalised comparison keys: lowercased, scheme and `www.`
 * dropped, trailing slash and punctuation removed.
 *
 * Normalising matters because the comparison in `draft_reply` is "does this URL
 * appear in the source email" — a draft that rewrites `http://` as `https://`,
 * or adds a trailing slash, is still pointing at the same place and should not
 * be treated as a foreign link.
 */
export function extractUrls(text: string): string[] {
  const matches = text.match(URL_PATTERN) ?? [];
  const normalised = matches.map((raw) =>
    raw
      .replace(TRAILING_PUNCTUATION, "")
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/+$/, ""),
  );
  return [...new Set(normalised.filter(Boolean))];
}
