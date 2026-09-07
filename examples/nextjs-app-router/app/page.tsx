'use client';

import { useState } from 'react';
import { useHblCheckout } from 'hbl-payment-gateway/react';

interface Session {
  sessionId: string;
  host: string;
  checkoutJsUrl: string;
}

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkout = useHblCheckout({
    sessionId: session?.sessionId ?? '',
    checkoutJsUrl: session?.checkoutJsUrl,
  });

  async function pay() {
    setStarting(true);
    setError(null);
    try {
      const response = await fetch('/api/checkout', { method: 'POST' });
      if (!response.ok) throw new Error('Could not start the payment.');
      setSession(await response.json());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong.');
    } finally {
      setStarting(false);
    }
  }

  return (
    <main style={{ maxWidth: 480, margin: '4rem auto', fontFamily: 'system-ui' }}>
      <h1>Example Store</h1>
      <p>Starter plan — NPR 1,500.00</p>

      {session ? (
        <button onClick={() => checkout.showPaymentPage()} disabled={checkout.loading}>
          {checkout.loading ? 'Loading payment…' : 'Continue to payment'}
        </button>
      ) : (
        <button onClick={pay} disabled={starting}>
          {starting ? 'Starting…' : 'Pay now'}
        </button>
      )}

      {(error || checkout.error) && (
        <p role="alert" style={{ color: 'crimson' }}>{error ?? checkout.error?.message}</p>
      )}
    </main>
  );
}
