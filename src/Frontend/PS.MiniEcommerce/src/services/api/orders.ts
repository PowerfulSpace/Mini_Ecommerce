import { apiClient } from '@/services/api/client'
import type { OrderDetail } from '@/types/api'

// Checkout requires both headers: `Idempotency-Key` identifies the attempt and
// `If-Match` carries the cart ETag, which is part of the request fingerprint
// (api.md section 3.4, and DECISIONS.md section 13 D1). The request body is
// empty. Failures are rejected as ApiError by the shared response interceptor;
// no special handling is added here.
export async function createOrder(
  idempotencyKey: string,
  ifMatch: string,
): Promise<OrderDetail> {
  // The body is intentionally empty. `undefined` (not `null`) is passed because
  // axios serializes a `null` body to the four-byte string "null" when the JSON
  // content type is set, which would contradict the documented empty body.
  const response = await apiClient.post<OrderDetail>('/orders', undefined, {
    headers: {
      'Idempotency-Key': idempotencyKey,
      'If-Match': ifMatch,
    },
  })

  return response.data
}
