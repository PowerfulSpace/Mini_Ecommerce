<template>
  <n-layout-header bordered>
    <div class="header-content">
      <router-link to="/">
        <img :src="logo" alt="logo" class="logo" />
      </router-link>

      <n-menu mode="horizontal" :options="menuOptions" :value="active" @update:value="onSelect" />
    </div>
  </n-layout-header>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { NLayoutHeader, NMenu, NText } from 'naive-ui'
import type { MenuOption } from 'naive-ui'
import logo from '@/assets/icons/logo.svg'

const router = useRouter()
const route = useRoute()

const active = computed(() => route.name as string)

const menuOptions: MenuOption[] = [
  { label: 'Home', key: 'home' },
  { label: 'About', key: 'about' },
]

function onSelect(key: string) {
  router.push({ name: key })
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

.logo {
  height: 32px;
  display: block;
}
</style>
