import type { ResolvedHblConfig } from './config.js';
import {
  HblApiError,
  HblDeclineError,
  HblNetworkError,
  type HblApiErrorDetails,
} from './errors.js';
import type { HblErrorPayload, HblResponsePayload } from './types.js';

export interface HblRequestOptions {
  method: 'GET' | 'POST' | 'PUT';
  /** Path below the merchant base URL, e.g. `/order/abc123`. */
  path: string;
  body?: unknown;
  /** Retry network errors and 5xx. Defaults to true for GET only. */
  idempotent?: boolean;
}

type Json = Record<string, unknown>;

/** Gateway codes that indicate success rather than a decline. */
const SUCCESSFUL_GATEWAY_CODES = new Set([
  'APPROVED',
  'APPROVED_AUTO',
  'APPROVED_PENDING_SETTLEMENT',
  'VERIFIED',
]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Transport for the MPGS REST API: authentication, timeouts, retries and the
 * mapping of gateway payloads onto this package's error types.
 *
 * `request` throws on transport and HTTP-level failures only. Deciding whether
 * a 200 response with `result: "FAILURE"` is an error belongs to the caller,
 * because retrieving an order whose last transaction failed is a perfectly
 * successful retrieval — see {@link HttpClient.assertSuccess}.
 */
export class HttpClient {
  constructor(private readonly config: ResolvedHblConfig) {}

  async request<T extends Json = Json>(options: HblRequestOptions): Promise<T> {
    const { method, path, body } = options;
    const idempotent = options.idempotent ?? method === 'GET';
    const url = `${this.config.baseUrl}${path}`;
    const maxAttempts = idempotent ? this.config.maxRetries + 1 : 1;

    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        // 200ms, 400ms, 800ms … enough to ride out a gateway blip without
        // holding a checkout request open for an uncomfortable length of time.
        await sleep(200 * 2 ** (attempt - 1));
      }

      try {
        return await this.attempt<T>(method, url, body);
      } catch (error) {
        lastError = error;
        if (!this.isRetryable(error) || attempt === maxAttempts - 1) throw error;
      }
    }

    throw lastError;
  }

  private isRetryable(error: unknown): boolean {
    if (error instanceof HblNetworkError) return true;
    if (error instanceof HblApiError) {
      return error.httpStatus !== undefined && error.httpStatus >= 500;
    }
    return false;
  }

  private async attempt<T extends Json>(method: string, url: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: this.config.authHeader,
      Accept: 'application/json',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    this.config.onRequest?.({
      method,
      url,
      headers: { ...headers, Authorization: 'Basic [REDACTED]' },
      body,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const startedAt = Date.now();

    let response: Response;
    try {
      response = await this.config.fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      const isTimeout =
        controller.signal.aborted ||
        (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'));
      throw new HblNetworkError(
        isTimeout
          ? `Request to the HBL gateway timed out after ${this.config.timeoutMs}ms: ${method} ${url}`
          : `Could not reach the HBL gateway: ${method} ${url}`,
        error,
        isTimeout
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    let data: Json = {};
    let parsed = false;
    try {
      data = text ? (JSON.parse(text) as Json) : {};
      parsed = true;
    } catch {
      // Gateways behind a misconfigured proxy answer with HTML. Keep `text`
      // for the error message rather than throwing a bare SyntaxError.
    }

    this.config.onResponse?.({
      method,
      url,
      status: response.status,
      durationMs: Date.now() - startedAt,
      body: parsed ? data : text,
    });

    if (!response.ok) {
      throw buildApiError(
        `HBL gateway returned HTTP ${response.status} for ${method} ${url}`,
        data,
        response.status,
        parsed ? undefined : text
      );
    }

    if (!parsed) {
      throw new HblApiError(
        `HBL gateway returned a non-JSON response for ${method} ${url}: ${truncate(text)}`,
        { httpStatus: response.status, raw: text }
      );
    }

    return data as T;
  }

  /**
   * Enforces `result === "SUCCESS"` on operations that move money.
   *
   * MPGS answers `HTTP 200` with `{"result":"FAILURE"}` for declines, so code
   * that only checks the status line treats a declined card as a paid order.
   */
  assertSuccess<T extends Json>(data: T, context: string): T {
    const result = typeof data.result === 'string' ? data.result : undefined;
    if (result === undefined || result === 'SUCCESS') return data;
    throw buildApiError(`${context} failed: ${describeFailure(data)}`, data, 200);
  }
}

function truncate(value: string, max = 300): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function describeFailure(data: Json): string {
  const error = (data.error ?? {}) as HblErrorPayload;
  const response = (data.response ?? {}) as HblResponsePayload;
  return (
    error.explanation ??
    response.acquirerMessage ??
    response.gatewayCode ??
    error.cause ??
    (typeof data.result === 'string' ? data.result : undefined) ??
    'the gateway gave no explanation'
  );
}

/** Chooses between a decline and a plain API error, and copies the details across. */
function buildApiError(
  message: string,
  data: Json,
  httpStatus: number,
  rawText?: string
): HblApiError {
  const error = (data.error ?? {}) as HblErrorPayload;
  const response = (data.response ?? {}) as HblResponsePayload;

  const details: HblApiErrorDetails = {
    result: typeof data.result === 'string' ? data.result : undefined,
    errorCause: error.cause,
    explanation: error.explanation,
    field: error.field,
    supportCode: error.supportCode,
    validationType: error.validationType,
    httpStatus,
    raw: rawText ?? data,
  };

  const gatewayCode = response.gatewayCode;
  if (gatewayCode && !SUCCESSFUL_GATEWAY_CODES.has(gatewayCode)) {
    return new HblDeclineError(message, {
      ...details,
      gatewayCode,
      acquirerCode: response.acquirerCode,
      acquirerMessage: response.acquirerMessage,
    });
  }

  return new HblApiError(message, details);
}
