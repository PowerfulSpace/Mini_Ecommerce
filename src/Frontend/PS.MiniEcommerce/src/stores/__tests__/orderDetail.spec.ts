import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { useOrderDetailStore } from '@/stores/orderDetail'
import { getOrder } from '@/services/api/orders'
import type { ApiError, OrderDetail } from '@/types/api'

vi.mock('@/services/api/orders', () => ({
  createOrder: vi.fn(),
  getOrders: vi.fn(),
  getOrder: vi.fn(),
}))

const getOrderMock = vi.mocked(getOrder)

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

describe('orderDetailStore', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    getOrderMock.mockReset()
  })

  it('fetch loads the order and marks it as loaded', async () => {
    getOrderMock.mockResolvedValue(order)
    const store = useOrderDetailStore()

    await store.fetch('order-1')

    expect(getOrderMock).toHaveBeenCalledWith('order-1')
    expect(store.order).toEqual(order)
    expect(store.notFound).toBe(false)
    expect(store.error).toBeNull()
    expect(store.loading).toBe(false)
    expect(store.isLoaded).toBe(true)
  })

  it('treats order_not_found as a distinct not-found outcome', async () => {
    getOrderMock.mockRejectedValue({
      status: 404,
      code: 'order_not_found',
      raw: null,
    } as ApiError)
    const store = useOrderDetailStore()

    await store.fetch('missing')

    expect(store.order).toBeNull()
    expect(store.notFound).toBe(true)
    expect(store.error).toBeNull()
    expect(store.isLoaded).toBe(false)
  })

  it('stores other failures as an error', async () => {
    const apiError: ApiError = { status: 500, code: 'health_unavailable', raw: null }
    getOrderMock.mockRejectedValue(apiError)
    const store = useOrderDetailStore()

    await store.fetch('order-1')

    expect(store.order).toBeNull()
    expect(store.notFound).toBe(false)
    expect(store.error).toEqual(apiError)
  })

  it('replaces state between ids without caching', async () => {
    getOrderMock.mockResolvedValueOnce(order).mockResolvedValueOnce({
      ...order,
      id: 'order-2',
    })
    const store = useOrderDetailStore()

    await store.fetch('order-1')
    await store.fetch('order-2')

    expect(store.order?.id).toBe('order-2')
  })

  it('reset clears the state', async () => {
    getOrderMock.mockResolvedValue(order)
    const store = useOrderDetailStore()
    await store.fetch('order-1')

    store.reset()

    expect(store.order).toBeNull()
    expect(store.loading).toBe(false)
    expect(store.error).toBeNull()
    expect(store.notFound).toBe(false)
    expect(store.isLoaded).toBe(false)
  })

  it('is reset when the development identity changes', async () => {
    getOrderMock.mockResolvedValue(order)
    const store = useOrderDetailStore()
    await store.fetch('order-1')
    expect(store.order).not.toBeNull()

    useAuthStore().setUser('bob')

    expect(store.order).toBeNull()
  })
})
