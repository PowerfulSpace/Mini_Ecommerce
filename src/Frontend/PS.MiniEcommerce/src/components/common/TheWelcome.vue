<template>
  <div class="welcome-list">
    <WelcomeItem>
      <template #icon>
        <IconChatGPT />
      </template>
      <template #heading>ChatGPT</template>

      Мощная языковая модель, способная вести диалог, писать код и объяснять сложные темы простым
      языком — подробнее на <a href="https://chatgpt.com" target="_blank">ChatGPT</a>.
    </WelcomeItem>

    <WelcomeItem>
      <template #icon>
        <IconCopilot />
      </template>
      <template #heading>Copilot</template>

      Инструмент‑ассистент, который помогает писать код, а также генерировать идеи и ускорять
      разработку — подробнее на <a href="https://copilot.microsoft.com" target="_blank">Copilot</a>.
    </WelcomeItem>

    <WelcomeItem>
      <template #icon>
        <IconDeepSeek />
      </template>
      <template #heading>DeepSeek</template>

      Модель, ориентированная на точность анализа и поиск информации, подробнее описана на
      <a href="https://www.deepseek.com" target="_blank">DeepSeek</a>, и хорошо подходит для сложных
      задач.
    </WelcomeItem>

    <WelcomeItem>
      <template #icon>
        <IconGrok />
      </template>
      <template #heading>Grok</template>

      Быстрая и дерзкая модель для свободного общения, о которой можно почитать на
      <a href="https://grok.x.ai" target="_blank">Grok</a>, если хочется чего‑то менее формального.
    </WelcomeItem>

    <WelcomeItem>
      <template #icon>
        <IconGemini />
      </template>
      <template #heading>Gemini</template>

      Мультимодальная модель Google, подробнее представленная на
      <a href="https://gemini.google.com" target="_blank">Gemini</a>, умеет работать с текстом,
      изображениями и сложными запросами.
    </WelcomeItem>
  </div>
</template>

<script setup lang="ts">
import WelcomeItem from './WelcomeItem.vue'
import IconChatGPT from '../icons/IconChatGPT.vue'
import IconCopilot from '../icons/IconCopilot.vue'
import IconDeepSeek from '../icons/IconDeepSeek.vue'
import IconGrok from '../icons/IconGrok.vue'
import IconGemini from '../icons/IconGemini.vue'
</script>

<style scoped>
.welcome-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
</style>
