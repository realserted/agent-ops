import { describe, expect, it } from "vitest";
import { LOOP_THRESHOLD, LoopDetector } from "../../src/guardrails/loop";

describe("LoopDetector", () => {
  it("allows the first two identical calls and trips on the third", () => {
    const loops = new LoopDetector();
    const args = { email_id: "em_001" };

    expect(loops.record("get_email", args)).toBeUndefined();
    expect(loops.record("get_email", args)).toBeUndefined();
    expect(loops.record("get_email", args)).toMatch(/already called "get_email".*3 times/s);
  });

  it("trips on the documented threshold", () => {
    expect(LOOP_THRESHOLD).toBe(3);
  });

  it("tells the model how to recover", () => {
    const loops = new LoopDetector(1);

    expect(loops.record("add", {})).toMatch(/Change your approach/);
  });

  it("treats different arguments as different calls", () => {
    const loops = new LoopDetector();

    expect(loops.record("get_email", { email_id: "em_001" })).toBeUndefined();
    expect(loops.record("get_email", { email_id: "em_002" })).toBeUndefined();
    expect(loops.record("get_email", { email_id: "em_003" })).toBeUndefined();
  });

  it("treats different tools as different calls", () => {
    const loops = new LoopDetector();

    expect(loops.record("a", {})).toBeUndefined();
    expect(loops.record("b", {})).toBeUndefined();
    expect(loops.record("c", {})).toBeUndefined();
  });

  it("keeps tripping once the threshold is passed", () => {
    const loops = new LoopDetector();

    loops.record("x", {});
    loops.record("x", {});

    expect(loops.record("x", {})).toBeDefined();
    expect(loops.record("x", {})).toMatch(/4 times/);
  });

  it("accepts a custom threshold", () => {
    const loops = new LoopDetector(2);

    expect(loops.record("x", {})).toBeUndefined();
    expect(loops.record("x", {})).toBeDefined();
  });
});
