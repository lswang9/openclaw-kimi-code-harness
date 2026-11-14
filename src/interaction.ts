import {
  runAgentHarnessGatewayQuestion,
  type AgentHarnessUserInputQuestion,
  type EmbeddedRunAttemptParamsV2,
} from "openclaw/plugin-sdk/agent-harness-runtime";
import type { KimiCodePluginConfig } from "./config.js";
import type {
  KimiApprovalRequest,
  KimiApprovalResponse,
  KimiQuestionRequest,
  KimiQuestionResult,
} from "./kimi-sdk.js";
import { safeErrorMessage } from "./redact.js";

type Attempt = EmbeddedRunAttemptParamsV2;

export function createKimiApprovalHandler(
  params: Attempt,
  config: KimiCodePluginConfig,
): (request: KimiApprovalRequest) => Promise<KimiApprovalResponse> {
  return async (request) => {
    await emitApprovalEvent(params, request, "requested", "pending");
    if (config.approvalPolicy === "deny") {
      const response = {
        decision: "rejected",
        feedback: "Kimi Code approvals are disabled by the plugin's controlled deny policy.",
      } as const;
      await emitApprovalEvent(params, request, "resolved", "denied");
      return response;
    }
    try {
      const host = params.hostCapabilities;
      host.assertActive();
      const description = approvalDescription(request);
      const requested = await host.requestApproval({
        ...(params.abortSignal ? { signal: params.abortSignal } : {}),
        title: truncate(request.action || `Kimi Code: ${request.toolName}`, 80),
        description: truncate(description, 512),
        detail: truncate(description, 16_384),
        severity: "warning",
        toolName: request.toolName,
        toolCallId: request.toolCallId,
        allowedDecisions: ["allow-once", "deny"],
        timeoutMs: config.approvalTimeoutMs,
        transportTimeoutMs: config.approvalTimeoutMs + 10_000,
      });
      let decision = requested?.decision;
      let terminalReason: string | null | undefined;
      if (requested?.id && decision !== null && decision !== undefined) {
        terminalReason = undefined;
      } else if (requested?.id) {
        const settled = await host.waitForApproval({
          approvalId: requested.id,
          timeoutMs: config.approvalTimeoutMs,
          transportTimeoutMs: config.approvalTimeoutMs + 10_000,
          ...(params.abortSignal ? { signal: params.abortSignal } : {}),
        });
        decision = settled?.decision;
        terminalReason = settled?.terminalReason;
      }
      if (params.abortSignal?.aborted || terminalReason === "run-aborted") {
        await emitApprovalEvent(params, request, "resolved", "denied", "cancelled");
        return { decision: "cancelled", feedback: "The OpenClaw run was cancelled." };
      }
      if (decision === "allow-once") {
        await emitApprovalEvent(params, request, "resolved", "approved");
        return { decision: "approved" };
      }
      const feedback = terminalReason
        ? `Approval ended without permission: ${terminalReason}.`
        : "Approval was denied or no OpenClaw approval route was available.";
      await emitApprovalEvent(params, request, "resolved", "denied", terminalReason ?? undefined);
      return { decision: "rejected", feedback };
    } catch (error) {
      await emitApprovalEvent(params, request, "resolved", "failed", safeErrorMessage(error));
      return {
        decision: params.abortSignal?.aborted ? "cancelled" : "rejected",
        feedback: `Kimi Code approval could not be completed safely: ${safeErrorMessage(error)}`,
      };
    }
  };
}

export function createKimiQuestionHandler(
  params: Attempt,
  config: KimiCodePluginConfig,
): (request: KimiQuestionRequest) => Promise<KimiQuestionResult> {
  return async (request) => {
    const questions = request.questions.map((question, index) =>
      toOpenClawQuestion(question, index),
    );
    if (questions.length === 0) {
      return null;
    }
    try {
      const result = await runAgentHarnessGatewayQuestion({
        questions,
        sessionKey: params.sessionKey ?? params.sessionId,
        ...(params.agentId ? { agentId: params.agentId } : {}),
        runId: params.runId,
        timeoutMs: config.approvalTimeoutMs,
        delivery: params,
        promptOptions: { intro: "Kimi Code needs input:" },
        ...(params.abortSignal ? { signal: params.abortSignal } : {}),
      });
      if (result.status !== "answered") {
        return null;
      }
      const answers: Record<string, string | true> = {};
      for (const [index, question] of request.questions.entries()) {
        const id = questionId(question, index);
        const selected = result.answers.answers[id] ?? [];
        if (selected.length > 0) {
          answers[question.question] = selected.join(", ");
        }
      }
      return Object.keys(answers).length > 0 ? { answers } : null;
    } catch {
      return null;
    }
  };
}

function toOpenClawQuestion(
  question: KimiQuestionRequest["questions"][number],
  index: number,
): AgentHarnessUserInputQuestion {
  return {
    id: questionId(question, index),
    header: question.header?.trim() || `Question ${index + 1}`,
    question: question.body ? `${question.question}\n\n${question.body}` : question.question,
    options: question.options.map((option) => ({
      label: option.label,
      ...(option.description ? { description: option.description } : {}),
    })),
    multiSelect: question.multiSelect === true,
    isOther: question.otherLabel !== undefined || question.options.length === 0,
    isSecret: false,
  };
}

function questionId(question: KimiQuestionRequest["questions"][number], index: number): string {
  return question.header?.trim() || `q_${index}`;
}

function approvalDescription(request: KimiApprovalRequest): string {
  const display = safeDisplay(request.display);
  return [`Tool: ${request.toolName}`, `Call: ${request.toolCallId}`, display]
    .filter(Boolean)
    .join("\n");
}

function safeDisplay(display: unknown): string {
  if (typeof display === "string") {
    return display;
  }
  try {
    return JSON.stringify(display, null, 2) || "No additional detail";
  } catch {
    return "Unserializable approval detail";
  }
}

async function emitApprovalEvent(
  params: Attempt,
  request: KimiApprovalRequest,
  phase: "requested" | "resolved",
  status: "pending" | "approved" | "denied" | "failed",
  reason?: string,
): Promise<void> {
  await params.onAgentEvent?.({
    stream: "approval",
    data: {
      phase,
      kind: "plugin",
      status,
      title: request.action,
      toolCallId: request.toolCallId,
      itemId: request.toolCallId,
      ...(reason ? { reason } : {}),
    },
  });
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}
