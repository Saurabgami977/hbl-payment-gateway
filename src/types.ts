/**
 * Types describing the slices of the MPGS v100 API this package uses.
 *
 * The gateway returns a great deal more than is modelled here; every response
 * type therefore carries an index signature, and the untouched payload is
 * always available on `raw`.
 */

/** Top-level outcome MPGS reports for an operation. */
export type HblResult = 'SUCCESS' | 'FAILURE' | 'PENDING' | 'ERROR' | (string & {});

/** Lifecycle status of an order. */
export type HblOrderStatus =
  | 'CAPTURED'
  | 'AUTHORIZED'
  | 'PARTIALLY_CAPTURED'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED'
  | 'CANCELLED'
  | 'FAILED'
  | 'DISBURSED'
  | 'VERIFIED'
  | 'PAID'
  | (string & {});

/** What the hosted checkout page should do once the customer pays. */
export type HblCheckoutOperation = 'PURCHASE' | 'AUTHORIZE' | 'VERIFY';

export interface HblErrorPayload {
  cause?: string;
  explanation?: string;
  field?: string;
  supportCode?: string;
  validationType?: string;
}

export interface HblResponsePayload {
  gatewayCode?: string;
  acquirerCode?: string;
  acquirerMessage?: string;
  [key: string]: unknown;
}

export interface HblCustomer {
  email?: string;
  firstName?: string;
  lastName?: string;
  mobilePhone?: string;
  phone?: string;
  [key: string]: unknown;
}

export interface HblAddress {
  street?: string;
  street2?: string;
  city?: string;
  stateProvince?: string;
  postcodeZip?: string;
  country?: string;
  [key: string]: unknown;
}

export interface HblBilling {
  address?: HblAddress;
  [key: string]: unknown;
}

/** Parameters for {@link CheckoutResource.initiate}. */
export interface InitiateCheckoutParams {
  /**
   * Your reference for this order, unique per merchant. Persist it — you need
   * it to verify, capture or refund later.
   */
  orderId: string;
  /** Accepts a number or string; validated against the currency's minor unit. */
  amount: number | string;
  /** ISO 4217 code, e.g. `NPR`. */
  currency: string;
  /** Shown to the customer on the hosted page and on their statement. */
  description?: string;
  /** Where HBL sends the customer after payment, with `?resultIndicator=…`. */
  returnUrl: string;
  /** @default 'PURCHASE' */
  operation?: HblCheckoutOperation;
  /** Overrides the merchant name from the client config. */
  merchantName?: string;
  /** Merchant logo URL shown on the hosted page. */
  merchantLogo?: string;
  /** Where to send the customer if they abandon the payment. */
  cancelUrl?: string;
  /** Where to send the customer if the hosted session times out. */
  timeoutUrl?: string;
  /** Seconds the hosted checkout session stays valid. */
  timeoutSeconds?: number;
  /** Pre-fills the customer's details on the hosted page. */
  customer?: HblCustomer;
  billing?: HblBilling;
  /**
   * Merged into the request body verbatim, for MPGS fields this package does
   * not model. Use sparingly.
   */
  extra?: Record<string, unknown>;
}

/** Result of {@link CheckoutResource.initiate}. */
export interface InitiateCheckoutResult {
  /** Pass to the browser; safe to expose to the client. */
  sessionId: string;
  /**
   * Store server-side and keep secret. Verifying the return means comparing
   * this against the `resultIndicator` in the redirect.
   */
  successIndicator: string;
  checkoutVersion: string;
  /** URL of `checkout.min.js` for this host — hand it to the browser. */
  checkoutJsUrl: string;
  /** Your merchant ID, for convenience when returning JSON to the client. */
  merchantId: string;
  /** Gateway hostname. */
  host: string;
  raw: Record<string, unknown>;
}

export interface HblTransactionSummary {
  transaction?: {
    id?: string;
    type?: string;
    amount?: number;
    currency?: string;
    authorizationCode?: string;
    [key: string]: unknown;
  };
  result?: HblResult;
  response?: HblResponsePayload;
  timeOfRecord?: string;
  [key: string]: unknown;
}

/** An order as returned by `GET /order/{orderId}`. */
export interface HblOrder {
  id?: string;
  result?: HblResult;
  status?: HblOrderStatus;
  amount?: number;
  currency?: string;
  description?: string;
  totalAuthorizedAmount?: number;
  totalCapturedAmount?: number;
  totalRefundedAmount?: number;
  creationTime?: string;
  lastUpdatedTime?: string;
  transaction?: HblTransactionSummary[];
  [key: string]: unknown;
}

/** A transaction as returned by `GET /order/{orderId}/transaction/{id}`. */
export interface HblTransaction {
  result?: HblResult;
  response?: HblResponsePayload;
  order?: HblOrder;
  transaction?: HblTransactionSummary['transaction'];
  timeOfRecord?: string;
  [key: string]: unknown;
}

/** A session as returned by `GET /session/{sessionId}`. */
export interface HblSession {
  result?: HblResult;
  session?: {
    id?: string;
    updateStatus?: string;
    version?: string;
    aes256Key?: string;
    [key: string]: unknown;
  };
  order?: HblOrder;
  [key: string]: unknown;
}

/** Parameters for capture and refund. */
export interface HblAmountOperationParams {
  amount: number | string;
  currency: string;
  /**
   * MPGS deduplicates on `{orderId, transactionId}`, so reusing an ID makes a
   * retry safe and a fresh ID charges again. Generated when omitted.
   */
  transactionId?: string;
  extra?: Record<string, unknown>;
}

/** Parameters for {@link TransactionsResource.void}. */
export interface HblVoidParams {
  /** The transaction being voided — usually the authorization. */
  targetTransactionId: string;
  transactionId?: string;
  extra?: Record<string, unknown>;
}

/** Parameters for {@link CheckoutResource.verify}. */
export interface VerifyCheckoutParams {
  /** The order ID you sent to {@link CheckoutResource.initiate}. */
  orderId: string;
  /** The `resultIndicator` query parameter from the redirect. */
  resultIndicator: string | null | undefined;
  /** The `successIndicator` you stored at initiate time. */
  successIndicator: string | null | undefined;
  /** When given, the gateway's amount must match. Strongly recommended. */
  expectedAmount?: number | string;
  /** Required alongside `expectedAmount`. */
  expectedCurrency?: string;
  /**
   * Order statuses accepted as paid.
   * @default ['CAPTURED', 'PAID', 'AUTHORIZED', 'PARTIALLY_CAPTURED']
   */
  acceptedStatuses?: string[];
}

/** Result of a successful {@link CheckoutResource.verify}. */
export interface VerifyCheckoutResult {
  /** Always `true` — verification throws rather than returning `false`. */
  paid: true;
  status: HblOrderStatus;
  amount?: number;
  currency?: string;
  order: HblOrder;
}
