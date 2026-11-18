"use server";

// The server action the Ask Copper chat calls. It streams the conversation to
// the model through callStream (lib/ai/call.ts), with or without the tools,
// and sends back each step as it happens, so the panel can show Copper
// thinking and using its tools.
//
// Module 4: two agents share the chat. Copper hands a refund to the Refund
// agent with transfer_refund; the Refund agent hands anything else back with
// transfer_agent. Each agent has its own instructions and tools. A handoff
// starts the other agent on the same conversation, at most once per question.
import { hasToolCall, stepCountIs, type ToolSet } from "ai";
import { callStream, type CallInfo, THOUGHT_SUMMARIES } from "@/lib/ai/call";
import { createLive, type Live } from "@/lib/ai/live";
import { COPPER_INSTRUCTIONS } from "@/lib/copper/assistant/instructions";
import type {
  AgentName,
  Progress,
  ToolStep,
} from "@/lib/copper/assistant/progress";
import {
  REFUND_INSTRUCTIONS,
  refundTools,
} from "@/lib/copper/assistant/refund-agent";
import { copperTools } from "@/lib/copper/assistant/tools";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type AskCopperRequest = {
  messages: ChatMessage[];
  useTools: boolean;
  /** Who holds the chat. Missing means Copper. */
  agent?: AgentName;
};

export type AskCopperResult = { progress: Live<Progress> };

/** At most this many model steps (tool calls plus the reply) per question. */
const MAX_STEPS = 5;

const SORRY = "Sorry, something went wrong on my end. Please try again.";

type Agent = {
  info: CallInfo;
  instructions: string;
  tools: ToolSet;
  /** The tool that hands the chat to the other agent. */
  transfer: string;
  other: AgentName;
};

const AGENTS: Record<AgentName, Agent> = {
  copper: {
    info: { module: 2, feature: "ask-copper" },
    instructions: COPPER_INSTRUCTIONS,
    tools: copperTools,
    transfer: "transfer_refund",
    other: "refund",
  },
  refund: {
    info: { module: 4, feature: "refund-agent" },
    instructions: REFUND_INSTRUCTIONS,
    tools: refundTools,
    transfer: "transfer_agent",
    other: "copper",
  },
};

export async function askCopper({
  messages,
  useTools,
  agent = "copper",
}: AskCopperRequest): Promise<AskCopperResult> {
  const { live, update, done } = createLive<Progress>();
  // Tools off is the plain model: no agents, no handoffs.
  const first: AgentName = useTools ? agent : "copper";
  const progress: Progress = {
    steps: [],
    reply: "",
    status: "working",
    agent: first,
  };
  // A fresh copy each time, so earlier updates never change underneath the
  // panel.
  const snapshot = (): Progress => ({
    ...progress,
    steps: progress.steps.map((step) => ({ ...step })),
  });
  const toolStep = (id: string) =>
    progress.steps.find(
      (step): step is ToolStep => step.type === "tool" && step.id === id,
    );

  /** Streams one agent's turn into progress. Returns true if it handed off. */
  async function run(name: AgentName): Promise<boolean> {
    const current = AGENTS[name];
    // Without tools, send no instructions either: "always use your tools" with
    // no tools makes the model answer with nothing.
    const result = callStream(current.info, {
      messages,
      providerOptions: THOUGHT_SUMMARIES,
      ...(useTools && {
        instructions: current.instructions,
        tools: current.tools,
        stopWhen: [stepCountIs(MAX_STEPS), hasToolCall(current.transfer)],
      }),
    });
    let handedOff = false;
    for await (const part of result.fullStream) {
      switch (part.type) {
        case "reasoning-delta": {
          const last = progress.steps.at(-1);
          if (last?.type === "thinking") last.text += part.text;
          else progress.steps.push({ type: "thinking", text: part.text });
          break;
        }
        case "tool-input-start":
          progress.steps.push({
            type: "tool",
            id: part.id,
            name: part.toolName,
            state: "calling",
          });
          break;
        case "tool-call": {
          const step = toolStep(part.toolCallId);
          if (step) step.input = part.input;
          else
            progress.steps.push({
              type: "tool",
              id: part.toolCallId,
              name: part.toolName,
              state: "calling",
              input: part.input,
            });
          break;
        }
        case "tool-result": {
          const step = toolStep(part.toolCallId);
          if (step) Object.assign(step, { output: part.output, state: "done" });
          if (useTools && part.toolName === current.transfer) handedOff = true;
          break;
        }
        case "tool-error": {
          const step = toolStep(part.toolCallId);
          const message =
            part.error instanceof Error
              ? part.error.message
              : String(part.error);
          if (step) Object.assign(step, { output: message, state: "error" });
          break;
        }
        case "text-delta":
          progress.reply += part.text;
          break;
        case "error":
          throw part.error;
        default:
          continue;
      }
      update(snapshot());
    }
    return handedOff;
  }

  // Read the streams in the background, so the panel gets the first update now.
  void (async () => {
    try {
      if (await run(first)) {
        const next = AGENTS[first].other;
        // Whatever the first agent said before handing off isn't the answer.
        progress.reply = "";
        progress.steps.push({ type: "handoff", from: first, to: next });
        progress.agent = next;
        update(snapshot());
        // Once per question, so two agents can't pass the chat back and forth.
        // If it hands straight back, the next question starts with the first.
        if (await run(next)) progress.agent = first;
      }
      progress.status = "done";
      if (!progress.reply.trim()) progress.reply = SORRY;
    } catch {
      progress.status = "error";
      if (!progress.reply.trim()) progress.reply = SORRY;
    }
    done(snapshot());
  })();

  return { progress: live };
}
