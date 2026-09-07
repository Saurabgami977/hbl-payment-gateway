import type { HttpClient } from '../client.js';
import type { ResolvedHblConfig } from '../config.js';
import { HblConfigError, HblVerificationError } from '../errors.js';
import { amountsEqual, normalizeAmount, normalizeCurrency } from '../amount.js';
import { compact, encodeSegment, timingSafeEqual } from '../internal.js';
import type {
  HblOrder,
  InitiateCheckoutParams,
  InitiateCheckoutResult,
  VerifyCheckoutParams,
  VerifyCheckoutResult,
} from '../types.js';

/** Order statuses treated as paid when none are supplied explicitly. */
const DEFAULT_ACCEPTED_STATUSES = ['CAPTURED', 'PAID', 'AUTHORIZED', 'PARTIALLY_CAPTURED'];

/** Hosted Checkout: start a payment, then verify the customer's return. */
export class CheckoutResource {
  constructor(
    private readonly http: HttpClient,
    private readonly config: ResolvedHblConfig
  ) {}

  /**
   * Creates a hosted checkout session (`INITIATE_CHECKOUT`).
   *
   * Persist the returned `successIndicator` against your order **before**
   * redirecting the customer — without it you cannot verify their return.
   *
   * @example
   * const session = await hbl.checkout.initiate({
   *   orderId: 'ord_1024',
   *   amount: 1500,
   *   currency: 'PKR',
   *   description: 'Starter plan — 1 month',
   *   returnUrl: 'https://example.com/checkout/result',
   * });
   */
  async initiate(params: InitiateCheckoutParams): Promise<InitiateCheckoutResult> {
    const orderId = requireOrderId(params.orderId);
    const currency = normalizeCurrency(params.currency);
    const amount = normalizeAmount(params.amount, currency);

    if (!params.returnUrl || typeof params.returnUrl !== 'string') {
      throw new HblConfigError('returnUrl is required to initiate a hosted checkout.', 'returnUrl');
    }

    const merchantName = params.merchantName ?? this.config.merchantName;

    const body = {
      apiOperation: 'INITIATE_CHECKOUT',
      checkoutMode: 'WEBSITE',
      interaction: compact({
        operation: params.operation ?? 'PURCHASE',
        returnUrl: params.returnUrl,
        cancelUrl: params.cancelUrl,
        timeoutUrl: params.timeoutUrl,
        timeout: params.timeoutSeconds,
        merchant: compact({ name: merchantName, logo: params.merchantLogo }),
      }),
      order: compact({
        id: orderId,
        amount,
        currency,
        description: params.description,
      }),
      ...compact({ customer: params.customer, billing: params.billing }),
      ...(params.extra ?? {}),
    };

    const data = this.http.assertSuccess(
      await this.http.request({ method: 'POST', path: '/session', body }),
      'Creating the hosted checkout session'
    );

    const session = (data.session ?? {}) as { id?: string };
    if (!session.id) {
      throw new HblConfigError('The gateway did not return a session ID for this checkout.');
    }

    return {
      sessionId: session.id,
      successIndicator: typeof data.successIndicator === 'string' ? data.successIndicator : '',
      checkoutVersion: typeof data.checkoutVersion === 'string' ? data.checkoutVersion : '100',
      checkoutJsUrl: this.config.checkoutJsUrl,
      merchantId: this.config.merchantId,
      host: this.config.host,
      raw: data,
    };
  }

  /**
   * Verifies that a customer returning from the hosted page really did pay.
   *
   * Two independent checks run, and both must pass:
   *
   * 1. The `resultIndicator` in the redirect matches the `successIndicator`
   *    stored at initiate time, compared in constant time.
   * 2. The order, re-read from the gateway over an authenticated channel,
   *    reports a paid status — and, when `expectedAmount` is supplied, the
   *    amount and currency the customer was actually charged.
   *
   * The second check is not optional and there is no flag to skip it. A
   * redirect URL is attacker-controlled: anyone can paste
   * `?resultIndicator=…` into the address bar, so the query string alone can
   * never be evidence of payment.
   *
   * @throws {HblVerificationError} when any check fails.
   */
  async verify(params: VerifyCheckoutParams): Promise<VerifyCheckoutResult> {
    const orderId = requireOrderId(params.orderId);
    const { resultIndicator, successIndicator } = params;

    if (!resultIndicator || !successIndicator) {
      throw new HblVerificationError(
        'Cannot verify the payment: the result indicator or the stored success indicator is missing.',
        'missing_indicator'
      );
    }

    if (!timingSafeEqual(resultIndicator, successIndicator)) {
      throw new HblVerificationError(
        'Cannot verify the payment: the result indicator does not match the stored success indicator.',
        'indicator_mismatch'
      );
    }

    const order = (await this.http.request({
      method: 'GET',
      path: `/order/${encodeSegment(orderId)}`,
    })) as HblOrder;

    const accepted = params.acceptedStatuses ?? DEFAULT_ACCEPTED_STATUSES;
    const status = order.status ?? 'UNKNOWN';

    if (!accepted.includes(status)) {
      throw new HblVerificationError(
        `Cannot verify the payment: the gateway reports order ${orderId} as ${status}.`,
        'gateway_not_paid',
        order
      );
    }

    if (params.expectedAmount !== undefined) {
      const expectedCurrency = params.expectedCurrency ?? order.currency;
      if (!expectedCurrency) {
        throw new HblConfigError(
          'expectedCurrency is required when expectedAmount is given.',
          'expectedCurrency'
        );
      }
      const currency = normalizeCurrency(expectedCurrency);

      if (order.currency && normalizeCurrency(order.currency) !== currency) {
        throw new HblVerificationError(
          `Currency mismatch on order ${orderId}: expected ${currency}, gateway reports ${order.currency}.`,
          'currency_mismatch',
          order
        );
      }

      const charged = order.totalCapturedAmount ?? order.totalAuthorizedAmount ?? order.amount;
      if (charged === undefined || !amountsEqual(charged, params.expectedAmount, currency)) {
        throw new HblVerificationError(
          `Amount mismatch on order ${orderId}: expected ${normalizeAmount(params.expectedAmount, currency)} ${currency}, gateway reports ${charged ?? 'nothing'}.`,
          'amount_mismatch',
          order
        );
      }
    }

    return {
      paid: true,
      status,
      amount: order.totalCapturedAmount ?? order.totalAuthorizedAmount ?? order.amount,
      currency: order.currency,
      order,
    };
  }
}

function requireOrderId(orderId: string): string {
  if (typeof orderId !== 'string' || orderId.trim() === '') {
    throw new HblConfigError('orderId is required.', 'orderId');
  }
  return orderId.trim();
}
