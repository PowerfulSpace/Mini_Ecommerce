<template>
  <n-layout-header bordered>
    <div class="header-content">
      <div class="header-left">
        <router-link to="/">
          <img :src="logo" alt="logo" class="logo" />
        </router-link>

        <n-menu
          mode="horizontal"
          :options="menuOptions"
          :value="active"
          @update:value="onSelect"
        />
      </div>

      <div v-if="isDev" class="dev-identity">
        <n-text depth="3" class="dev-identity__label">dev identity</n-text>
        <n-select
          :value="authStore.testUser"
          :options="identityOptions"
          placeholder="select user"
          size="small"
          class="dev-identity__select"
          @update:value="onIdentityChange"
        />
      </div>
    </div>
  </n-layout-header>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NLayoutHeader, NMenu, NSelect, NText } from 'naive-ui'
import type { MenuOption, SelectOption } from 'naive-ui'
import logo from '@/assets/icons/logo.svg'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()

// The identity selector is a development-only convenience, never a login.
const isDev = import.meta.env.DEV

const active = computed(() => route.name as string)

const menuOptions: MenuOption[] = [
  { label: 'Catalog', key: 'catalog' },
  { label: 'Cart', key: 'cart' },
  { label: 'Orders', key: 'orders' },
]

const identityOptions: SelectOption[] = [
  { label: 'Alice', value: 'alice' },
  { label: 'Bob', value: 'bob' },
]

function onSelect(key: string) {
  router.push({ name: key })
}

function onIdentityChange(value: unknown) {
  if (value === 'alice' || value === 'bob') {
    authStore.setUser(value)
  } else {
    authStore.clear()
  }
}
</script>

<style scoped>
.header-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 20px;
  height: 64px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 24px;
}

.logo {
  height: 32px;
  display: block;
}

.dev-identity {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dev-identity__label {
  white-space: nowrap;
}

.dev-identity__select {
  width: 140px;
}
</style>
