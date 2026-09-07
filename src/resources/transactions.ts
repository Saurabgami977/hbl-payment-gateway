import type { HttpClient } from '../client.js';
import { HblConfigError } from '../errors.js';
import { normalizeAmount, normalizeCurrency } from '../amount.js';
import { compact, encodeSegment, generateTransactionId } from '../internal.js';
import type { HblAmountOperationParams, HblTransaction, HblVoidParams } from '../types.js';

/**
 * Operations against individual transactions on an order.
 *
 * Every method here moves money, so each one asserts `result === "SUCCESS"`
 * before returning — a declined capture throws rather than resolving.
 *
 * **On idempotency:** MPGS keys on `{orderId, transactionId}`. Reusing an ID
 * makes a retry a no-op; a fresh ID performs a second capture or refund. If
 * you retry after a timeout, pass the ID you used the first time.
 */
export class TransactionsResource {
  constructor(private readonly http: HttpClient) {}

  /** Retrieves a single transaction. Does not throw on a failed transaction. */
  async retrieve(orderId: string, transactionId: string): Promise<HblTransaction> {
    return (await this.http.request({
      method: 'GET',
      path: this.path(orderId, requireId(transactionId, 'transactionId')),
    })) as HblTransaction;
  }

  /**
   * Captures funds previously authorized (`CAPTURE`).
   *
   * @example
   * await hbl.transactions.capture('ord_1024', {
   *   amount: 1500,
   *   currency: 'PKR',
   *   transactionId: 'capture-ord_1024-1', // stable, so a retry is safe
   * });
   */
  async capture(orderId: string, params: HblAmountOperationParams): Promise<HblTransaction> {
    return this.amountOperation('CAPTURE', 'Capturing the payment', orderId, params);
  }

  /**
   * Refunds a captured payment, in full or in part (`REFUND`).
   *
   * @example
   * await hbl.transactions.refund('ord_1024', { amount: 500, currency: 'PKR' });
   */
  async refund(orderId: string, params: HblAmountOperationParams): Promise<HblTransaction> {
    return this.amountOperation('REFUND', 'Refunding the payment', orderId, params);
  }

  /**
   * Voids an authorization or capture before it settles (`VOID`).
   *
   * Once a payment has settled, void is no longer available and a refund is
   * the only route — the gateway will reject the request.
   */
  async void(orderId: string, params: HblVoidParams): Promise<HblTransaction> {
    const transactionId = params.transactionId ?? generateTransactionId();
    const body = {
      apiOperation: 'VOID',
      transaction: { targetTransactionId: requireId(params.targetTransactionId, 'targetTransactionId') },
      ...(params.extra ?? {}),
    };

    const data = this.http.assertSuccess(
      await this.http.request({
        method: 'PUT',
        path: this.path(orderId, transactionId),
        body,
      }),
      'Voiding the transaction'
    );
    return data as HblTransaction;
  }

  private async amountOperation(
    apiOperation: 'CAPTURE' | 'REFUND',
    context: string,
    orderId: string,
    params: HblAmountOperationParams
  ): Promise<HblTransaction> {
    const currency = normalizeCurrency(params.currency);
    const amount = normalizeAmount(params.amount, currency);
    const transactionId = params.transactionId ?? generateTransactionId();

    const body = {
      apiOperation,
      transaction: compact({ amount, currency }),
      ...(params.extra ?? {}),
    };

    const data = this.http.assertSuccess(
      await this.http.request({
        method: 'PUT',
        path: this.path(orderId, transactionId),
        body,
      }),
      context
    );
    return data as HblTransaction;
  }

  private path(orderId: string, transactionId: string): string {
    return `/order/${encodeSegment(requireId(orderId, 'orderId'))}/transaction/${encodeSegment(transactionId)}`;
  }
}

function requireId(value: string, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HblConfigError(`${field} is required.`, field);
  }
  return value.trim();
}
