<template>
  <div class="order-confirmation">
    <n-result
      status="success"
      title="Заказ успешно создан"
      :description="`Номер заказа: ${orderId}`"
    >
      <template #footer>
        <router-link to="/">Вернуться в каталог</router-link>
      </template>
    </n-result>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { NResult } from 'naive-ui'

const route = useRoute()

// Phase 10.5 will load the order from the API. For now only the identifier from
// the checkout response is shown.
const orderId = computed(() => {
  const raw = route.params.id
  return Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '')
})
</script>

<style scoped>
.order-confirmation {
  max-width: 640px;
  margin: 0 auto;
}
</style>
