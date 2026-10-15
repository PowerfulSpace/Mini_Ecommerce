<!-- src/components/common/WelcomeItem.vue -->
<template>
  <div class="welcome-item">
    <div class="icon">
      <slot name="icon"></slot>
    </div>

    <div class="content">
      <h3><slot name="heading"></slot></h3>
      <slot></slot>
    </div>
  </div>
</template>

<script setup lang="ts"></script>

<style scoped>
.welcome-item {
  display: flex;
  gap: 12px;
  padding: 12px 0;
}

.icon {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
}

h3 {
  margin: 0 0 4px 0;
  font-size: 18px;
}
</style>
