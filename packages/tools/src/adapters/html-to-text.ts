/** Elements whose contents are never readable text. */
const DROPPED_ELEMENTS = /<(script|style|head|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi;

/**
 * HTML comments, contents included.
 *
 * Marketing mail is full of them - MSO conditionals, build markers, preheader
 * scaffolding - and leaving them in is what made every real email trip the
 * `hidden_text` guardrail.
 */
const COMMENTS = /<!--[\s\S]*?-->/g;

/** Tags that end a line of prose; without these, sentences run together. */
const BLOCK_TAGS = /<\/?(br|p|div|tr|li|ul|ol|h[1-6]|table|thead|tbody|blockquote|section|header|footer)\b[^>]*>/gi;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  // Zero-width entities are padding in preheaders; dropping them keeps them
  // out of the text a model reads and out of the injection scanner.
  zwnj: "",
  zwj: "",
  shy: "",
  mdash: "-",
  ndash: "-",
  hellip: "...",
  rsquo: "'",
  lsquo: "'",
  rdquo: '"',
  ldquo: '"',
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => codePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => codePoint(Number.parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match);
}

/** Zero-width and byte-order characters: invisible, and never meaningful in mail. */
const INVISIBLE = /[​‌‍⁠﻿]/g;

/**
 * Removes invisible characters from a mail body.
 *
 * Bulk senders insert these constantly — as preheader padding, and mid-word
 * through addresses and domains to defeat scrapers (`54<ZWSP>8 M<ZWSP>arket
 * St`). Detecting them is therefore useless: real mail is full of them.
 *
 * Removing them is better than detecting them anyway. An attacker splitting a
 * keyword to dodge a match — `ig<ZWSP>nore all previous instructions` — is
 * normalised back into `ignore all previous instructions`, which the
 * instruction patterns catch. The evasion is defeated rather than reported.
 *
 * Bidirectional overrides are deliberately left in place: they are genuinely
 * rare in ordinary mail and are a real spoofing signal, so `detectInjection`
 * still flags them.
 */
export function stripInvisible(text: string): string {
  return text.replace(INVISIBLE, "");
}

function codePoint(value: number): string {
  // Out-of-range values throw; a malformed entity should not fail a whole run.
  if (!Number.isFinite(value) || value < 0 || value > 0x10ffff) return "";
  return String.fromCodePoint(value);
}

/** A crafted body cannot spin this; it terminates either way. */
const MAX_STRIP_PASSES = 5;

/**
 * Removes tags, repeatedly.
 *
 * One pass is not enough: `<<div>div>` leaves `<div>` behind once the inner
 * match is removed. Nothing here is rendered as HTML, so this is not an XSS
 * control — it keeps leftover markup out of the text a model reads, which is
 * the whole point of the converter. Bounded rather than looping to a fixed
 * point, because terminating predictably matters more than winning a nesting
 * race.
 */
function stripTags(html: string): string {
  let text = html;
  for (let pass = 0; pass < MAX_STRIP_PASSES; pass += 1) {
    const next = text.replace(/<[^>]*>/g, "");
    if (next === text) return next;
    text = next;
  }
  return text;
}

/**
 * Converts an HTML mail body into the text a model should read.
 *
 * Not a renderer: the output only has to be readable and much smaller than the
 * markup. A typical marketing email goes from ~20,000 characters to ~1,500.
 *
 * This is a security control as much as a cost one. Content hidden with
 * `display:none` survives as ordinary text, so an instruction smuggled that way
 * is caught by `detectInjection`'s instruction patterns rather than being
 * noticed only as a hiding technique - a signal an attacker cannot dodge by
 * hiding differently.
 */
export function htmlToText(html: string): string {
  const withoutMarkup = stripTags(
    html.replace(DROPPED_ELEMENTS, " ").replace(COMMENTS, " ").replace(BLOCK_TAGS, "\n"),
  );

  return (
    stripInvisible(decodeEntities(withoutMarkup))
      .replace(/[^\S\n]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/** Cheap check for whether a body still looks like markup. */
export function looksLikeHtml(text: string): boolean {
  return /<\/?(html|body|table|div|span|td|p|br)\b[^>]*>/i.test(text);
}
