const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi;

/** Trailing punctuation is almost always sentence punctuation, not part of the URL. */
const TRAILING_PUNCTUATION = new Set([".", ",", ";", ":", "!", "?", ")", "]", "}", "'", '"']);

const TRAILING_SLASH = new Set(["/"]);

/**
 * Trims trailing characters by scanning, not by matching.
 *
 * The obvious spelling is a regex like /[.,;:!?]+$/, and it is quadratic: on a
 * long run of those characters that does not reach the end, the engine retries
 * from every position. The URL matcher admits `. , ; : ! ?`, so an email
 * carrying a link followed by 64k dots took 6.5 seconds here - a denial of
 * service any sender could trigger, in a guardrail that reads every message.
 * A backwards scan is linear and cannot backtrack.
 */
function trimEnd(text: string, characters: Set<string>): string {
  let end = text.length;
  while (end > 0 && characters.has(text[end - 1] as string)) end -= 1;
  return end === text.length ? text : text.slice(0, end);
}

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
    trimEnd(
      trimEnd(raw, TRAILING_PUNCTUATION)
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, ""),
      TRAILING_SLASH,
    ),
  );
  return [...new Set(normalised.filter(Boolean))];
}
