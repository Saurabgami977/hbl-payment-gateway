import { HblConfigError } from './errors.js';

/**
 * MPGS's Asia-Pacific gateway, which is what Himalayan Bank merchants are
 * provisioned on. Used when `host` is omitted. Confirm your host with HBL —
 * some merchants are issued a different one, and a merchant provisioned on one
 * MPGS host will not authenticate against another.
 */
export const DEFAULT_HBL_HOST = 'ap-gateway.mastercard.com';

/** MPGS API version this package targets. */
export const DEFAULT_API_VERSION = 100;

/** Details of an outgoing request, handed to the `onRequest` hook. */
export interface HblRequestInfo {
  method: string;
  url: string;
  /** `Authorization` is already redacted. Safe to log as-is. */
  headers: Record<string, string>;
  body?: unknown;
}

/** Details of a response, handed to the `onResponse` hook. */
export interface HblResponseInfo {
  method: string;
  url: string;
  status: number;
  durationMs: number;
  body?: unknown;
}

export interface HblConfig {
  /** Your HBL merchant ID. Sent as the `merchant.<id>` Basic auth username. */
  merchantId: string;
  /** The API password issued by HBL. Never logged, never serialised. */
  apiPassword: string;
  /**
   * Gateway hostname, with or without a scheme.
   * @default 'ap-gateway.mastercard.com'
   */
  host?: string;
  /** @default 100 */
  apiVersion?: number;
  /** Merchant name shown on the hosted checkout page. */
  merchantName?: string;
  /** @default 30000 */
  timeoutMs?: number;
  /**
   * Retries for idempotent (GET) requests on network errors and 5xx.
   * @default 2
   */
  maxRetries?: number;
  /** Inject a `fetch` implementation — used by the test suite to stay offline. */
  fetch?: typeof fetch;
  /** Called before each request. Credentials are redacted. */
  onRequest?: (info: HblRequestInfo) => void;
  /** Called after each response, including failures. */
  onResponse?: (info: HblResponseInfo) => void;
}

export interface ResolvedHblConfig {
  merchantId: string;
  apiPassword: string;
  host: string;
  apiVersion: number;
  merchantName?: string;
  timeoutMs: number;
  maxRetries: number;
  baseUrl: string;
  authHeader: string;
  /** Absolute URL of the hosted-checkout browser script. */
  checkoutJsUrl: string;
  fetch: typeof fetch;
  onRequest?: (info: HblRequestInfo) => void;
  onResponse?: (info: HblResponseInfo) => void;
}

/** Base64 encoder that works in Node, browsers, Workers and Deno alike. */
function toBase64(input: string): string {
  if (typeof globalThis.btoa === 'function') {
    // btoa is latin1-only; the credentials are ASCII, but encode defensively.
    const bytes = new TextEncoder().encode(input);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return globalThis.btoa(binary);
  }
  const maybeBuffer = (globalThis as { Buffer?: { from(s: string, e: string): { toString(e: string): string } } })
    .Buffer;
  if (maybeBuffer) return maybeBuffer.from(input, 'utf-8').toString('base64');
  throw new HblConfigError('No base64 implementation available in this runtime.');
}

/** Strips a scheme, trailing slash or stray path from a pasted host value. */
function cleanHost(host: string): string {
  const stripped = host.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const hostOnly = stripped.split('/')[0];
  if (!hostOnly || /\s/.test(hostOnly)) {
    throw new HblConfigError(
      `Invalid host ${JSON.stringify(host)}: expected a hostname such as "${DEFAULT_HBL_HOST}".`,
      'host'
    );
  }
  return hostOnly;
}

function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HblConfigError(`Missing required configuration: ${field}.`, field);
  }
  return value.trim();
}

export function resolveConfig(config: HblConfig): ResolvedHblConfig {
  if (!config || typeof config !== 'object') {
    throw new HblConfigError('HblGateway requires a configuration object.');
  }

  const merchantId = requireNonEmpty(config.merchantId, 'merchantId');
  const apiPassword = requireNonEmpty(config.apiPassword, 'apiPassword');
  const host = cleanHost(config.host ?? DEFAULT_HBL_HOST);
  const apiVersion = config.apiVersion ?? DEFAULT_API_VERSION;

  if (!Number.isInteger(apiVersion) || apiVersion < 1) {
    throw new HblConfigError(`Invalid apiVersion ${apiVersion}: expected a positive integer.`, 'apiVersion');
  }

  const fetchImpl = config.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new HblConfigError(
      'No global fetch available. Use Node 18 or newer, or pass a `fetch` implementation in the config.',
      'fetch'
    );
  }

  return {
    merchantId,
    apiPassword,
    host,
    apiVersion,
    merchantName: config.merchantName,
    timeoutMs: config.timeoutMs ?? 30_000,
    maxRetries: config.maxRetries ?? 2,
    baseUrl: `https://${host}/api/rest/version/${apiVersion}/merchant/${merchantId}`,
    authHeader: `Basic ${toBase64(`merchant.${merchantId}:${apiPassword}`)}`,
    checkoutJsUrl: `https://${host}/static/checkout/checkout.min.js`,
    // Unbound from any object that might be `this`-sensitive.
    fetch: (...args: Parameters<typeof fetch>) => fetchImpl(...args),
    onRequest: config.onRequest,
    onResponse: config.onResponse,
  };
}

/** Environment variables read by {@link configFromEnv}. */
export interface HblEnvLike {
  HBL_MERCHANT_ID?: string;
  HBL_API_PASSWORD?: string;
  HBL_GATEWAY_HOST?: string;
  HBL_MERCHANT_NAME?: string;
  [key: string]: string | undefined;
}

/**
 * Builds a config from `HBL_MERCHANT_ID`, `HBL_API_PASSWORD`,
 * `HBL_GATEWAY_HOST` and `HBL_MERCHANT_NAME`, with `overrides` winning.
 */
export function configFromEnv(
  env: HblEnvLike = (globalThis as { process?: { env?: HblEnvLike } }).process?.env ?? {},
  overrides: Partial<HblConfig> = {}
): HblConfig {
  const merchantId = overrides.merchantId ?? env.HBL_MERCHANT_ID;
  const apiPassword = overrides.apiPassword ?? env.HBL_API_PASSWORD;

  const missing: string[] = [];
  if (!merchantId) missing.push('HBL_MERCHANT_ID');
  if (!apiPassword) missing.push('HBL_API_PASSWORD');
  if (missing.length > 0) {
    throw new HblConfigError(
      `Payment gateway is not configured. Missing environment variable${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`,
      missing[0]
    );
  }

  return {
    ...overrides,
    merchantId: merchantId as string,
    apiPassword: apiPassword as string,
    host: overrides.host ?? env.HBL_GATEWAY_HOST,
    merchantName: overrides.merchantName ?? env.HBL_MERCHANT_NAME,
  };
}
