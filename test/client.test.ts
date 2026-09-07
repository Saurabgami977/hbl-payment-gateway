import { describe, expect, it, vi } from 'vitest';
import { capturedOrder, createFetchStub, createGateway } from './helpers.js';
import { HblNetworkError } from '../src/errors.js';

describe('retries', () => {
  it('retries GET requests on a 5xx and then succeeds', async () => {
    const { fetchStub, calls } = createFetchStub([
      { status: 503, body: { error: { cause: 'SERVER_BUSY' } } },
      { status: 200, body: capturedOrder },
    ]);
    const hbl = createGateway(fetchStub as unknown as typeof fetch, { maxRetries: 1 });

    await expect(hbl.orders.retrieve('ord_1024')).resolves.toMatchObject({ status: 'CAPTURED' });
    expect(calls).toHaveLength(2);
  });

  it('does not retry a capture, because a repeat could charge twice', async () => {
    const failing = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const hbl = createGateway(failing as unknown as typeof fetch, { maxRetries: 3 });

    await expect(
      hbl.transactions.capture('ord_1024', { amount: 1, currency: 'NPR' })
    ).rejects.toBeInstanceOf(HblNetworkError);
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it('gives up after maxRetries', async () => {
    const { fetchStub, calls } = createFetchStub({ status: 500, body: {} });
    const hbl = createGateway(fetchStub as unknown as typeof fetch, { maxRetries: 2 });

    await expect(hbl.orders.retrieve('ord_1024')).rejects.toMatchObject({ httpStatus: 500 });
    expect(calls).toHaveLength(3);
  });

  it('does not retry a 4xx', async () => {
    const { fetchStub, calls } = createFetchStub({ status: 400, body: {} });
    const hbl = createGateway(fetchStub as unknown as typeof fetch, { maxRetries: 2 });

    await expect(hbl.orders.retrieve('ord_1024')).rejects.toMatchObject({ httpStatus: 400 });
    expect(calls).toHaveLength(1);
  });
});

describe('timeouts', () => {
  it('aborts a slow request and reports it as a timeout', async () => {
    const slowFetch = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          });
        })
    );
    const hbl = createGateway(slowFetch as unknown as typeof fetch, { timeoutMs: 20, maxRetries: 0 });

    const error = await hbl.orders.retrieve('ord_1024').catch((e) => e);
    expect(error).toBeInstanceOf(HblNetworkError);
    expect(error.isTimeout).toBe(true);
  });
});

describe('observability hooks', () => {
  it('reports status and duration to onResponse', async () => {
    const { fetchStub } = createFetchStub({ body: capturedOrder });
    const onResponse = vi.fn();
    const hbl = createGateway(fetchStub as unknown as typeof fetch, { onResponse });

    await hbl.orders.retrieve('ord_1024');

    expect(onResponse).toHaveBeenCalledWith(
      expect.objectContaining({ status: 200, method: 'GET' })
    );
    expect(onResponse.mock.calls[0]![0].durationMs).toBeGreaterThanOrEqual(0);
  });
});
