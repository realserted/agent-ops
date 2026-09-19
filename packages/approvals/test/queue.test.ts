import { afterEach, describe, expect, it, vi } from "vitest";
import { ApprovalQueue } from "../src/queue";

const call = (name = "create_record", args: Record<string, unknown> = { email_id: "em_001" }) => ({
  id: `call_${name}`,
  name,
  args,
});

const tick = () => new Promise((resolve) => setImmediate(resolve));

afterEach(() => {
  vi.useRealTimers();
});

describe("ApprovalQueue", () => {
  it("holds a request open until a decision arrives", async () => {
    const queue = new ApprovalQueue();
    const settled = vi.fn();
    void queue.request(call()).then(settled);
    await tick();

    expect(settled).not.toHaveBeenCalled();
    expect(queue.pending()).toHaveLength(1);
  });

  it("surfaces the tool and arguments a human needs to decide", async () => {
    const queue = new ApprovalQueue();
    void queue.request(call("create_record", { email_id: "em_001", kind: "invoice" }), "trace-1");
    await tick();

    expect(queue.pending()[0]).toMatchObject({
      toolName: "create_record",
      args: { email_id: "em_001", kind: "invoice" },
      traceId: "trace-1",
    });
  });

  it("resolves approved when approved", async () => {
    const queue = new ApprovalQueue();
    const decision = queue.request(call());
    await tick();

    expect(queue.decide(queue.pending()[0]!.id, "approved")).toBe(true);
    await expect(decision).resolves.toBe("approved");
  });

  it("resolves denied when denied", async () => {
    const queue = new ApprovalQueue();
    const decision = queue.request(call());
    await tick();

    queue.decide(queue.pending()[0]!.id, "denied");
    await expect(decision).resolves.toBe("denied");
  });

  it("removes a request from pending once decided", async () => {
    const queue = new ApprovalQueue();
    void queue.request(call());
    await tick();

    queue.decide(queue.pending()[0]!.id, "approved");
    expect(queue.pending()).toHaveLength(0);
  });

  it("refuses a second decision on the same request", async () => {
    const queue = new ApprovalQueue();
    void queue.request(call());
    await tick();
    const { id } = queue.pending()[0]!;

    expect(queue.decide(id, "approved")).toBe(true);
    expect(queue.decide(id, "denied")).toBe(false);
  });

  it("returns false for an unknown id", () => {
    expect(new ApprovalQueue().decide("nope", "approved")).toBe(false);
  });

  // Silence is not consent: an unanswered request must not become an approval.
  it("expires rather than approves when nobody answers", async () => {
    vi.useFakeTimers();
    const queue = new ApprovalQueue({ timeoutMs: 1_000 });
    const decision = queue.request(call());

    await vi.advanceTimersByTimeAsync(1_001);

    await expect(decision).resolves.toBe("expired");
    expect(queue.pending()).toHaveLength(0);
  });

  it("orders the queue oldest first", async () => {
    const queue = new ApprovalQueue();
    void queue.request(call("a"));
    await new Promise((r) => setTimeout(r, 2));
    void queue.request(call("b"));
    await tick();

    expect(queue.pending().map((p) => p.toolName)).toEqual(["a", "b"]);
  });

  it("records decided requests newest first", async () => {
    const queue = new ApprovalQueue();
    void queue.request(call("a"));
    await tick();
    queue.decide(queue.pending()[0]!.id, "approved");
    void queue.request(call("b"));
    await tick();
    queue.decide(queue.pending()[0]!.id, "denied");

    expect(queue.resolved().map((r) => [r.toolName, r.decision])).toEqual([
      ["b", "denied"],
      ["a", "approved"],
    ]);
  });

  it("denies everything in flight on shutdown", async () => {
    const queue = new ApprovalQueue();
    const first = queue.request(call("a"));
    const second = queue.request(call("b"));
    await tick();

    expect(queue.denyAll()).toBe(2);
    await expect(first).resolves.toBe("denied");
    await expect(second).resolves.toBe("denied");
  });
});

describe("approver", () => {
  it("returns true to the agent only when approved", async () => {
    const queue = new ApprovalQueue();
    const approve = queue.approver("trace-1");
    const allowed = approve(call());
    await tick();

    queue.decide(queue.pending()[0]!.id, "approved");
    await expect(allowed).resolves.toBe(true);
  });

  it("returns false on denial", async () => {
    const queue = new ApprovalQueue();
    const allowed = queue.approver()(call());
    await tick();

    queue.decide(queue.pending()[0]!.id, "denied");
    await expect(allowed).resolves.toBe(false);
  });

  it("returns false on expiry", async () => {
    vi.useFakeTimers();
    const queue = new ApprovalQueue({ timeoutMs: 500 });
    const allowed = queue.approver()(call());

    await vi.advanceTimersByTimeAsync(501);

    await expect(allowed).resolves.toBe(false);
  });

  it("tags requests with the trace they belong to", async () => {
    const queue = new ApprovalQueue();
    void queue.approver("trace-xyz")(call());
    await tick();

    expect(queue.pending()[0]?.traceId).toBe("trace-xyz");
  });
});
