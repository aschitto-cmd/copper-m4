// Module 4: the refund rule is code. These cover the slide's "try to break it"
// cases: the same refund twice, a limit of 0, and approving only through the
// Refund Console.
import { beforeEach, describe, expect, it } from "vitest";
import {
  checkRefund,
  decideRefund,
  getRefunds,
  requestRefund,
  resetRefunds,
  setLimit,
} from "@/lib/copper/refunds";

beforeEach(() => resetRefunds());

describe("Refund rule", () => {
  it("refunds a recent order at or under the limit on its own", () => {
    const result = requestRefund("1001", "Didn't use it");
    expect(result.status).toBe("refunded");
  });

  it("holds an order over the limit for a person", () => {
    const result = requestRefund("#1003", "Changed my mind");
    expect(result.status).toBe("waiting_for_approval");
    if (result.status !== "waiting_for_approval") return;
    expect(result.refund.holdReasons).toEqual(["over_limit"]);
  });

  it("holds an order more than 30 days old, even when it's under the limit", () => {
    const result = requestRefund("1005", "Forgot to cancel");
    expect(result.status).toBe("waiting_for_approval");
    if (result.status !== "waiting_for_approval") return;
    expect(result.refund.holdReasons).toEqual(["older_than_30_days"]);
  });

  it("gives both reasons for an old, expensive order", () => {
    const result = requestRefund("1004", "Broken");
    if (result.status !== "waiting_for_approval") throw new Error("not held");
    expect(result.refund.holdReasons).toEqual([
      "over_limit",
      "older_than_30_days",
    ]);
  });

  it("refuses the same refund twice", () => {
    requestRefund("1001", "first");
    const again = requestRefund("1001", "second");
    expect(again.status).toBe("already_requested");
    expect(getRefunds()).toHaveLength(1);
  });

  it("with the limit at 0, every refund waits for a person", () => {
    setLimit(0);
    expect(requestRefund("1001", "x").status).toBe("waiting_for_approval");
  });

  it("rejects a negative limit", () => {
    expect(() => setLimit(-5)).toThrow();
  });

  it("only a console decision changes a held refund, and only once", () => {
    const held = requestRefund("1003", "x");
    if (held.status !== "waiting_for_approval") throw new Error("not held");
    expect(checkRefund("1003")).toMatchObject({
      found: true,
      refund: { status: "waiting" },
    });
    expect(decideRefund(held.refund.id, "approve").status).toBe("approved");
    expect(() => decideRefund(held.refund.id, "reject")).toThrow();
  });

  it("a refund that went through on its own can't be decided", () => {
    const done = requestRefund("1001", "x");
    if (done.status !== "refunded") throw new Error("not refunded");
    expect(() => decideRefund(done.refund.id, "approve")).toThrow();
  });

  it("an unknown order is reported, not refunded", () => {
    expect(requestRefund("9999", "x").status).toBe("no_such_order");
  });
});
