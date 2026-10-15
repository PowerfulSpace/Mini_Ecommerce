<template>
  <div>
    <h2>Home Page</h2>
    <p>Добро пожаловать в наш минимальный Vue проект!</p>

    <TheWelcome />
  </div>
</template>

<script setup lang="ts">
import TheWelcome from '@/components/common/TheWelcome.vue'
</script>

<style scoped>
h2 {
  margin-bottom: 10px;
}
</style>
