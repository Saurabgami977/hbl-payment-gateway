import { HblConfigError } from './errors.js';

/**
 * Currencies whose minor unit is not two decimal places.
 *
 * Anything absent from this table is treated as two, which covers PKR, USD,
 * GBP, EUR, AED, SAR and essentially every currency an HBL merchant bills in.
 */
const MINOR_UNIT_OVERRIDES: Record<string, number> = {
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0,
  PYG: 0, RWF: 0, UGX: 0, UYI: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
};

/** Number of decimal places the gateway expects for `currency`. */
export function minorUnits(currency: string): number {
  return MINOR_UNIT_OVERRIDES[normalizeCurrency(currency)] ?? 2;
}

/**
 * Validates and upper-cases an ISO 4217 currency code.
 *
 * @throws {HblConfigError} if the code is not three letters.
 */
export function normalizeCurrency(currency: string): string {
  if (typeof currency !== 'string' || !/^[A-Za-z]{3}$/.test(currency.trim())) {
    throw new HblConfigError(
      `Invalid currency ${JSON.stringify(currency)}: expected a three-letter ISO 4217 code such as "PKR".`,
      'currency'
    );
  }
  return currency.trim().toUpperCase();
}

/**
 * Converts an amount into the decimal string MPGS requires.
 *
 * Floating-point noise from arithmetic like `19.99 * 3` is absorbed, but a
 * genuinely over-precise amount — one that would have to be rounded to fit the
 * currency, such as `1.005` in PKR — is rejected. Silently rounding a customer
 * charge is not this package's decision to make.
 *
 * @example
 * normalizeAmount(19.99 * 3, 'PKR')  // "59.97"
 * normalizeAmount('1500', 'PKR')     // "1500.00"
 * normalizeAmount(1500, 'JPY')       // "1500"
 * normalizeAmount(1.005, 'PKR')      // throws HblConfigError
 *
 * @throws {HblConfigError} on NaN, Infinity, negative or over-precise amounts.
 */
export function normalizeAmount(amount: number | string, currency: string): string {
  const digits = minorUnits(currency);

  if (typeof amount === 'string') {
    const trimmed = amount.trim();
    if (!/^\d+(\.\d+)?$/.test(trimmed)) {
      throw new HblConfigError(
        `Invalid amount ${JSON.stringify(amount)}: expected a non-negative decimal number.`,
        'amount'
      );
    }
    const [whole, fraction = ''] = trimmed.split('.');
    if (fraction.replace(/0+$/, '').length > digits) {
      throw new HblConfigError(
        `Amount ${trimmed} has more precision than ${normalizeCurrency(currency)} allows (${digits} decimal places).`,
        'amount'
      );
    }
    return digits === 0 ? whole : `${whole}.${fraction.slice(0, digits).padEnd(digits, '0')}`;
  }

  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    throw new HblConfigError(
      `Invalid amount ${JSON.stringify(amount)}: expected a finite number.`,
      'amount'
    );
  }
  if (amount < 0) {
    throw new HblConfigError(`Invalid amount ${amount}: must not be negative.`, 'amount');
  }

  const scaled = amount * 10 ** digits;
  const rounded = Math.round(scaled);
  // Tolerates IEEE-754 drift (59.97 arriving as 59.970000000000006) while
  // still catching an amount that really does need rounding.
  if (Math.abs(scaled - rounded) > 1e-6) {
    throw new HblConfigError(
      `Amount ${amount} has more precision than ${normalizeCurrency(currency)} allows (${digits} decimal places).`,
      'amount'
    );
  }
  return (rounded / 10 ** digits).toFixed(digits);
}

/**
 * True when two gateway amount strings represent the same value, ignoring
 * formatting differences such as `"1500"` versus `"1500.00"`.
 */
export function amountsEqual(a: string | number, b: string | number, currency: string): boolean {
  return normalizeAmount(a, currency) === normalizeAmount(b, currency);
}
