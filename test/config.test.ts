import { describe, expect, it, vi } from 'vitest';
import { configFromEnv, resolveConfig } from '../src/config.js';
import { HblConfigError } from '../src/errors.js';
import { HblGateway } from '../src/index.js';

const base = { merchantId: 'TESTMERCHANT', apiPassword: 'secret', fetch: vi.fn() as unknown as typeof fetch };

describe('resolveConfig', () => {
  it('builds the MPGS base URL and Basic auth header', () => {
    const config = resolveConfig(base);
    expect(config.baseUrl).toBe(
      'https://ap-gateway.mastercard.com/api/rest/version/100/merchant/TESTMERCHANT'
    );
    // MPGS expects the username to be `merchant.<merchantId>`.
    const decoded = Buffer.from(config.authHeader.replace('Basic ', ''), 'base64').toString();
    expect(decoded).toBe('merchant.TESTMERCHANT:secret');
  });

  it('accepts a host pasted with a scheme or trailing slash', () => {
    expect(resolveConfig({ ...base, host: 'https://test.gateway.mastercard.com/' }).host).toBe(
      'test.gateway.mastercard.com'
    );
    expect(resolveConfig({ ...base, host: 'test.gateway.mastercard.com' }).host).toBe(
      'test.gateway.mastercard.com'
    );
  });

  it('exposes the checkout script URL for the browser', () => {
    expect(resolveConfig(base).checkoutJsUrl).toBe(
      'https://ap-gateway.mastercard.com/static/checkout/checkout.min.js'
    );
  });

  it.each([
    [{ ...base, merchantId: '' }, 'merchantId'],
    [{ ...base, apiPassword: '  ' }, 'apiPassword'],
  ])('rejects missing credentials', (config, field) => {
    expect(() => resolveConfig(config)).toThrow(
      expect.objectContaining({ name: 'HblConfigError', field })
    );
  });

  it('rejects a nonsense api version', () => {
    expect(() => resolveConfig({ ...base, apiVersion: 0 })).toThrow(HblConfigError);
  });
});

describe('configFromEnv', () => {
  it('reads the documented variables', () => {
    const config = configFromEnv({
      HBL_MERCHANT_ID: 'ENVMERCHANT',
      HBL_API_PASSWORD: 'env-secret',
      HBL_GATEWAY_HOST: 'test.gateway.mastercard.com',
      HBL_MERCHANT_NAME: 'Env Store',
    });
    expect(config.merchantId).toBe('ENVMERCHANT');
    expect(config.host).toBe('test.gateway.mastercard.com');
    expect(config.merchantName).toBe('Env Store');
  });

  it('names every missing variable in one message', () => {
    expect(() => configFromEnv({})).toThrow(/HBL_MERCHANT_ID, HBL_API_PASSWORD/);
  });

  it('lets explicit overrides win', () => {
    const config = configFromEnv(
      { HBL_MERCHANT_ID: 'ENVMERCHANT', HBL_API_PASSWORD: 'env-secret' },
      { merchantId: 'OVERRIDE' }
    );
    expect(config.merchantId).toBe('OVERRIDE');
  });
});

describe('HblGateway', () => {
  it('never serialises the api password', () => {
    const gateway = new HblGateway(base);
    const serialised = JSON.stringify(gateway);
    expect(serialised).not.toContain('secret');
    expect(serialised).toContain('[REDACTED]');
  });

  it('exposes only browser-safe values as getters', () => {
    const gateway = new HblGateway(base);
    expect(gateway.merchantId).toBe('TESTMERCHANT');
    expect(gateway.host).toBe('ap-gateway.mastercard.com');
    expect(gateway.checkoutJsUrl).toContain('/static/checkout/checkout.min.js');
  });

  it('builds from the environment', () => {
    const gateway = HblGateway.fromEnv(
      { fetch: base.fetch },
      { HBL_MERCHANT_ID: 'ENVMERCHANT', HBL_API_PASSWORD: 'env-secret' }
    );
    expect(gateway.merchantId).toBe('ENVMERCHANT');
  });
});
