import { describe, expect, it } from 'vitest'
import { toApiError } from '@/services/api/client'

function axiosErrorWith(status: number, data: unknown) {
  return {
    isAxiosError: true,
    response: { status, data },
  }
}

describe('toApiError', () => {
  it('maps a ProblemDetails response that carries a code', () => {
    const raw = axiosErrorWith(409, {
      type: 'https://tools.ietf.org/html/rfc9110#section-15.5.10',
      title: 'Conflict.',
      status: 409,
      detail: 'Cart is empty.',
      code: 'cart_empty',
      instance: '/api/orders',
    })

    const error = toApiError(raw)

    expect(error.status).toBe(409)
    expect(error.code).toBe('cart_empty')
    expect(error.title).toBe('Conflict.')
    expect(error.detail).toBe('Cart is empty.')
    expect(error.instance).toBe('/api/orders')
    expect(error.errors).toBeUndefined()
    expect(error.raw).toBe(raw)
  })

  it('maps a ProblemDetails response without a code and keeps errors', () => {
    const raw = axiosErrorWith(400, {
      type: 'https://tools.ietf.org/html/rfc9110#section-15.5.1',
      title: 'One or more validation errors occurred.',
      status: 400,
      errors: { page: ["The value 'abc' is not valid."] },
    })

    const error = toApiError(raw)

    expect(error.status).toBe(400)
    expect(error.code).toBeUndefined()
    expect(error.title).toBe('One or more validation errors occurred.')
    expect(error.errors).toEqual({ page: ["The value 'abc' is not valid."] })
  })

  it('falls back gracefully for a non-axios error', () => {
    const raw = new Error('network down')

    const error = toApiError(raw)

    expect(error.status).toBe(0)
    expect(error.code).toBeUndefined()
    expect(error.title).toBeUndefined()
    expect(error.raw).toBe(raw)
  })
})
