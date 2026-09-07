import type { HttpClient } from '../client.js';
import { HblConfigError } from '../errors.js';
import { encodeSegment } from '../internal.js';
import type { HblOrder } from '../types.js';

/** Read access to orders held by the gateway. */
export class OrdersResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Retrieves an order, including every transaction recorded against it.
   *
   * This does not throw when the order's last transaction failed: a failed
   * payment is still a successful retrieval, and inspecting `status` is the
   * whole point of the call.
   */
  async retrieve(orderId: string): Promise<HblOrder> {
    if (typeof orderId !== 'string' || orderId.trim() === '') {
      throw new HblConfigError('orderId is required.', 'orderId');
    }
    return (await this.http.request({
      method: 'GET',
      path: `/order/${encodeSegment(orderId.trim())}`,
    })) as HblOrder;
  }
}
