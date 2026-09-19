/**
 * Prompt-injection heuristics.
 *
 * These are a signal, not a control. They exist to surface suspicious content
 * to a human and to the trace; the approval gate and the output guardrails are
 * what actually stop an injected instruction from having an effect. Treating a
 * pattern match as a block would be both easy to evade and prone to discarding
 * legitimate mail.
 */
const PATTERNS: { name: string; pattern: RegExp }[] = [
  {
    name: "instruction_override",
    pattern: /\b(ignore|disregard|forget|override)\b[^.!?\n]{0,40}\b(previous|prior|earlier|above|all)\b[^.!?\n]{0,20}\b(instruction|prompt|rule|direction)/i,
  },
  {
    // Scanning happens over serialized tool output, so a role marker is rarely
    // at a true line start: in JSON it follows an opening quote, and a real
    // newline has become the two characters \ and n. Anchor on all three.
    name: "role_impersonation",
    pattern: /(?:^|\n|\\n|["'])\s*(system|assistant|developer)\s*:/i,
  },
  {
    name: "approval_solicitation",
    pattern: /\b(approve|authorise|authorize|confirm)\b[^.!?\n]{0,30}\b(this|the|all)\b[^.!?\n]{0,20}\b(action|request|transfer|payment|record)|\bapproval\b[^.!?\n]{0,20}\bis\b[^.!?\n]{0,20}\b(disabled|not required|bypassed)/i,
  },
  {
    name: "send_solicitation",
    pattern: /\b(send|forward|email|reply with|transmit)\b[^.!?\n]{0,30}\b(all|every|each|the full|a list of|summary of)\b/i,
  },
  {
    name: "hidden_text",
    pattern: /<!--|\bdisplay\s*:\s*none\b|\bfont-size\s*:\s*0|\bvisibility\s*:\s*hidden\b|[​-‏‪-‮⁠﻿]/i,
  },
];

/** Returns the names of every injection pattern present in `text`. */
export function detectInjection(text: string): string[] {
  return PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ name }) => name);
}
