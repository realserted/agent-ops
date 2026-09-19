/** Identical call this many times in one run and the model is told to change approach. */
export const LOOP_THRESHOLD = 3;

/**
 * Detects a model stuck repeating itself.
 *
 * Keyed on tool name plus serialized arguments, so calling the same tool with
 * different arguments — the normal shape of triaging several emails — never
 * trips it. Only a byte-identical repeat counts.
 */
export class LoopDetector {
  private readonly counts = new Map<string, number>();

  constructor(private readonly threshold = LOOP_THRESHOLD) {}

  /**
   * Records a call and reports whether it has now repeated too often.
   * Returns a message to hand back to the model, or `undefined` to proceed.
   */
  record(name: string, args: unknown): string | undefined {
    const key = `${name}:${JSON.stringify(args) ?? "null"}`;
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);

    if (count < this.threshold) return undefined;
    return (
      `You have already called "${name}" with these exact arguments ${count} times. ` +
      "Change your approach: use different arguments, call a different tool, or finish with a summary."
    );
  }
}
