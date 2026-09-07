import { HblGateway } from 'hbl-payment-gateway';

/**
 * One client for the whole app.
 *
 * `fromEnv()` throws at startup naming any missing variable, which beats
 * discovering the problem as a 401 during a customer's checkout.
 */
export const hbl = HblGateway.fromEnv();
