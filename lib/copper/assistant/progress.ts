// What Ask Copper is doing, step by step, as it streams in: Gemini's thinking
// summaries, each tool call (with what went in and what came out), and the
// reply. The panel draws this as it changes.

export type ThinkingStep = { type: "thinking"; text: string };

export type ToolStep = {
  type: "tool";
  id: string;
  name: string;
  /** "calling" until the tool's result comes back. */
  state: "calling" | "done" | "error";
  input?: unknown;
  output?: unknown;
};

/** Which agent is talking: Copper, or the Refund agent (Module 4). */
export type AgentName = "copper" | "refund";

/** One agent handing the chat to the other. */
export type HandoffStep = { type: "handoff"; from: AgentName; to: AgentName };

export type Step = ThinkingStep | ToolStep | HandoffStep;

export type Progress = {
  steps: Step[];
  reply: string;
  status: "working" | "done" | "error";
  /** Who holds the chat after this answer. Missing means Copper. */
  agent?: AgentName;
};

export const AGENT_LABELS: Record<AgentName, string> = {
  copper: "Copper",
  refund: "Refund agent",
};

/** The tools each agent is given, in the order the panel lists them. */
export const AGENT_TOOLS: Record<AgentName, string[]> = {
  copper: [
    "get_products",
    "get_prices",
    "calculate_cost",
    "check_availability",
    "search_docs",
    "transfer_refund",
  ],
  refund: ["get_orders", "request_refund", "check_refund", "transfer_agent"],
};

/** Every tool call in an answer, in order. */
export function toolCallsOf(progress: Progress) {
  return progress.steps
    .filter((step): step is ToolStep => step.type === "tool")
    .map(({ name, input, output }) => ({ name, input, output }));
}

/**
 * The tools Copper can use, and what each one does in plain English. The chat
 * panel lists these, so it lives here (and not in tools.ts, which reads the
 * database and can't be imported by a client component).
 */
export const TOOL_LABELS: Record<string, string> = {
  get_products: "Listing the products",
  get_prices: "Looking up prices",
  calculate_cost: "Working out the cost",
  check_availability: "Checking stock",
  search_docs: "Searching the documents",
  transfer_refund: "Handing over to the Refund agent",
  get_orders: "Looking up the orders",
  request_refund: "Asking the app for a refund",
  check_refund: "Checking the refund",
  transfer_agent: "Handing back to Copper",
};
