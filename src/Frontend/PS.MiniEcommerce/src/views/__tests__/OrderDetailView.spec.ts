import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import OrderDetailView from '@/views/OrderDetailView.vue'
import { getOrder } from '@/services/api/orders'
import type { ApiError, OrderDetail } from '@/types/api'

vi.mock('@/services/api/orders', () => ({
  createOrder: vi.fn(),
  getOrders: vi.fn(),
  getOrder: vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: 'order-1' } }),
}))

const getOrderMock = vi.mocked(getOrder)

// Snapshots deliberately differ from any plausible current catalog values so the
// test fails if the view ever reads names or prices from another source.
const order: OrderDetail = {
  id: 'order-1',
  status: 'Created',
  createdAtUtc: '2026-01-15T12:30:00Z',
  totalAmount: 19,
  items: [
    {
      productId: 'p1',
      productName: 'Исторический товар',
      unitPrice: 1.23,
      quantity: 2,
      lineTotal: 2.46,
    },
  ],
}

function mountView() {
  return mount(OrderDetailView, {
    global: { stubs: { RouterLink: RouterLinkStub } },
  })
}

describe('OrderDetailView', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    getOrderMock.mockReset()
  })

  it('renders the order using the snapshot name and price from the response', async () => {
    getOrderMock.mockResolvedValue(order)

    const wrapper = mountView()
    await flushPromises()

    expect(getOrderMock).toHaveBeenCalledWith('order-1')
    expect(wrapper.text()).toContain('order-1')
    expect(wrapper.text()).toContain('Исторический товар')
    expect(wrapper.text()).toContain('$1.23')
    expect(wrapper.text()).toContain('$2.46')
    expect(wrapper.text()).toContain('Итого: $19.00')
  })

  it('renders the not-found state for order_not_found', async () => {
    getOrderMock.mockRejectedValue({
      status: 404,
      code: 'order_not_found',
      raw: null,
    } as ApiError)

    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.text()).toContain('Заказ не найден')
  })

  it('renders the error state with a retry action', async () => {
    getOrderMock.mockRejectedValue({
      status: 500,
      detail: 'Сервер недоступен',
      raw: null,
    } as ApiError)

    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.text()).toContain('Сервер недоступен')
    expect(wrapper.text()).toContain('Повторить')
  })

  it('offers a link back to the order list', async () => {
    getOrderMock.mockResolvedValue(order)

    const wrapper = mountView()
    await flushPromises()

    const link = wrapper
      .findAllComponents(RouterLinkStub)
      .find((l) => l.props('to') === '/orders')
    expect(link).toBeTruthy()
  })
})
