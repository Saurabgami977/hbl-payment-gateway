/**
 * Stands in for your database so the example runs without one.
 *
 * Replace this entirely. An in-memory Map loses every order on restart and is
 * not shared across instances — and `successIndicator` must survive until the
 * customer returns from HBL, or the payment cannot be verified.
 */

export interface Order {
  id: string;
  gatewayOrderId: string;
  amount: number;
  currency: string;
  description: string;
  status: 'PENDING' | 'PAID' | 'FAILED';
  successIndicator?: string;
  failureReason?: string;
}

const orders = new Map<string, Order>();

export function createOrder(amount: number, currency = 'PKR'): Order {
  const id = `ord_${Date.now()}`;
  const order: Order = {
    id,
    // MPGS order IDs must be unique per merchant and are limited in length.
    gatewayOrderId: id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 40),
    amount,
    currency,
    description: 'Example order',
    status: 'PENDING',
  };
  orders.set(id, order);
  return order;
}

export function getOrder(id: string): Order | undefined {
  return orders.get(id);
}

export function updateOrder(id: string, patch: Partial<Order>): Order {
  const order = orders.get(id);
  if (!order) throw new Error(`Unknown order ${id}`);
  const updated = { ...order, ...patch };
  orders.set(id, updated);
  return updated;
}
