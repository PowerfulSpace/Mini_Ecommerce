<template>
  <div class="cart">
    <h2>Корзина</h2>

    <n-alert v-if="store.conflict" type="warning" class="cart__conflict">
      Корзина изменилась, показаны актуальные данные
    </n-alert>

    <div v-if="store.error" class="cart__state">
      <n-alert type="error">{{ errorMessage }}</n-alert>
      <n-button type="primary" @click="refresh">Обновить</n-button>
    </div>

    <n-spin :show="store.loading">
      <n-empty
        v-if="store.isEmpty && !store.error"
        class="cart__state"
        description="Корзина пуста"
      >
        <template #extra>
          <router-link to="/">Перейти в каталог</router-link>
        </template>
      </n-empty>

      <template v-else-if="!store.isEmpty">
        <n-card v-for="item in store.items" :key="item.productId" class="cart-item">
          <div class="cart-item__row">
            <div class="cart-item__info">
              <h3 class="cart-item__name">{{ item.productName }}</h3>
              <span class="cart-item__unit-price">{{ formatPrice(item.unitPrice) }}</span>
              <n-tag v-if="!item.isAvailable" size="small" type="error">Недоступен</n-tag>
            </div>

            <div class="cart-item__controls">
              <n-input-number
                :value="quantityOf(item)"
                :min="1"
                :step="1"
                :disabled="store.mutating || !item.isAvailable"
                class="cart-item__quantity"
                @update:value="(value) => onQuantityInput(item, value)"
                @blur="() => onQuantityCommit(item)"
              />
              <span class="cart-item__line-total">{{ formatPrice(item.lineTotal) }}</span>
              <n-button secondary type="error" :disabled="store.mutating" @click="onRemove(item)">
                Удалить
              </n-button>
            </div>
          </div>
        </n-card>

        <div class="cart__footer">
          <span class="cart__total">Итого: {{ formatPrice(store.totalAmount) }}</span>
          <n-button type="primary" disabled>Checkout — Phase 10.4</n-button>
        </div>
      </template>
    </n-spin>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive } from 'vue'
import { NAlert, NButton, NCard, NEmpty, NInputNumber, NSpin, NTag } from 'naive-ui'
import { useCartStore } from '@/stores/cart'
import type { CartItem } from '@/types/api'

const store = useCartStore()

const usdFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

function formatPrice(value: number): string {
  return usdFormatter.format(value)
}

const errorMessage = computed(
  () => store.error?.detail || store.error?.title || 'Не удалось загрузить корзину',
)

// Local drafts let the quantity commit on blur instead of firing a mutation on
// every keystroke. The server value remains authoritative: on commit the draft is
// dropped, so a rejected update falls back to the authoritative quantity.
const drafts = reactive<Record<string, number>>({})

function quantityOf(item: CartItem): number {
  return drafts[item.productId] ?? item.quantity
}

function onQuantityInput(item: CartItem, value: number | null): void {
  if (typeof value === 'number') {
    drafts[item.productId] = value
  }
}

async function onQuantityCommit(item: CartItem): Promise<void> {
  const next = drafts[item.productId]
  delete drafts[item.productId]

  if (next === undefined || next === item.quantity) {
    return
  }

  await store.updateItem(item.productId, next)
}

async function onRemove(item: CartItem): Promise<void> {
  await store.removeItem(item.productId)
}

function refresh(): void {
  void store.fetch()
}

onMounted(() => {
  void store.fetch()
})
</script>

<style scoped>
.cart__conflict {
  margin-bottom: 16px;
}

.cart__state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.cart-item {
  margin-bottom: 12px;
}

.cart-item__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.cart-item__info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.cart-item__name {
  margin: 0;
}

.cart-item__controls {
  display: flex;
  align-items: center;
  gap: 16px;
}

.cart-item__quantity {
  width: 130px;
}

.cart-item__line-total {
  min-width: 90px;
  text-align: right;
  font-weight: 600;
}

.cart__footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 20px;
  margin-top: 20px;
}

.cart__total {
  font-size: 1.2rem;
  font-weight: 600;
}
</style>
