'use client';

import * as React from 'react';

/**
 * React helpers for HBL's hosted checkout page.
 *
 * This entry point deliberately accepts only values that are safe in a
 * browser — a session ID and a hostname. There is no way to pass an API
 * password through it, because credentials belong on your server and the
 * session is created there.
 */

/** The shape MPGS exposes on `window.Checkout` once the script has loaded. */
interface CheckoutGlobal {
  configure(options: Record<string, unknown>): void;
  showPaymentPage(): void;
  showEmbeddedPage?(selector: string): void;
}

declare global {
  interface Window {
    Checkout?: CheckoutGlobal;
  }
}

/** Everything the browser needs, and nothing it should not have. */
export interface HblCheckoutSession {
  /** From `checkout.initiate()` on your server. */
  sessionId: string;
  /**
   * Gateway hostname. Ignored when `checkoutJsUrl` is given.
   * @default 'hbl.gateway.mastercard.com'
   */
  host?: string;
  /** Full script URL, as returned by `checkout.initiate()`. */
  checkoutJsUrl?: string;
}

export interface UseHblCheckoutOptions extends HblCheckoutSession {
  /**
   * URL HBL redirects to if the payment errors. Becomes the script's
   * `data-error` attribute.
   */
  errorUrl?: string;
  /**
   * URL HBL redirects to if the customer cancels. Becomes the script's
   * `data-cancel` attribute. Defaults to the current page.
   */
  cancelUrl?: string;
  /** Called instead of navigating on error. Takes precedence over `errorUrl`. */
  onError?: (error: unknown) => void;
  /** Called instead of navigating on cancel. Takes precedence over `cancelUrl`. */
  onCancel?: () => void;
  /** Load the script as soon as the hook mounts rather than on first use. */
  preload?: boolean;
}

export type HblCheckoutStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface UseHblCheckoutResult {
  status: HblCheckoutStatus;
  /** True while the script is loading or the redirect is being prepared. */
  loading: boolean;
  error: Error | null;
  /** Redirects the customer to HBL's hosted payment page. */
  showPaymentPage: () => Promise<void>;
  /** Renders the payment page into an element instead of redirecting. */
  showEmbeddedPage: (selector: string) => Promise<void>;
}

const DEFAULT_HOST = 'hbl.gateway.mastercard.com';
const SCRIPT_ID = 'hbl-checkout-script';

/** Resolves once `window.Checkout` is available; shared across all callers. */
let scriptPromise: Promise<CheckoutGlobal> | null = null;

interface ScriptCallbacks {
  onError?: (error: unknown) => void;
  onCancel?: () => void;
  errorUrl?: string;
  cancelUrl?: string;
}

/**
 * Loads `checkout.min.js` once per page.
 *
 * MPGS reads `data-error` and `data-cancel` off the script tag at load time
 * and will not re-read them, so the first call's handlers win. Callbacks are
 * routed through a mutable holder rather than baked into the tag, which keeps
 * a component re-render from silently losing its error handler.
 */
function loadCheckoutScript(
  checkoutJsUrl: string,
  callbacks: ScriptCallbacks
): Promise<CheckoutGlobal> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('The HBL checkout script can only be loaded in a browser.'));
  }

  const holder = getCallbackHolder();
  holder.onError = callbacks.onError;
  holder.onCancel = callbacks.onCancel;

  if (scriptPromise) return scriptPromise;

  if (window.Checkout) {
    scriptPromise = Promise.resolve(window.Checkout);
    return scriptPromise;
  }

  scriptPromise = new Promise<CheckoutGlobal>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing ?? document.createElement('script');

    script.id = SCRIPT_ID;
    script.async = true;

    // A callback wins over a URL; otherwise fall back to HBL's redirect form,
    // which is what the attribute was designed for.
    script.setAttribute(
      'data-error',
      callbacks.onError ? `${CALLBACK_NAMESPACE}.error` : (callbacks.errorUrl ?? window.location.href)
    );
    script.setAttribute(
      'data-cancel',
      callbacks.onCancel ? `${CALLBACK_NAMESPACE}.cancel` : (callbacks.cancelUrl ?? window.location.href)
    );

    script.onload = () => {
      if (window.Checkout) {
        resolve(window.Checkout);
      } else {
        scriptPromise = null;
        reject(new Error('The HBL checkout script loaded but did not define window.Checkout.'));
      }
    };
    script.onerror = () => {
      scriptPromise = null;
      script.remove();
      reject(new Error(`Failed to load the HBL checkout script from ${checkoutJsUrl}.`));
    };

    if (!existing) {
      script.src = checkoutJsUrl;
      document.body.appendChild(script);
    }
  });

  return scriptPromise;
}

const CALLBACK_NAMESPACE = '__hblCheckoutCallbacks';

interface CallbackHolder {
  error: (error: unknown) => void;
  cancel: () => void;
  onError?: (error: unknown) => void;
  onCancel?: () => void;
}

function getCallbackHolder(): CallbackHolder {
  const globalScope = window as unknown as Record<string, CallbackHolder | undefined>;
  let holder = globalScope[CALLBACK_NAMESPACE];
  if (!holder) {
    holder = {
      error: (error: unknown) => holder?.onError?.(error),
      cancel: () => holder?.onCancel?.(),
    };
    globalScope[CALLBACK_NAMESPACE] = holder;
  }
  return holder;
}

/**
 * Test seam: forgets the cached script promise so each test starts clean.
 * Not intended for application code.
 */
export function __resetCheckoutScriptCache(): void {
  scriptPromise = null;
  if (typeof window !== 'undefined') {
    delete (window as unknown as Record<string, unknown>)[CALLBACK_NAMESPACE];
    document.getElementById(SCRIPT_ID)?.remove();
  }
}

/**
 * Loads HBL's checkout script and hands back a function that opens the
 * payment page.
 *
 * @example
 * const { showPaymentPage, loading, error } = useHblCheckout({ sessionId, host });
 * return <button onClick={showPaymentPage} disabled={loading}>Pay now</button>;
 */
export function useHblCheckout(options: UseHblCheckoutOptions): UseHblCheckoutResult {
  const { sessionId, host, checkoutJsUrl, errorUrl, cancelUrl, onError, onCancel, preload } = options;

  const [status, setStatus] = React.useState<HblCheckoutStatus>('idle');
  const [error, setError] = React.useState<Error | null>(null);

  // Held in a ref so a re-render with new handlers does not re-run the effect
  // or invalidate an in-flight load.
  const handlers = React.useRef({ onError, onCancel, errorUrl, cancelUrl });
  handlers.current = { onError, onCancel, errorUrl, cancelUrl };

  const scriptUrl = checkoutJsUrl ?? `https://${host ?? DEFAULT_HOST}/static/checkout/checkout.min.js`;

  const ensureLoaded = React.useCallback(async (): Promise<CheckoutGlobal> => {
    setStatus((current) => (current === 'ready' ? current : 'loading'));
    setError(null);
    try {
      const checkout = await loadCheckoutScript(scriptUrl, handlers.current);
      setStatus('ready');
      return checkout;
    } catch (cause) {
      const asError = cause instanceof Error ? cause : new Error(String(cause));
      setStatus('error');
      setError(asError);
      throw asError;
    }
  }, [scriptUrl]);

  React.useEffect(() => {
    if (!preload) return;
    let cancelled = false;
    ensureLoaded().catch(() => {
      // State is already recorded by ensureLoaded; preloading must never
      // surface an unhandled rejection.
    });
    return () => {
      cancelled = true;
      void cancelled;
    };
  }, [preload, ensureLoaded]);

  const showPaymentPage = React.useCallback(async () => {
    if (!sessionId) {
      const missing = new Error('A sessionId is required before the payment page can be shown.');
      setStatus('error');
      setError(missing);
      throw missing;
    }
    const checkout = await ensureLoaded();
    checkout.configure({ session: { id: sessionId } });
    checkout.showPaymentPage();
  }, [sessionId, ensureLoaded]);

  const showEmbeddedPage = React.useCallback(
    async (selector: string) => {
      const checkout = await ensureLoaded();
      if (!checkout.showEmbeddedPage) {
        throw new Error('This version of the HBL checkout script does not support embedded pages.');
      }
      checkout.configure({ session: { id: sessionId } });
      checkout.showEmbeddedPage(selector);
    },
    [sessionId, ensureLoaded]
  );

  return {
    status,
    loading: status === 'loading',
    error,
    showPaymentPage,
    showEmbeddedPage,
  };
}

export interface HblCheckoutProps
  extends UseHblCheckoutOptions,
    Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onError' | 'onClick'> {
  /** Button label. @default 'Pay now' */
  children?: React.ReactNode;
  /** Label while the script loads. @default 'Loading payment…' */
  loadingLabel?: React.ReactNode;
  /** Render the error message under the button. @default true */
  showError?: boolean;
}

/**
 * An unstyled "Pay now" button that opens HBL's hosted payment page.
 *
 * No styles are shipped beyond what you pass in `className`, so it inherits
 * whatever design system the host app uses.
 *
 * @example
 * <HblCheckout
 *   sessionId={session.sessionId}
 *   host={session.host}
 *   className="btn btn-primary"
 * />
 */
export function HblCheckout({
  sessionId,
  host,
  checkoutJsUrl,
  errorUrl,
  cancelUrl,
  onError,
  onCancel,
  preload,
  children = 'Pay now',
  loadingLabel = 'Loading payment…',
  showError = true,
  disabled,
  ...buttonProps
}: HblCheckoutProps): React.ReactElement {
  const { showPaymentPage, loading, error } = useHblCheckout({
    sessionId,
    host,
    checkoutJsUrl,
    errorUrl,
    cancelUrl,
    onError,
    onCancel,
    preload,
  });

  return (
    <>
      <button
        type="button"
        {...buttonProps}
        disabled={disabled || loading}
        onClick={() => {
          showPaymentPage().catch(() => {
            // Surfaced through `error` below and the `onError` callback.
          });
        }}
      >
        {loading ? loadingLabel : children}
      </button>
      {showError && error ? <p role="alert">{error.message}</p> : null}
    </>
  );
}
