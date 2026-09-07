import { vi } from 'vitest';
import { HblGateway } from '../src/index.js';

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface StubResponse {
  status?: number;
  body?: unknown;
  /** Returned verbatim, for testing non-JSON responses. */
  text?: string;
}

/**
 * A `fetch` stub that replays queued responses and records what it was asked.
 * Every test in this suite runs against it — nothing here touches a network.
 */
export function createFetchStub(responses: StubResponse | StubResponse[]) {
  const queue = Array.isArray(responses) ? [...responses] : [responses];
  const calls: RecordedCall[] = [];

  const fetchStub = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const next = queue.length > 1 ? queue.shift()! : queue[0]!;
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });

    const status = next.status ?? 200;
    const payload = next.text ?? JSON.stringify(next.body ?? {});

    return new Response(payload, {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  return { fetchStub, calls };
}

/** A stub that always rejects, standing in for DNS or socket failures. */
export function createFailingFetch(error: Error = new TypeError('fetch failed')) {
  return vi.fn(async () => {
    throw error;
  });
}

export function createGateway(fetchImpl: typeof fetch, overrides = {}) {
  return new HblGateway({
    merchantId: 'TESTMERCHANT',
    apiPassword: 'secret-password',
    merchantName: 'Test Store',
    fetch: fetchImpl,
    maxRetries: 0,
    ...overrides,
  });
}

/** A representative successful INITIATE_CHECKOUT response. */
export const initiateCheckoutSuccess = {
  result: 'SUCCESS',
  session: { id: 'SESSION0002899999999999999999', updateStatus: 'SUCCESS', version: 'abc123' },
  successIndicator: 'e7f3a1b9c2d40000',
  checkoutVersion: '1.0.0',
  merchant: 'TESTMERCHANT',
};

/** A representative captured order. */
export const capturedOrder = {
  id: 'ord_1024',
  result: 'SUCCESS',
  status: 'CAPTURED',
  amount: 1500.0,
  currency: 'PKR',
  totalAuthorizedAmount: 1500.0,
  totalCapturedAmount: 1500.0,
  totalRefundedAmount: 0,
};
