'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

function Result() {
  const params = useSearchParams();
  const [status, setStatus] = useState<string>('CHECKING');
  const [reason, setReason] = useState<string | null>(null);

  useEffect(() => {
    const query = new URLSearchParams({
      orderId: params.get('orderId') ?? '',
      resultIndicator: params.get('resultIndicator') ?? '',
    });

    // The browser never decides whether the payment succeeded — the server does.
    fetch(`/api/checkout/verify?${query}`)
      .then((response) => response.json())
      .then((data) => {
        setStatus(data.status);
        setReason(data.reason ?? null);
      })
      .catch(() => setStatus('ERROR'));
  }, [params]);

  return (
    <main style={{ maxWidth: 480, margin: '4rem auto', fontFamily: 'system-ui' }}>
      {status === 'CHECKING' && <p>Confirming your payment…</p>}
      {status === 'PAID' && <h1>Payment received</h1>}
      {status === 'FAILED' && (
        <>
          <h1>Payment could not be confirmed</h1>
          <p>Reason: {reason}</p>
        </>
      )}
      {status === 'ERROR' && <h1>Something went wrong</h1>}
    </main>
  );
}

export default function ResultPage() {
  return (
    <Suspense fallback={null}>
      <Result />
    </Suspense>
  );
}
