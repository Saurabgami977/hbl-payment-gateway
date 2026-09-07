import { describe, expect, it } from 'vitest';
import { amountsEqual, minorUnits, normalizeAmount, normalizeCurrency } from '../src/amount.js';
import { HblConfigError } from '../src/errors.js';

describe('normalizeCurrency', () => {
  it('upper-cases and trims valid codes', () => {
    expect(normalizeCurrency(' pkr ')).toBe('PKR');
  });

  it.each([['PK'], ['PKRR'], ['12A'], ['']])('rejects %s', (input) => {
    expect(() => normalizeCurrency(input)).toThrow(HblConfigError);
  });
});

describe('minorUnits', () => {
  it('defaults to two decimal places', () => {
    expect(minorUnits('PKR')).toBe(2);
    expect(minorUnits('USD')).toBe(2);
    // Not in the override table, so it takes the default.
    expect(minorUnits('AED')).toBe(2);
  });

  it('knows the zero- and three-decimal currencies', () => {
    expect(minorUnits('JPY')).toBe(0);
    expect(minorUnits('KWD')).toBe(3);
  });
});

describe('normalizeAmount', () => {
  it('formats numbers to the currency minor unit', () => {
    expect(normalizeAmount(1500, 'PKR')).toBe('1500.00');
    expect(normalizeAmount(1500, 'JPY')).toBe('1500');
    expect(normalizeAmount(1.5, 'KWD')).toBe('1.500');
  });

  it('absorbs floating-point drift from ordinary arithmetic', () => {
    // 19.99 * 3 is 59.97000000000001 in IEEE-754.
    expect(normalizeAmount(19.99 * 3, 'PKR')).toBe('59.97');
    expect(normalizeAmount(0.1 + 0.2, 'PKR')).toBe('0.30');
  });

  it('pads and passes through strings', () => {
    expect(normalizeAmount('1500', 'PKR')).toBe('1500.00');
    expect(normalizeAmount('1500.5', 'PKR')).toBe('1500.50');
    expect(normalizeAmount('1500.00', 'PKR')).toBe('1500.00');
  });

  it('rejects an amount that would have to be rounded to fit', () => {
    // Silently charging 1.00 or 1.01 for 1.005 is not this package's call.
    expect(() => normalizeAmount(1.005, 'PKR')).toThrow(HblConfigError);
    expect(() => normalizeAmount('1.005', 'PKR')).toThrow(HblConfigError);
    expect(() => normalizeAmount('1500.5', 'JPY')).toThrow(HblConfigError);
  });

  it('keeps trailing zeros that do not add precision', () => {
    expect(normalizeAmount('1.5000', 'PKR')).toBe('1.50');
  });

  it.each([
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
    [-1],
  ])('rejects %s', (input) => {
    expect(() => normalizeAmount(input, 'PKR')).toThrow(HblConfigError);
  });

  it('rejects strings that are not plain decimals', () => {
    for (const bad of ['1,500.00', '1500 PKR', 'abc', '', '1e3', '-5']) {
      expect(() => normalizeAmount(bad, 'PKR')).toThrow(HblConfigError);
    }
  });

  it('allows zero, which VERIFY operations need', () => {
    expect(normalizeAmount(0, 'PKR')).toBe('0.00');
  });
});

describe('amountsEqual', () => {
  it('ignores formatting differences', () => {
    expect(amountsEqual('1500', 1500.0, 'PKR')).toBe(true);
    expect(amountsEqual('1500.00', '1500.000', 'PKR')).toBe(true);
    expect(amountsEqual(1500, 1500.01, 'PKR')).toBe(false);
  });
});
