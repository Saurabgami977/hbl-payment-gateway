import { NextResponse } from 'next/server';
import { HblError } from 'hbl-payment-gateway';
import { hbl } from '@/lib/hbl';
import { createOrder, updateOrder } from '@/lib/orders';

export async function POST() {
  // Your real app would look up an existing cart or order here.
  const order = createOrder(1500, 'NPR');

  try {
    const session = await hbl.checkout.initiate({
      orderId: order.gatewayOrderId,
      amount: order.amount,
      currency: order.currency,
      description: order.description,
      returnUrl: `${process.env.NEXT_PUBLIC_BASE_URL}/checkout/result?orderId=${order.id}`,
      cancelUrl: `${process.env.NEXT_PUBLIC_BASE_URL}/`,
    });

    // Must be persisted before the customer leaves for HBL — this is the only
    // value that lets you verify their return.
    updateOrder(order.id, { successIndicator: session.successIndicator });

    // Only browser-safe values cross this boundary. The API password does not.
    return NextResponse.json({
      orderId: order.id,
      sessionId: session.sessionId,
      host: session.host,
      checkoutJsUrl: session.checkoutJsUrl,
    });
  } catch (error) {
    if (error instanceof HblError) {
      console.error('[hbl] initiate failed:', error.message);
      return NextResponse.json({ error: 'Could not start the payment.' }, { status: 502 });
    }
    throw error;
  }
}
