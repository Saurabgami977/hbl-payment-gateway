/**
 * Error hierarchy for the HBL / MPGS gateway.
 *
 * Everything thrown by this package extends {@link HblError}, so a single
 * `catch (e) { if (e instanceof HblError) ... }` is enough to distinguish
 * gateway problems from bugs in your own code.
 */

/** Base class for every error thrown by this package. */
export class HblError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    // Restores the prototype chain when compiled down to ES5.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Configuration or input is invalid — missing credentials, a malformed
 * amount, an unknown currency. Always a programming error on your side, and
 * always thrown before any network call is made.
 */
export class HblConfigError extends HblError {
  /** The offending field, when one can be identified. */
  readonly field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.field = field;
  }
}

/** Raw shape of the `error` object MPGS returns alongside a failure. */
export interface HblApiErrorDetails {
  result?: string;
  errorCause?: string;
  explanation?: string;
  field?: string;
  supportCode?: string;
  validationType?: string;
  httpStatus?: number;
  raw?: unknown;
}

/**
 * The gateway rejected the request.
 *
 * Note that MPGS frequently returns **HTTP 200 with `result: "FAILURE"`**, so
 * this is thrown on the basis of the payload, not the status code.
 */
export class HblApiError extends HblError {
  /** `FAILURE`, `ERROR`, `PENDING` — whatever MPGS put in `result`. */
  readonly result?: string;
  /**
   * MPGS `error.cause`, e.g. `INVALID_REQUEST`, `REQUEST_REJECTED`,
   * `SERVER_BUSY`. Named `errorCause` to avoid colliding with the standard
   * `Error.cause` property.
   */
  readonly errorCause?: string;
  /** Human-readable explanation from the gateway. */
  readonly explanation?: string;
  /** The request field MPGS objected to, if it named one. */
  readonly field?: string;
  /** Quote this to HBL support when raising a ticket. */
  readonly supportCode?: string;
  readonly validationType?: string;
  readonly httpStatus?: number;
  /** The complete parsed response body, for logging or debugging. */
  readonly raw?: unknown;

  constructor(message: string, details: HblApiErrorDetails = {}) {
    super(message);
    this.result = details.result;
    this.errorCause = details.errorCause;
    this.explanation = details.explanation;
    this.field = details.field;
    this.supportCode = details.supportCode;
    this.validationType = details.validationType;
    this.httpStatus = details.httpStatus;
    this.raw = details.raw;
  }
}

/**
 * The payment itself was declined by the acquirer or issuer.
 *
 * Split out from {@link HblApiError} because the handling differs: a decline
 * is the customer's problem and you show them a message; a plain
 * `HblApiError` is your problem and you page someone.
 */
export class HblDeclineError extends HblApiError {
  /** MPGS `response.gatewayCode`, e.g. `DECLINED`, `EXPIRED_CARD`. */
  readonly gatewayCode?: string;
  readonly acquirerCode?: string;
  readonly acquirerMessage?: string;
  /** True when retrying the same payment could plausibly succeed. */
  readonly isRetryable: boolean;

  constructor(
    message: string,
    details: HblApiErrorDetails & {
      gatewayCode?: string;
      acquirerCode?: string;
      acquirerMessage?: string;
    } = {}
  ) {
    super(message, details);
    this.gatewayCode = details.gatewayCode;
    this.acquirerCode = details.acquirerCode;
    this.acquirerMessage = details.acquirerMessage;
    this.isRetryable = isRetryableGatewayCode(details.gatewayCode);
  }
}

/** The request never got a usable answer: DNS, TLS, socket or timeout. */
export class HblNetworkError extends HblError {
  override readonly cause?: unknown;
  /** True when the request was aborted by the configured timeout. */
  readonly isTimeout: boolean;

  constructor(message: string, cause?: unknown, isTimeout = false) {
    super(message);
    this.cause = cause;
    this.isTimeout = isTimeout;
  }
}

/** Why a {@link HblVerificationError} was raised. */
export type HblVerificationFailureReason =
  | 'indicator_mismatch'
  | 'missing_indicator'
  | 'gateway_not_paid'
  | 'amount_mismatch'
  | 'currency_mismatch';

/**
 * The return from the hosted checkout page could not be trusted.
 *
 * This is thrown rather than returned so that a forgotten `if` cannot let an
 * unpaid order through.
 */
export class HblVerificationError extends HblError {
  readonly reason: HblVerificationFailureReason;
  /** The order as the gateway reports it, when it was retrieved. */
  readonly order?: unknown;

  constructor(message: string, reason: HblVerificationFailureReason, order?: unknown) {
    super(message);
    this.reason = reason;
    this.order = order;
  }
}

/**
 * Gateway codes worth retrying: transient infrastructure trouble rather than
 * a decision about the card.
 */
const RETRYABLE_GATEWAY_CODES = new Set([
  'TIMED_OUT',
  'ACQUIRER_SYSTEM_ERROR',
  'SYSTEM_ERROR',
  'UNSPECIFIED_FAILURE',
  'UNKNOWN',
  'SUBMITTED',
  'PENDING',
]);

export function isRetryableGatewayCode(code?: string): boolean {
  return code ? RETRYABLE_GATEWAY_CODES.has(code) : false;
}

/**
 * Customer-facing wording for the gateway codes merchants actually see.
 *
 * Deliberately vague about *why* a card was declined: issuers do not tell the
 * merchant, and guessing out loud ("insufficient funds") in the checkout UI
 * is both often wrong and occasionally embarrassing in front of other people.
 */
export const GATEWAY_CODE_MESSAGES: Record<string, string> = {
  APPROVED: 'Payment approved.',
  APPROVED_AUTO: 'Payment approved.',
  APPROVED_PENDING_SETTLEMENT: 'Payment approved and awaiting settlement.',
  PENDING: 'Payment is still being processed.',
  SUBMITTED: 'Payment has been submitted and is being processed.',
  DECLINED: 'The payment was declined. Please try another card or contact your bank.',
  DECLINED_DO_NOT_CONTACT:
    'The payment was declined. Please contact your bank or use another card.',
  DECLINED_AVS: 'The payment was declined because the billing address did not match.',
  DECLINED_CSC: 'The payment was declined because the security code was incorrect.',
  DECLINED_AVS_CSC:
    'The payment was declined because the billing address and security code did not match.',
  DECLINED_PAYMENT_PLAN: 'The selected payment plan was declined.',
  EXPIRED_CARD: 'The card has expired. Please use a different card.',
  INVALID_CSC: 'The security code entered was not valid.',
  INSUFFICIENT_FUNDS: 'The payment was declined. Please try another card.',
  TIMED_OUT: 'The bank did not respond in time. Please try again.',
  ACQUIRER_SYSTEM_ERROR: 'The bank reported a temporary problem. Please try again shortly.',
  SYSTEM_ERROR: 'A temporary problem occurred. Please try again shortly.',
  NOT_SUPPORTED: 'This card type is not supported for this payment.',
  ABORTED: 'The payment was cancelled.',
  CANCELLED: 'The payment was cancelled.',
  BLOCKED: 'The payment was blocked by a risk rule.',
  REFERRED: 'The payment needs authorisation from the issuing bank.',
  AUTHENTICATION_FAILED: 'Card authentication failed. Please try again.',
  UNSPECIFIED_FAILURE: 'The payment could not be processed. Please try again.',
  UNKNOWN: 'The payment status could not be determined. Please contact support.',
};

/**
 * Turns a `gatewayCode` into wording safe to show a customer, falling back to
 * a generic message for codes not in the table.
 */
export function describeGatewayCode(code?: string): string {
  if (!code) return GATEWAY_CODE_MESSAGES.UNSPECIFIED_FAILURE;
  return GATEWAY_CODE_MESSAGES[code] ?? GATEWAY_CODE_MESSAGES.UNSPECIFIED_FAILURE;
}
