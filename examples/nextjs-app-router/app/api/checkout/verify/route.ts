import { NextResponse } from 'next/server';
import { HblVerificationError } from 'hbl-payment-gateway';
import { hbl } from '@/lib/hbl';
import { getOrder, updateOrder } from '@/lib/orders';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const orderId = url.searchParams.get('orderId');
  const resultIndicator = url.searchParams.get('resultIndicator');

  const order = orderId ? getOrder(orderId) : undefined;
  if (!order) {
    return NextResponse.json({ status: 'UNKNOWN' }, { status: 404 });
  }

  // Guards against a refreshed result page re-running fulfilment.
  if (order.status === 'PAID') {
    return NextResponse.json({ status: 'PAID', alreadyPaid: true });
  }

  try {
    const result = await hbl.checkout.verify({
      orderId: order.gatewayOrderId,
      resultIndicator,
      successIndicator: order.successIndicator,
      // Without these, an order paid for the wrong amount still verifies.
      expectedAmount: order.amount,
      expectedCurrency: order.currency,
    });

    updateOrder(order.id, { status: 'PAID' });

    // Fulfilment goes here: send the receipt, provision the service, and so on.
    return NextResponse.json({ status: 'PAID', gatewayStatus: result.status });
  } catch (error) {
    if (error instanceof HblVerificationError) {
      updateOrder(order.id, { status: 'FAILED', failureReason: error.reason });
      return NextResponse.json({ status: 'FAILED', reason: error.reason });
    }
    throw error;
  }
}
