import type { HttpClient } from '../client.js';
import { HblConfigError } from '../errors.js';
import { encodeSegment } from '../internal.js';
import type { HblSession } from '../types.js';

/** Read access to hosted checkout sessions. */
export class SessionsResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Retrieves a session, which is mainly useful for inspecting the order
   * details a customer entered on the hosted page before paying.
   */
  async retrieve(sessionId: string): Promise<HblSession> {
    if (typeof sessionId !== 'string' || sessionId.trim() === '') {
      throw new HblConfigError('sessionId is required.', 'sessionId');
    }
    return (await this.http.request({
      method: 'GET',
      path: `/session/${encodeSegment(sessionId.trim())}`,
    })) as HblSession;
  }
}
