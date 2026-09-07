import { describe, expect, it } from 'vitest';
import { timingSafeEqual } from '../src/internal.js';
import { describeGatewayCode, isRetryableGatewayCode } from '../src/errors.js';

describe('timingSafeEqual', () => {
  it('matches identical strings', () => {
    expect(timingSafeEqual('e7f3a1b9c2d40000', 'e7f3a1b9c2d40000')).toBe(true);
  });

  it('rejects differences anywhere in the string', () => {
    expect(timingSafeEqual('abcdef', 'abcdeg')).toBe(false);
    expect(timingSafeEqual('abcdef', 'zbcdef')).toBe(false);
  });

  it('rejects differing lengths, including a prefix', () => {
    expect(timingSafeEqual('abc', 'abcdef')).toBe(false);
    expect(timingSafeEqual('', 'a')).toBe(false);
  });

  it('treats two empty strings as equal', () => {
    expect(timingSafeEqual('', '')).toBe(true);
  });
});

describe('gateway code helpers', () => {
  it('separates transient failures from decisions about the card', () => {
    expect(isRetryableGatewayCode('TIMED_OUT')).toBe(true);
    expect(isRetryableGatewayCode('ACQUIRER_SYSTEM_ERROR')).toBe(true);
    expect(isRetryableGatewayCode('DECLINED')).toBe(false);
    expect(isRetryableGatewayCode('EXPIRED_CARD')).toBe(false);
    expect(isRetryableGatewayCode(undefined)).toBe(false);
  });

  it('gives customer-safe wording, including for unknown codes', () => {
    expect(describeGatewayCode('EXPIRED_CARD')).toMatch(/expired/i);
    expect(describeGatewayCode('SOMETHING_NEW')).toMatch(/could not be processed/i);
    expect(describeGatewayCode(undefined)).toBeTruthy();
  });
});
