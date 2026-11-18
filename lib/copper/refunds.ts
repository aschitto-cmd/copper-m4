// Refunds (Module 4): the customer's orders, the refund requests, and the rule
// that decides which ones go through on their own. The rule is plain code, so
// the chatbot can't talk its way past it: the Refund agent can only ask for a
// refund, and only a person in the Refund Console can approve a held one.
//
// A refund is held for a person when either is true:
//   - the amount is over the auto-refund limit (set in the Refund Console), or
//   - the order is more than 30 days old.
//
// Everything lives in server memory, shared by everyone using this server. It
// resets when the server restarts. This is the only file that knows where
// refunds are kept, so moving them to a database later changes only this file.

export const DEFAULT_LIMIT_USD = 50;
export const MAX_ORDER_AGE_DAYS = 30;
export const CUSTOMER_NAME = "Maya Reyes";

const DAY_MS = 24 * 60 * 60 * 1000;

export type Order = {
  id: string;
  item: string;
  amountUsd: number;
  /** ISO date-time the order was placed. */
  placedAt: string;
};

export type RefundStatus = "refunded" | "waiting" | "approved" | "rejected";

export type HoldReason = "over_limit" | "older_than_30_days";

export type Refund = {
  id: string;
  orderId: string;
  item: string;
  amountUsd: number;
  reason: string;
  status: RefundStatus;
  /** Why a person has to decide. Empty when it went through on its own. */
  holdReasons: HoldReason[];
  /** The limit in force when it was requested. */
  limitUsd: number;
  orderAgeDays: number;
  requestedAt: string;
  decidedAt: string | null;
};

/** What request_refund hands back to the Refund agent. */
export type RefundResult =
  | { status: "refunded"; refund: Refund; message: string }
  | { status: "waiting_for_approval"; refund: Refund; message: string }
  | {
      status: "already_requested";
      refund: Refund;
      message: string;
    }
  | { status: "no_such_order"; orderId: string; message: string };

/** Seed orders, placed this many days before the server started. */
const SEED_ORDERS: {
  id: string;
  item: string;
  amountUsd: number;
  daysAgo: number;
}[] = [
  { id: "1001", item: "Copper Plus, monthly", amountUsd: 7.99, daysAgo: 6 },
  { id: "1002", item: "Copper Plus, annual", amountUsd: 79, daysAgo: 10 },
  { id: "1003", item: "Copper Notes", amountUsd: 129, daysAgo: 18 },
  { id: "1004", item: "Copper Home", amountUsd: 149, daysAgo: 42 },
  { id: "1005", item: "Copper Plus, monthly", amountUsd: 7.99, daysAgo: 37 },
];

type Store = {
  orders: Order[];
  refunds: Refund[];
  limitUsd: number;
  nextId: number;
};

function freshStore(now = Date.now()): Store {
  return {
    orders: SEED_ORDERS.map(({ daysAgo, ...order }) => ({
      ...order,
      placedAt: new Date(now - daysAgo * DAY_MS).toISOString(),
    })),
    refunds: [],
    limitUsd: DEFAULT_LIMIT_USD,
    nextId: 1,
  };
}

// One store per server, kept on globalThis so hot reloads in `npm run dev`
// don't wipe it.
const globalStore = globalThis as unknown as { __copperRefunds?: Store };

function store(): Store {
  globalStore.__copperRefunds ??= freshStore();
  return globalStore.__copperRefunds;
}

/** Starts over: the seed orders, no refunds and the default limit. */
export function resetRefunds(now = Date.now()) {
  globalStore.__copperRefunds = freshStore(now);
}

/** Whole days since the order was placed. */
export function orderAgeDays(order: Order, now = Date.now()): number {
  return Math.floor((now - new Date(order.placedAt).getTime()) / DAY_MS);
}

export function getOrders(now = Date.now()) {
  const { orders, refunds } = store();
  return orders.map((order) => ({
    ...order,
    ageDays: orderAgeDays(order, now),
    refund: refunds.find((r) => r.orderId === order.id) ?? null,
  }));
}

export function getRefunds(): Refund[] {
  return structuredClone(store().refunds);
}

export function getLimit(): number {
  return store().limitUsd;
}

/** Sets the auto-refund limit. Whole or half dollars from $0 to $10,000. */
export function setLimit(limitUsd: number): number {
  if (!Number.isFinite(limitUsd) || limitUsd < 0 || limitUsd > 10_000) {
    throw new Error("The limit must be between $0 and $10,000.");
  }
  store().limitUsd = Math.round(limitUsd * 100) / 100;
  return store().limitUsd;
}

/** Why this order would be held for a person, if at all. The whole rule. */
export function holdReasonsFor(
  amountUsd: number,
  ageDays: number,
  limitUsd: number,
): HoldReason[] {
  const reasons: HoldReason[] = [];
  if (amountUsd > limitUsd) reasons.push("over_limit");
  if (ageDays > MAX_ORDER_AGE_DAYS) reasons.push("older_than_30_days");
  return reasons;
}

const normalizeOrderId = (id: string) => id.replace(/[^0-9]/g, "");

/**
 * request_refund: asks for a refund on one order. The code decides: under the
 * rule it is refunded now, otherwise it waits for a person. An order can only
 * be refunded once.
 */
export function requestRefund(
  orderId: string,
  reason: string,
  now = Date.now(),
): RefundResult {
  const s = store();
  const order = s.orders.find((o) => o.id === normalizeOrderId(orderId));
  if (!order) {
    return {
      status: "no_such_order",
      orderId,
      message: `There is no order #${orderId} on this account.`,
    };
  }
  const existing = s.refunds.find((r) => r.orderId === order.id);
  if (existing) {
    return {
      status: "already_requested",
      refund: structuredClone(existing),
      message: `Order #${order.id} already has a refund request (${existing.status}). Each order can be refunded only once.`,
    };
  }
  const ageDays = orderAgeDays(order, now);
  const holdReasons = holdReasonsFor(order.amountUsd, ageDays, s.limitUsd);
  const refund: Refund = {
    id: `R-${s.nextId++}`,
    orderId: order.id,
    item: order.item,
    amountUsd: order.amountUsd,
    reason: reason.trim().slice(0, 300),
    status: holdReasons.length ? "waiting" : "refunded",
    holdReasons,
    limitUsd: s.limitUsd,
    orderAgeDays: ageDays,
    requestedAt: new Date(now).toISOString(),
    decidedAt: holdReasons.length ? null : new Date(now).toISOString(),
  };
  s.refunds.push(refund);
  if (refund.status === "refunded") {
    return {
      status: "refunded",
      refund: structuredClone(refund),
      message: `Refunded $${order.amountUsd} for order #${order.id}. It's within the rules, so it went through automatically.`,
    };
  }
  return {
    status: "waiting_for_approval",
    refund: structuredClone(refund),
    message: `Order #${order.id} needs a person to approve it (${holdReasons
      .map(describeHold)
      .join(
        "; ",
      )}). It is now waiting in the Refund Console. Nothing has been refunded yet.`,
  };
}

/** check_refund: the current status of the refund on one order. */
export function checkRefund(orderId: string) {
  const refund = store().refunds.find(
    (r) => r.orderId === normalizeOrderId(orderId),
  );
  return refund
    ? { found: true as const, refund: structuredClone(refund) }
    : {
        found: false as const,
        message: `No refund has been requested for order #${orderId}.`,
      };
}

/** A person's decision in the Refund Console. Only waiting refunds can be decided. */
export function decideRefund(
  refundId: string,
  decision: "approve" | "reject",
  now = Date.now(),
): Refund {
  const refund = store().refunds.find((r) => r.id === refundId);
  if (!refund) throw new Error(`No refund ${refundId}.`);
  if (refund.status !== "waiting") {
    throw new Error(`Refund ${refundId} was already ${refund.status}.`);
  }
  refund.status = decision === "approve" ? "approved" : "rejected";
  refund.decidedAt = new Date(now).toISOString();
  return structuredClone(refund);
}

export function describeHold(reason: HoldReason): string {
  return reason === "over_limit"
    ? "over the auto-refund limit"
    : `order is more than ${MAX_ORDER_AGE_DAYS} days old`;
}
