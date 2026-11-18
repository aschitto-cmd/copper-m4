"use server";

// Server actions for the Refund Console page: read the orders, refunds and
// limit, change the limit, and approve or reject a held refund. Only a person
// clicking in the console reaches decideRefund; neither agent has a tool for it.
import {
  CUSTOMER_NAME,
  decideRefund,
  getLimit,
  getOrders,
  getRefunds,
  type Refund,
  resetRefunds,
  setLimit,
} from "@/lib/copper/refunds";

export type ConsoleState = {
  customer: string;
  limitUsd: number;
  orders: ReturnType<typeof getOrders>;
  refunds: Refund[];
};

export async function loadConsole(): Promise<ConsoleState> {
  return {
    customer: CUSTOMER_NAME,
    limitUsd: getLimit(),
    orders: getOrders(),
    refunds: getRefunds(),
  };
}

export async function updateLimit(limitUsd: number): Promise<ConsoleState> {
  setLimit(limitUsd);
  return loadConsole();
}

export async function decide(
  refundId: string,
  decision: "approve" | "reject",
): Promise<{ refund: Refund; state: ConsoleState }> {
  const refund = decideRefund(refundId, decision);
  return { refund, state: await loadConsole() };
}

export async function resetDemo(): Promise<ConsoleState> {
  resetRefunds();
  return loadConsole();
}
