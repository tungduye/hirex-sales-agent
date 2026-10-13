// Shared access to the OpenAI Responses API.
//
// Every server module that calls OpenAI goes through postOpenAIResponse so that the
// endpoint, authentication header and `store: false` are set in one place. Callers keep
// their own model choice, prompts, schemas, timeouts and error handling.
//
// Callers are server-only; this module stays free of "server-only" so it can be unit-tested.

export const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

export interface OpenAIResponseRequest {
  apiKey: string;
  /** Request body for POST /v1/responses. `store` is always forced to false. */
  body: Record<string, unknown>;
  /** Abort after this many milliseconds. Omit for no client-side timeout. */
  timeoutMs?: number;
  redirect?: RequestRedirect;
  cache?: RequestCache;
  fetchImpl?: typeof fetch;
}

export function postOpenAIResponse({
  apiKey,
  body,
  timeoutMs,
  redirect,
  cache,
  fetchImpl = fetch,
}: OpenAIResponseRequest): Promise<Response> {
  const init: RequestInit = {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    // HireX never asks OpenAI to keep request/response objects for later retrieval.
    body: JSON.stringify({ ...body, store: false }),
  };
  if (timeoutMs !== undefined) init.signal = AbortSignal.timeout(timeoutMs);
  if (redirect !== undefined) init.redirect = redirect;
  if (cache !== undefined) init.cache = cache;
  return fetchImpl(OPENAI_RESPONSES_URL, init);
}

export interface OutputTextOptions {
  /** Only take content parts whose `type` is "output_text" (default true). */
  onlyOutputText?: boolean;
  /** String placed between text parts (default ""). */
  separator?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Concatenates the text parts of a Responses API payload, in order. Returns "" when the
 * payload has no usable text. Callers decide whether to trim, cap or reject the result.
 */
export function responseOutputText(payload: unknown, { onlyOutputText = true, separator = "" }: OutputTextOptions = {}): string {
  if (!isRecord(payload) || !Array.isArray(payload.output)) return "";
  const texts: string[] = [];
  for (const item of payload.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (!isRecord(part) || typeof part.text !== "string") continue;
      if (onlyOutputText && part.type !== "output_text") continue;
      texts.push(part.text);
    }
  }
  return texts.join(separator);
}
