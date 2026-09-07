import { HttpClient } from './client.js';
import {
  configFromEnv,
  resolveConfig,
  type HblConfig,
  type HblEnvLike,
  type ResolvedHblConfig,
} from './config.js';
import { CheckoutResource } from './resources/checkout.js';
import { OrdersResource } from './resources/orders.js';
import { SessionsResource } from './resources/sessions.js';
import { TransactionsResource } from './resources/transactions.js';

/**
 * Client for the HBL Internet Payment Gateway (Mastercard Payment Gateway
 * Services v100).
 *
 * @example
 * import { HblGateway } from 'hbl-payment-gateway';
 *
 * const hbl = new HblGateway({
 *   merchantId: process.env.HBL_MERCHANT_ID!,
 *   apiPassword: process.env.HBL_API_PASSWORD!,
 *   merchantName: 'Acme Store',
 * });
 *
 * const session = await hbl.checkout.initiate({
 *   orderId: 'ord_1024',
 *   amount: 1500,
 *   currency: 'PKR',
 *   returnUrl: 'https://acme.example/checkout/result',
 * });
 */
export class HblGateway {
  /** Hosted Checkout: start a payment and verify the customer's return. */
  readonly checkout: CheckoutResource;
  /** Read orders back from the gateway. */
  readonly orders: OrdersResource;
  /** Capture, refund and void. */
  readonly transactions: TransactionsResource;
  /** Read hosted checkout sessions. */
  readonly sessions: SessionsResource;

  private readonly config: ResolvedHblConfig;

  constructor(config: HblConfig) {
    this.config = resolveConfig(config);
    const http = new HttpClient(this.config);

    this.checkout = new CheckoutResource(http, this.config);
    this.orders = new OrdersResource(http);
    this.transactions = new TransactionsResource(http);
    this.sessions = new SessionsResource(http);
  }

  /**
   * Builds a client from `HBL_MERCHANT_ID`, `HBL_API_PASSWORD` and optionally
   * `HBL_GATEWAY_HOST` / `HBL_MERCHANT_NAME`.
   *
   * @throws {HblConfigError} naming the variables that are missing.
   */
  static fromEnv(overrides: Partial<HblConfig> = {}, env?: HblEnvLike): HblGateway {
    return new HblGateway(configFromEnv(env, overrides));
  }

  /** Gateway hostname in use. */
  get host(): string {
    return this.config.host;
  }

  /** Merchant ID in use. Safe to expose to the browser. */
  get merchantId(): string {
    return this.config.merchantId;
  }

  /** URL of `checkout.min.js` for this host. Safe to expose to the browser. */
  get checkoutJsUrl(): string {
    return this.config.checkoutJsUrl;
  }

  /**
   * Redacted representation, so an accidental `console.log(hbl)` or
   * `JSON.stringify(hbl)` can never spill the API password into your logs.
   */
  toJSON(): Record<string, unknown> {
    return {
      host: this.config.host,
      merchantId: this.config.merchantId,
      apiVersion: this.config.apiVersion,
      apiPassword: '[REDACTED]',
    };
  }
}

export {
  configFromEnv,
  resolveConfig,
  DEFAULT_API_VERSION,
  DEFAULT_HBL_HOST,
  type HblConfig,
  type HblEnvLike,
  type HblRequestInfo,
  type HblResponseInfo,
  type ResolvedHblConfig,
} from './config.js';

export {
  describeGatewayCode,
  isRetryableGatewayCode,
  GATEWAY_CODE_MESSAGES,
  HblApiError,
  HblConfigError,
  HblDeclineError,
  HblError,
  HblNetworkError,
  HblVerificationError,
  type HblApiErrorDetails,
  type HblVerificationFailureReason,
} from './errors.js';

export { amountsEqual, minorUnits, normalizeAmount, normalizeCurrency } from './amount.js';

export { CheckoutResource } from './resources/checkout.js';
export { OrdersResource } from './resources/orders.js';
export { SessionsResource } from './resources/sessions.js';
export { TransactionsResource } from './resources/transactions.js';

export type * from './types.js';
