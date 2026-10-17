import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { InternalAxiosRequestConfig } from 'axios'
import { createPinia, setActivePinia } from 'pinia'
import { apiClient } from '@/services/api/client'
import { createOrder } from '@/services/api/orders'
import type { OrderDetail } from '@/types/api'

const originalAdapter = apiClient.defaults.adapter

beforeEach(() => {
  // Checkout requests are authenticated, so the request interceptor reaches for
  // the auth store; an active Pinia is therefore required.
  localStorage.clear()
  setActivePinia(createPinia())
})

afterEach(() => {
  apiClient.defaults.adapter = originalAdapter
})

const order: OrderDetail = {
  id: 'order-1',
  status: 'Created',
  createdAtUtc: '2026-01-15T12:30:00Z',
  totalAmount: 19,
  items: [
    {
      productId: 'p1',
      productName: 'Keyboard',
      unitPrice: 9.5,
      quantity: 2,
      lineTotal: 19,
    },
  ],
}

describe('orders API', () => {
  it('createOrder sends Idempotency-Key and If-Match with an empty body', async () => {
    let seen: {
      url?: string
      method?: string
      idempotencyKey?: unknown
      ifMatch?: unknown
      data?: unknown
    } = {}

    apiClient.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
      seen = {
        url: config.url,
        method: config.method,
        idempotencyKey: config.headers.get('Idempotency-Key'),
        ifMatch: config.headers.get('If-Match'),
        data: config.data,
      }
      return { data: order, status: 201, statusText: 'Created', headers: {}, config }
    }

    const result = await createOrder('key_12345678', '"V1"')

    expect(seen.url).toBe('/orders')
    expect(seen.method).toBe('post')
    expect(seen.idempotencyKey).toBe('key_12345678')
    expect(seen.ifMatch).toBe('"V1"')
    expect(seen.data).toBeUndefined()
    expect(result).toEqual(order)
  })

  it('rejects with a normalized ApiError when the backend returns a problem', async () => {
    apiClient.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
      const error = {
        isAxiosError: true,
        response: {
          status: 503,
          data: { code: 'idempotency_in_progress', title: 'In progress' },
        },
        config,
      }
      throw error
    }

    await expect(createOrder('key_12345678', '"V1"')).rejects.toMatchObject({
      status: 503,
      code: 'idempotency_in_progress',
    })
  })
})
