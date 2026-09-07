// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { HblCheckout, __resetCheckoutScriptCache } from '../src/react/index.js';

/**
 * Simulates HBL's checkout.min.js: the browser fetches the tag, and on load the
 * script defines `window.Checkout`.
 */
function stubScriptLoading(options: { succeed?: boolean } = {}) {
  const { succeed = true } = options;
  const configure = vi.fn();
  const showPaymentPage = vi.fn();

  const original = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tagName: string, ...rest) => {
    const element = original(tagName as 'script', ...(rest as []));
    if (tagName !== 'script') return element;

    const script = element as HTMLScriptElement;
    // jsdom does not fetch scripts, so fire the outcome once src is assigned.
    Object.defineProperty(script, 'src', {
      set() {
        queueMicrotask(() => {
          if (succeed) {
            window.Checkout = { configure, showPaymentPage };
            script.onload?.(new Event('load'));
          } else {
            script.onerror?.(new Event('error'));
          }
        });
      },
      get: () => 'https://hbl.gateway.mastercard.com/static/checkout/checkout.min.js',
      configurable: true,
    });
    return script;
  });

  return { configure, showPaymentPage };
}

beforeEach(() => {
  vi.restoreAllMocks();
  delete window.Checkout;
  __resetCheckoutScriptCache();
});

// Auto-cleanup is off without vitest globals, and a leaked render leaves a
// second "Pay now" button behind for the next test to trip over.
afterEach(() => {
  cleanup();
});

describe('<HblCheckout>', () => {
  it('renders a button and loads the script only when clicked', async () => {
    const { configure, showPaymentPage } = stubScriptLoading();
    render(<HblCheckout sessionId="SESSION0002899999999999999999" />);

    const button = screen.getByRole('button', { name: 'Pay now' });
    expect(document.getElementById('hbl-checkout-script')).toBeNull();

    await act(async () => {
      button.click();
    });

    await waitFor(() => expect(showPaymentPage).toHaveBeenCalled());
    expect(configure).toHaveBeenCalledWith({
      session: { id: 'SESSION0002899999999999999999' },
    });
  });

  it('sets data-error and data-cancel on the script tag', async () => {
    stubScriptLoading();
    render(
      <HblCheckout
        sessionId="SESSION1"
        errorUrl="https://acme.example/result?error=true"
        cancelUrl="https://acme.example/cart"
      />
    );

    await act(async () => {
      screen.getByRole('button').click();
    });

    await waitFor(() => {
      const script = document.getElementById('hbl-checkout-script');
      expect(script?.getAttribute('data-error')).toBe('https://acme.example/result?error=true');
      expect(script?.getAttribute('data-cancel')).toBe('https://acme.example/cart');
    });
  });

  it('surfaces a script that fails to load', async () => {
    stubScriptLoading({ succeed: false });
    render(<HblCheckout sessionId="SESSION1" />);

    await act(async () => {
      screen.getByRole('button').click();
    });

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/Failed to load/i);
    });
  });

  it('refuses to open the payment page without a session', async () => {
    stubScriptLoading();
    render(<HblCheckout sessionId="" />);

    await act(async () => {
      screen.getByRole('button').click();
    });

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/sessionId is required/i);
    });
  });

  it('uses a custom host when one is given', async () => {
    stubScriptLoading();
    render(<HblCheckout sessionId="SESSION1" host="test.gateway.mastercard.com" />);

    await act(async () => {
      screen.getByRole('button').click();
    });

    await waitFor(() => expect(document.getElementById('hbl-checkout-script')).not.toBeNull());
  });
});
