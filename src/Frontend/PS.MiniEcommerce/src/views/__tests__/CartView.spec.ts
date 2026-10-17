import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { NButton } from 'naive-ui'
import CartView from '@/views/CartView.vue'
import { useCartStore } from '@/stores/cart'
import { useCheckoutStore } from '@/stores/checkout'
import { getCart } from '@/services/api/cart'
import type { ApiError, Cart, CartItem } from '@/types/api'

vi.mock('@/services/api/cart', () => ({
  getCart: vi.fn(),
  addItem: vi.fn(),
  updateItem: vi.fn(),
  removeItem: vi.fn(),
}))

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }))

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: {} }),
  useRouter: () => ({ push: pushMock }),
}))

const getCartMock = vi.mocked(getCart)

function checkoutButton(wrapper: ReturnType<typeof mountView>) {
  return wrapper.findAllComponents(NButton).find((button) => button.text().includes('Оформить'))
}

const item: CartItem = {
  productId: 'p1',
  productName: 'Keyboard',
  unitPrice: 9.5,
  quantity: 2,
  lineTotal: 19,
  isAvailable: true,
}

const cart: Cart = { items: [item], totalAmount: 19 }
const emptyCart: Cart = { items: [], totalAmount: 0 }

function mountView() {
  return mount(CartView, {
    global: { stubs: { RouterLink: RouterLinkStub } },
  })
}

describe('CartView', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    setActivePinia(createPinia())
    getCartMock.mockReset()
    pushMock.mockReset()
  })

  it('renders the empty state with a link to the catalog', async () => {
    getCartMock.mockResolvedValue({ data: emptyCart, etag: '"V1"' })

    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.text()).toContain('Корзина пуста')
    const link = wrapper.findAllComponents(RouterLinkStub).find((l) => l.props('to') === '/')
    expect(link).toBeTruthy()
  })

  it('renders the cart items, line totals and the overall total', async () => {
    getCartMock.mockResolvedValue({ data: cart, etag: '"V1"' })

    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.text()).toContain('Keyboard')
    expect(wrapper.text()).toContain('$9.50')
    expect(wrapper.text()).toContain('$19.00')
    expect(wrapper.text()).toContain('Итого: $19.00')
    expect(wrapper.text()).toContain('Удалить')
  })

  it('marks unavailable items', async () => {
    getCartMock.mockResolvedValue({
      data: { items: [{ ...item, isAvailable: false }], totalAmount: 19 },
      etag: '"V1"',
    })

    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.text()).toContain('Недоступен')
  })

  it('shows the error state with a refresh action', async () => {
    getCartMock.mockRejectedValue({ status: 500, detail: 'Сервер недоступен', raw: null } as ApiError)

    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.text()).toContain('Сервер недоступен')
    expect(wrapper.text()).toContain('Обновить')
  })

  it('shows the conflict warning when the store reports a version conflict', async () => {
    getCartMock.mockResolvedValue({ data: cart, etag: '"V1"' })

    const wrapper = mountView()
    await flushPromises()
    useCartStore().conflict = true
    await flushPromises()

    expect(wrapper.text()).toContain('Корзина изменилась, показаны актуальные данные')
  })

  it('sets loading while the cart request is in flight', async () => {
    getCartMock.mockReturnValue(new Promise(() => {}))

    mountView()

    expect(useCartStore().loading).toBe(true)
  })

  it('disables the checkout button when the cart is empty', async () => {
    getCartMock.mockResolvedValue({ data: emptyCart, etag: '"V1"' })

    const wrapper = mountView()
    await flushPromises()

    expect(checkoutButton(wrapper)?.props('disabled')).toBe(true)
  })

  it('calls checkout.submit when the checkout button is clicked', async () => {
    getCartMock.mockResolvedValue({ data: cart, etag: '"V1"' })
    const submitSpy = vi.spyOn(useCheckoutStore(), 'submit').mockResolvedValue()

    const wrapper = mountView()
    await flushPromises()

    await checkoutButton(wrapper)?.trigger('click')

    expect(submitSpy).toHaveBeenCalledTimes(1)
  })

  it('shows an error alert for a failed checkout', async () => {
    getCartMock.mockResolvedValue({ data: cart, etag: '"V1"' })

    const wrapper = mountView()
    await flushPromises()

    const checkout = useCheckoutStore()
    checkout.error = {
      status: 409,
      code: 'insufficient_stock',
      detail: 'Недостаточно товара',
      raw: null,
    }
    await flushPromises()

    expect(wrapper.text()).toContain('Недостаточно товара')
  })

  it('shows an info alert while checkout is in progress', async () => {
    getCartMock.mockResolvedValue({ data: cart, etag: '"V1"' })

    const wrapper = mountView()
    await flushPromises()

    useCheckoutStore().inProgress = true
    await flushPromises()

    expect(wrapper.text()).toContain('Заказ обрабатывается')
  })
})
