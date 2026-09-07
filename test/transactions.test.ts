import { describe, expect, it } from 'vitest';
import { capturedOrder, createFetchStub, createGateway } from './helpers.js';
import { HblApiError, HblConfigError } from '../src/errors.js';

const captureSuccess = {
  result: 'SUCCESS',
  response: { gatewayCode: 'APPROVED' },
  transaction: { id: 'capture-1', type: 'CAPTURE', amount: 1500, currency: 'NPR' },
  order: capturedOrder,
};

describe('transactions.capture', () => {
  it('PUTs a CAPTURE to the transaction URL', async () => {
    const { fetchStub, calls } = createFetchStub({ body: captureSuccess });
    const hbl = createGateway(fetchStub as unknown as typeof fetch);

    await hbl.transactions.capture('ord_1024', {
      amount: 1500,
      currency: 'NPR',
      transactionId: 'capture-1',
    });

    expect(calls[0]!.method).toBe('PUT');
    expect(calls[0]!.url).toContain('/order/ord_1024/transaction/capture-1');
    expect(calls[0]!.body).toEqual({
      apiOperation: 'CAPTURE',
      transaction: { amount: '1500.00', currency: 'NPR' },
    });
  });

  it('generates a transaction ID when none is given', async () => {
    const { fetchStub, calls } = createFetchStub({ body: captureSuccess });
    const hbl = createGateway(fetchStub as unknown as typeof fetch);

    await hbl.transactions.capture('ord_1024', { amount: 1500, currency: 'NPR' });

    const generated = calls[0]!.url.split('/transaction/')[1]!;
    expect(generated).toMatch(/^[0-9a-f]{20,}$/);
  });

  it('throws on a declined capture rather than resolving', async () => {
    const { fetchStub } = createFetchStub({
      status: 200,
      body: { result: 'FAILURE', response: { gatewayCode: 'DECLINED' } },
    });
    const hbl = createGateway(fetchStub as unknown as typeof fetch);

    await expect(
      hbl.transactions.capture('ord_1024', { amount: 1500, currency: 'NPR' })
    ).rejects.toBeInstanceOf(HblApiError);
  });
});

describe('transactions.refund', () => {
  it('PUTs a REFUND with a partial amount', async () => {
    const { fetchStub, calls } = createFetchStub({
      body: { ...captureSuccess, transaction: { id: 'refund-1', type: 'REFUND' } },
    });
    const hbl = createGateway(fetchStub as unknown as typeof fetch);

    await hbl.transactions.refund('ord_1024', {
      amount: '500',
      currency: 'NPR',
      transactionId: 'refund-1',
    });

    expect(calls[0]!.body).toEqual({
      apiOperation: 'REFUND',
      transaction: { amount: '500.00', currency: 'NPR' },
    });
  });
});

describe('transactions.void', () => {
  it('PUTs a VOID naming the target transaction', async () => {
    const { fetchStub, calls } = createFetchStub({ body: { result: 'SUCCESS' } });
    const hbl = createGateway(fetchStub as unknown as typeof fetch);

    await hbl.transactions.void('ord_1024', {
      targetTransactionId: 'auth-1',
      transactionId: 'void-1',
    });

    expect(calls[0]!.body).toEqual({
      apiOperation: 'VOID',
      transaction: { targetTransactionId: 'auth-1' },
    });
  });

  it('requires a target transaction', async () => {
    const { fetchStub } = createFetchStub({ body: { result: 'SUCCESS' } });
    const hbl = createGateway(fetchStub as unknown as typeof fetch);
    await expect(
      hbl.transactions.void('ord_1024', { targetTransactionId: '' })
    ).rejects.toBeInstanceOf(HblConfigError);
  });
});

describe('transactions.retrieve', () => {
  it('does not throw for a transaction that failed', async () => {
    // Reading back a declined transaction is a successful read.
    const { fetchStub } = createFetchStub({
      body: { result: 'FAILURE', response: { gatewayCode: 'DECLINED' } },
    });
    const hbl = createGateway(fetchStub as unknown as typeof fetch);

    await expect(hbl.transactions.retrieve('ord_1024', 'txn-1')).resolves.toMatchObject({
      result: 'FAILURE',
    });
  });
});

describe('path building', () => {
  it('encodes IDs so they cannot escape the URL structure', async () => {
    const { fetchStub, calls } = createFetchStub({ body: capturedOrder });
    const hbl = createGateway(fetchStub as unknown as typeof fetch);

    await hbl.orders.retrieve('ord/../../admin');

    expect(calls[0]!.url).toContain('/order/ord%2F..%2F..%2Fadmin');
    expect(calls[0]!.url).not.toContain('/admin');
  });
});
