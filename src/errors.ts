import { safeErrorMessage } from "./redact.js";

export function isNativeSessionMissing(error: unknown): boolean {
  const code = readCode(error);
  if (
    code === "session.not_found" ||
    code === "session.state_not_found" ||
    code === "session.id_invalid"
  ) {
    return true;
  }
  const message = safeErrorMessage(error);
  return /session.*(?:not found|does not exist|missing)/i.test(message);
}

export function actionableKimiError(error: unknown): Error {
  const code = readCode(error);
  const detail = safeErrorMessage(error);
  if (code === "auth.login_required" || code === "provider.auth_error" || /\b401\b/.test(detail)) {
    return new Error(
      `Kimi Code authentication is missing or expired. Run "kimi login" with the official CLI, then retry. ${detail}`,
      { cause: error },
    );
  }
  if (code === "model.not_configured" || code === "model.config_invalid") {
    return new Error(
      `Kimi Code has no usable native model configuration. Run "kimi login" or check config.toml. ${detail}`,
      { cause: error },
    );
  }
  if (code === "session.occupied" || code === "turn.agent_busy") {
    return new Error(
      `The native Kimi Code session is busy or owned by another client. Stop that turn or close the other client before retrying. ${detail}`,
      { cause: error },
    );
  }
  if (isNativeSessionMissing(error)) {
    return new Error(
      `The mapped Kimi Code native session no longer exists. Reset this OpenClaw session to create a fresh native session. ${detail}`,
      { cause: error },
    );
  }
  return new Error(`Kimi Code harness failed: ${detail}`, { cause: error });
}

function readCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const direct = (error as { code?: unknown }).code;
  if (typeof direct === "string") {
    return direct;
  }
  const nested = (error as { error?: unknown }).error;
  if (typeof nested === "object" && nested !== null) {
    const code = (nested as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}
