"use client";

// The Refund Console: where a person sets the auto-refund limit and approves
// or rejects the refunds the rule held back. It reloads whenever the chat
// finishes an answer (the "copper:refunds-changed" event) and every few
// seconds, and tells the chat about each decision ("copper:refund-decided")
// so the Refund agent can let the customer know.
import { CheckIcon, RotateCcwIcon, XIcon } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatUsd } from "@/lib/copper/catalog";
import {
  type ConsoleState,
  decide,
  loadConsole,
  resetDemo,
  updateLimit,
} from "@/lib/copper/refund-console";
import type { Refund, RefundStatus } from "@/lib/copper/refunds";
import { MAX_ORDER_AGE_DAYS } from "@/lib/copper/refunds";

export const REFUNDS_CHANGED = "copper:refunds-changed";
export const REFUND_DECIDED = "copper:refund-decided";

const POLL_MS = 4000;

const date = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

export function RefundConsole() {
  const [state, setState] = useState<ConsoleState | null>(null);
  // What's typed in the limit box; null until someone edits it.
  const [typed, setDraft] = useState<string | null>(null);
  const draft = typed ?? (state ? String(state.limitUsd) : "");
  const [limitError, setLimitError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setState(await loadConsole());
    } catch {
      // Keep showing the last state; the next poll tries again.
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(reload, 0);
    const timer = setInterval(reload, POLL_MS);
    window.addEventListener(REFUNDS_CHANGED, reload);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      window.removeEventListener(REFUNDS_CHANGED, reload);
    };
  }, [reload]);

  async function saveLimit() {
    const value = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(value) || value < 0) {
      setLimitError("Enter a dollar amount of 0 or more.");
      return;
    }
    if (value > 10_000) {
      setLimitError("The limit can't be more than $10,000.");
      return;
    }
    setBusy("limit");
    try {
      const next = await updateLimit(value);
      setState(next);
      setDraft(String(next.limitUsd));
    } finally {
      setBusy(null);
    }
  }

  async function onDecide(refund: Refund, decision: "approve" | "reject") {
    setBusy(refund.id);
    try {
      const result = await decide(refund.id, decision);
      setState(result.state);
      window.dispatchEvent(
        new CustomEvent(REFUND_DECIDED, { detail: result.refund }),
      );
    } catch {
      await reload();
    } finally {
      setBusy(null);
    }
  }

  async function onReset() {
    setBusy("reset");
    try {
      const next = await resetDemo();
      setState(next);
      setDraft(String(next.limitUsd));
      setLimitError("");
    } finally {
      setBusy(null);
    }
  }

  if (!state)
    return (
      <p className="text-muted-foreground mt-6 text-sm">Loading refunds…</p>
    );

  const waiting = state.refunds.filter((r) => r.status === "waiting");
  const decided = state.refunds.filter((r) => r.status !== "waiting");

  return (
    <div className="mt-2 space-y-6">
      <p className="text-muted-foreground">
        Ask for a refund in the chat as the customer. Copper hands you to the
        Refund agent, which asks the app for the refund. The app applies the
        rule: refunds over your limit, or on orders more than{" "}
        {MAX_ORDER_AGE_DAYS} days old, wait here for you.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Auto-refund limit</CardTitle>
          <CardDescription>
            Refunds up to {formatUsd(state.limitUsd)} on orders{" "}
            {MAX_ORDER_AGE_DAYS} days old or newer go through on their own.
            Anything else needs your approval.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void saveLimit();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="limit">Limit in dollars</Label>
              <Input
                id="limit"
                inputMode="decimal"
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setLimitError("");
                }}
                className="w-32"
                aria-invalid={limitError ? true : undefined}
              />
            </div>
            <Button type="submit" disabled={busy === "limit"}>
              Save limit
            </Button>
          </form>
          {limitError && (
            <p className="text-destructive mt-2 text-sm">{limitError}</p>
          )}
        </CardContent>
      </Card>

      <Card data-testid="refund-queue">
        <CardHeader>
          <CardTitle>Waiting for your approval</CardTitle>
          <CardDescription>
            {waiting.length
              ? `${waiting.length} refund${waiting.length === 1 ? "" : "s"} held by the rule.`
              : "Nothing is waiting. Held refunds will stop here."}
          </CardDescription>
        </CardHeader>
        {waiting.length > 0 && (
          <CardContent className="space-y-3">
            {waiting.map((refund) => (
              <div
                key={refund.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {refund.item} · {formatUsd(refund.amountUsd)}
                  </p>
                  <p className="text-muted-foreground text-sm">
                    Order #{refund.orderId} · {refund.id} ·{" "}
                    {refund.reason || "No reason given"}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {refund.holdReasons.map((reason) => (
                      <Badge key={reason} variant="outline">
                        {reason === "over_limit"
                          ? `Over the ${formatUsd(refund.limitUsd)} limit`
                          : `Order ${refund.orderAgeDays} days old`}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={busy === refund.id}
                    onClick={() => onDecide(refund, "approve")}
                  >
                    <CheckIcon /> Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === refund.id}
                    onClick={() => onDecide(refund, "reject")}
                  >
                    <XIcon /> Reject
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{state.customer}&apos;s orders</CardTitle>
          <CardDescription>
            The orders the Refund agent can see with get_orders.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {state.orders.map((order) => (
            <div
              key={order.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2.5"
            >
              <div>
                <p className="font-medium">
                  #{order.id} · {order.item}
                </p>
                <p className="text-muted-foreground text-sm">
                  {date(order.placedAt)} · {order.ageDays} days ago
                  {order.ageDays > MAX_ORDER_AGE_DAYS && " · past 30 days"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={order.refund?.status ?? null} />
                <span className="font-mono text-sm">
                  {formatUsd(order.amountUsd)}
                </span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {decided.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Refund history</CardTitle>
          </CardHeader>
          <CardContent className="divide-y">
            {decided
              .slice()
              .reverse()
              .map((refund) => (
                <div
                  key={refund.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm"
                >
                  <span>
                    {refund.id} · #{refund.orderId} {refund.item}
                  </span>
                  <span className="flex items-center gap-2">
                    <StatusBadge status={refund.status} />
                    <span className="font-mono">
                      {formatUsd(refund.amountUsd)}
                    </span>
                  </span>
                </div>
              ))}
          </CardContent>
        </Card>
      )}

      <Button
        variant="ghost"
        size="sm"
        onClick={onReset}
        disabled={busy === "reset"}
      >
        <RotateCcwIcon /> Reset the demo
      </Button>
    </div>
  );
}

const STATUS: Record<RefundStatus, { label: string; className: string }> = {
  refunded: {
    label: "Refunded automatically",
    className: "bg-accent text-white",
  },
  waiting: {
    label: "Waiting for approval",
    className: "bg-chart-4 text-chart-5",
  },
  approved: {
    label: "Approved by a person",
    className: "bg-primary text-primary-foreground",
  },
  rejected: { label: "Rejected", className: "bg-chart-3 text-white" },
};

function StatusBadge({ status }: { status: RefundStatus | null }): ReactNode {
  if (!status) return <Badge variant="outline">Paid</Badge>;
  const { label, className } = STATUS[status];
  return <Badge className={className}>{label}</Badge>;
}
