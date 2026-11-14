const SENSITIVE_KEY = /(?:api[-_ ]?key|access[-_ ]?token|oauth[-_ ]?token|authorization|credential|password|secret|session[-_ ]?token)/i;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const KEY_VALUE = /\b((?:api[-_ ]?key|access[-_ ]?token|oauth[-_ ]?token|authorization|password|secret)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;

export function redactSecrets(value: unknown): unknown {
  if (typeof value === "string") {
    return redactString(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactSecrets);
  }
  if (value instanceof Error) {
    return redactString(value.message);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactSecrets(entry),
      ]),
    );
  }
  return value;
}

export function redactString(value: string): string {
  return value
    .replace(BEARER, "Bearer [REDACTED]")
    .replace(KEY_VALUE, (_match, prefix: string) => `${prefix}[REDACTED]`);
}

export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return redactString(error.message);
  }
  if (typeof error === "string") {
    return redactString(error);
  }
  if (isRecord(error) && typeof error.message === "string") {
    return redactString(error.message);
  }
  return redactString(String(error));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
