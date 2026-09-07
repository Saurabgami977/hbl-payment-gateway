import { describe, expect, it, vi } from 'vitest';
import {
  capturedOrder,
  createFailingFetch,
  createFetchStub,
  createGateway,
  initiateCheckoutSuccess,
} from './helpers.js';
import { HblApiError, HblConfigError, HblDeclineError, HblNetworkError, HblVerificationError } from '../src/errors.js';

describe('checkout.initiate', () => {
  it('posts a well-formed INITIATE_CHECKOUT to /session', async () => {
    const { fetchStub, calls } = createFetchStub({ body: initiateCheckoutSuccess });
    const hbl = createGateway(fetchStub as unknown as typeof fetch);

    const result = await hbl.checkout.initiate({
      orderId: 'ord_1024',
      amount: 1500,
      currency: 'npr',
      description: 'Starter plan',
      returnUrl: 'https://acme.example/result',
    });

    expect(calls[0]!.url).toBe(
      'https://ap-gateway.mastercard.com/api/rest/version/100/merchant/TESTMERCHANT/session'
    );
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.body).toMatchObject({
      apiOperation: 'INITIATE_CHECKOUT',
      checkoutMode: 'WEBSITE',
      interaction: {
        operation: 'PURCHASE',
        returnUrl: 'https://acme.example/result',
        merchant: { name: 'Test Store' },
      },
      order: { id: 'ord_1024', amount: '1500.00', currency: 'NPR', description: 'Starter plan' },
    });

    expect(result.sessionId).toBe('SESSION0002899999999999999999');
    expect(result.successIndicator).toBe('e7f3a1b9c2d40000');
    expect(result.checkoutJsUrl).toContain('/static/checkout/checkout.min.js');
  });

  it('sends the Basic auth header on every request', async () => {
    const { fetchStub, calls } = createFetchStub({ body: initiateCheckoutSuccess });
    const hbl = createGateway(fetchStub as unknown as typeof fetch);
    await hbl.checkout.initiate({
      orderId: 'ord_1024',
      amount: 1,
      currency: 'NPR',
      returnUrl: 'https://acme.example/result',
    });
    const auth = calls[0]!.headers.Authorization;
    expect(Buffer.from(auth.replace('Basic ', ''), 'base64').toString()).toBe(
      'merchant.TESTMERCHANT:secret-password'
    );
  });

  it('supports AUTHORIZE and the optional interaction fields', async () => {
    const { fetchStub, calls } = createFetchStub({ body: initiateCheckoutSuccess });
    const hbl = createGateway(fetchStub as unknown as typeof fetch);

    await hbl.checkout.initiate({
      orderId: 'ord_1024',
      amount: 1500,
      currency: 'NPR',
      returnUrl: 'https://acme.example/result',
      operation: 'AUTHORIZE',
      cancelUrl: 'https://acme.example/cart',
      customer: { email: 'buyer@example.com' },
    });

    expect(calls[0]!.body).toMatchObject({
      interaction: { operation: 'AUTHORIZE', cancelUrl: 'https://acme.example/cart' },
      customer: { email: 'buyer@example.com' },
    });
  });

  it('treats HTTP 200 with result FAILURE as an error', async () => {
    // This is the trap: MPGS reports most failures with a 200 status line.
    const { fetchStub } = createFetchStub({
      status: 200,
      body: {
        result: 'ERROR',
        error: { cause: 'INVALID_REQUEST', explanation: 'Value is invalid', field: 'order.amount' },
      },
    });
    const hbl = createGateway(fetchStub as unknown as typeof fetch);

    await expect(
      hbl.checkout.initiate({
        orderId: 'ord_1024',
        amount: 1500,
        currency: 'NPR',
        returnUrl: 'https://acme.example/result',
      })
    ).rejects.toMatchObject({
      name: 'HblApiError',
      errorCause: 'INVALID_REQUEST',
      explanation: 'Value is invalid',
      field: 'order.amount',
    });
  });

  it('maps a gateway decline onto HblDeclineError', async () => {
    const { fetchStub } = createFetchStub({
      status: 200,
      body: {
        result: 'FAILURE',
        response: { gatewayCode: 'DECLINED', acquirerCode: '05', acquirerMessage: 'Do not honour' },
      },
    });
    const hbl = createGateway(fetchStub as unknown as typeof fetch);

    const error = await hbl.checkout
      .initiate({
        orderId: 'ord_1024',
        amount: 1500,
        currency: 'NPR',
        returnUrl: 'https://acme.example/result',
      })
      .catch((e) => e);

    expect(error).toBeInstanceOf(HblDeclineError);
    expect(error.gatewayCode).toBe('DECLINED');
    expect(error.isRetryable).toBe(false);
  });

  it('marks transient gateway codes as retryable', async () => {
    const { fetchStub } = createFetchStub({
      status: 200,
      body: { result: 'FAILURE', response: { gatewayCode: 'ACQUIRER_SYSTEM_ERROR' } },
    });
    const hbl = createGateway(fetchStub as unknown as typeof fetch);
    const error = await hbl.checkout
      .initiate({ orderId: 'o', amount: 1, currency: 'NPR', returnUrl: 'https://a.example' })
      .catch((e) => e);
    expect(error.isRetryable).toBe(true);
  });

  it('surfaces an HTTP error with its status', async () => {
    const { fetchStub } = createFetchStub({
      status: 401,
      body: { error: { cause: 'INVALID_REQUEST', explanation: 'Invalid credentials' } },
    });
    const hbl = createGateway(fetchStub as unknown as typeof fetch);
    const error = await hbl.checkout
      .initiate({ orderId: 'o', amount: 1, currency: 'NPR', returnUrl: 'https://a.example' })
      .catch((e) => e);
    expect(error).toBeInstanceOf(HblApiError);
    expect(error.httpStatus).toBe(401);
  });

  it('reports an HTML error page rather than a SyntaxError', async () => {
    const { fetchStub } = createFetchStub({ status: 200, text: '<html>Gateway timeout</html>' });
    const hbl = createGateway(fetchStub as unknown as typeof fetch);
    await expect(
      hbl.checkout.initiate({ orderId: 'o', amount: 1, currency: 'NPR', returnUrl: 'https://a.example' })
    ).rejects.toThrow(/non-JSON response/);
  });

  it('wraps transport failures in HblNetworkError', async () => {
    const hbl = createGateway(createFailingFetch() as unknown as typeof fetch);
    await expect(
      hbl.checkout.initiate({ orderId: 'o', amount: 1, currency: 'NPR', returnUrl: 'https://a.example' })
    ).rejects.toBeInstanceOf(HblNetworkError);
  });

  it('validates input before making any network call', async () => {
    const { fetchStub } = createFetchStub({ body: initiateCheckoutSuccess });
    const hbl = createGateway(fetchStub as unknown as typeof fetch);

    await expect(
      hbl.checkout.initiate({ orderId: '', amount: 1, currency: 'NPR', returnUrl: 'https://a.example' })
    ).rejects.toBeInstanceOf(HblConfigError);
    await expect(
      hbl.checkout.initiate({ orderId: 'o', amount: 1, currency: 'NPR', returnUrl: '' })
    ).rejects.toBeInstanceOf(HblConfigError);
    await expect(
      hbl.checkout.initiate({ orderId: 'o', amount: -1, currency: 'NPR', returnUrl: 'https://a.example' })
    ).rejects.toBeInstanceOf(HblConfigError);

    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('redacts credentials from the onRequest hook', async () => {
    const { fetchStub } = createFetchStub({ body: initiateCheckoutSuccess });
    const onRequest = vi.fn();
    const hbl = createGateway(fetchStub as unknown as typeof fetch, { onRequest });

    await hbl.checkout.initiate({
      orderId: 'o',
      amount: 1,
      currency: 'NPR',
      returnUrl: 'https://a.example',
    });

    const logged = JSON.stringify(onRequest.mock.calls[0]![0]);
    expect(logged).not.toContain('secret-password');
    expect(logged).toContain('[REDACTED]');
  });
});

describe('checkout.verify', () => {
  const validIndicator = 'e7f3a1b9c2d40000';

  it('confirms payment when the indicator matches and the gateway agrees', async () => {
    const { fetchStub, calls } = createFetchStub({ body: capturedOrder });
    const hbl = createGateway(fetchStub as unknown as typeof fetch);

    const result = await hbl.checkout.verify({
      orderId: 'ord_1024',
      resultIndicator: validIndicator,
      successIndicator: validIndicator,
    });

    expect(result).toMatchObject({ paid: true, status: 'CAPTURED', currency: 'NPR' });
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.url).toContain('/order/ord_1024');
  });

  it('rejects a forged result indicator', async () => {
    const { fetchStub } = createFetchStub({ body: capturedOrder });
    const hbl = createGateway(fetchStub as unknown as typeof fetch);

    const error = await hbl.checkout
      .verify({
        orderId: 'ord_1024',
        resultIndicator: 'attacker-supplied-value',
        successIndicator: validIndicator,
      })
      .catch((e) => e);

    expect(error).toBeInstanceOf(HblVerificationError);
    expect(error.reason).toBe('indicator_mismatch');
    // The gateway is never contacted on a mismatch.
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('rejects a missing indicator on either side', async () => {
    const { fetchStub } = createFetchStub({ body: capturedOrder });
    const hbl = createGateway(fetchStub as unknown as typeof fetch);

    for (const args of [
      { resultIndicator: null, successIndicator: validIndicator },
      { resultIndicator: validIndicator, successIndicator: null },
      { resultIndicator: '', successIndicator: '' },
    ]) {
      const error = await hbl.checkout.verify({ orderId: 'ord_1024', ...args }).catch((e) => e);
      expect(error.reason).toBe('missing_indicator');
    }
  });

  it('rejects an order the gateway has not actually captured', async () => {
    // The indicator matches, but the gateway says the payment failed — this is
    // exactly the case the second, server-side check exists to catch.
    const { fetchStub } = createFetchStub({ body: { ...capturedOrder, status: 'FAILED' } });
    const hbl = createGateway(fetchStub as unknown as typeof fetch);

    const error = await hbl.checkout
      .verify({ orderId: 'ord_1024', resultIndicator: validIndicator, successIndicator: validIndicator })
      .catch((e) => e);

    expect(error.reason).toBe('gateway_not_paid');
    expect(error.order).toMatchObject({ status: 'FAILED' });
  });

  it('detects a tampered amount', async () => {
    const { fetchStub } = createFetchStub({ body: capturedOrder });
    const hbl = createGateway(fetchStub as unknown as typeof fetch);

    const error = await hbl.checkout
      .verify({
        orderId: 'ord_1024',
        resultIndicator: validIndicator,
        successIndicator: validIndicator,
        expectedAmount: 9999,
        expectedCurrency: 'NPR',
      })
      .catch((e) => e);

    expect(error.reason).toBe('amount_mismatch');
  });

  it('detects a currency swap', async () => {
    const { fetchStub } = createFetchStub({ body: capturedOrder });
    const hbl = createGateway(fetchStub as unknown as typeof fetch);

    const error = await hbl.checkout
      .verify({
        orderId: 'ord_1024',
        resultIndicator: validIndicator,
        successIndicator: validIndicator,
        expectedAmount: 1500,
        expectedCurrency: 'USD',
      })
      .catch((e) => e);

    expect(error.reason).toBe('currency_mismatch');
  });

  it('passes when the expected amount matches', async () => {
    const { fetchStub } = createFetchStub({ body: capturedOrder });
    const hbl = createGateway(fetchStub as unknown as typeof fetch);

    await expect(
      hbl.checkout.verify({
        orderId: 'ord_1024',
        resultIndicator: validIndicator,
        successIndicator: validIndicator,
        expectedAmount: 1500,
        expectedCurrency: 'NPR',
      })
    ).resolves.toMatchObject({ paid: true });
  });

  it('accepts AUTHORIZED orders, and honours a custom status list', async () => {
    const authorized = { ...capturedOrder, status: 'AUTHORIZED', totalCapturedAmount: 0 };

    const first = createFetchStub({ body: authorized });
    await expect(
      createGateway(first.fetchStub as unknown as typeof fetch).checkout.verify({
        orderId: 'ord_1024',
        resultIndicator: validIndicator,
        successIndicator: validIndicator,
      })
    ).resolves.toMatchObject({ status: 'AUTHORIZED' });

    const second = createFetchStub({ body: authorized });
    await expect(
      createGateway(second.fetchStub as unknown as typeof fetch).checkout.verify({
        orderId: 'ord_1024',
        resultIndicator: validIndicator,
        successIndicator: validIndicator,
        acceptedStatuses: ['CAPTURED'],
      })
    ).rejects.toMatchObject({ reason: 'gateway_not_paid' });
  });
});
