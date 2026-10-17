import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { getOrder } from '@/services/api/orders'
import { useAuthStore } from '@/stores/auth'
import type { ApiError, OrderDetail } from '@/types/api'

export const useOrderDetailStore = defineStore('orderDetail', () => {
  const order = ref<OrderDetail | null>(null)
  const loading = ref(false)
  const error = ref<ApiError | null>(null)
  const notFound = ref(false)

  const isLoaded = computed(
    () => order.value !== null && !loading.value && error.value === null && !notFound.value,
  )

  async function fetch(id: string): Promise<void> {
    // No caching between ids: every call fully replaces the previous state, so a
    // previously opened order can never be shown while another id is loading.
    loading.value = true
    order.value = null
    error.value = null
    notFound.value = false

    try {
      order.value = await getOrder(id)
    } catch (caught) {
      // The response interceptor normalizes failures into ApiError. A missing or
      // not-owned order is a distinct outcome from a generic failure.
      const apiError = caught as ApiError
      if (apiError.code === 'order_not_found') {
        notFound.value = true
      } else {
        error.value = apiError
      }
    } finally {
      loading.value = false
    }
  }

  function reset(): void {
    order.value = null
    loading.value = false
    error.value = null
    notFound.value = false
  }

  // Order details are user-scoped; switching identity must clear them.
  useAuthStore().registerUserScopedReset(reset)

  return { order, loading, error, notFound, isLoaded, fetch, reset }
})
