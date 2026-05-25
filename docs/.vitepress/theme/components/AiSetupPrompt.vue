<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useData } from "vitepress";

// Extra page source paths (relativePath form, e.g. "getting-started/configuration.md")
// to reference alongside the current page.
const props = defineProps<{ also?: string[] }>();

const { page, site } = useData();

const origin = ref("");
onMounted(() => {
  origin.value = window.location.origin;
});

function mdUrl(relativePath: string): string {
  return origin.value + site.value.base + relativePath;
}

const urls = computed(() => [
  mdUrl(page.value.relativePath),
  ...(props.also ?? []).map(mdUrl),
]);

const prompt = computed(
  () =>
    `I want to install Ident. Read these docs first:\n\n` +
    `${urls.value.join("\n")}\n\n` +
    `Then, before giving me any steps, ask me what you need to know about my ` +
    `setup, one thing at a time. I may not know all the technical details, so ask ` +
    `in plain terms and help me work them out instead of assuming I already know ` +
    `them. Then give me step-by-step instructions tailored to my answers.`,
);

const copied = ref(false);
let resetTimer: ReturnType<typeof setTimeout> | undefined;
async function copyPrompt(): Promise<void> {
  try {
    await navigator.clipboard.writeText(prompt.value);
    copied.value = true;
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      copied.value = false;
    }, 2000);
  } catch (error) {
    console.error("Failed to copy prompt:", error);
  }
}
</script>

<template>
  <div class="language-text vp-adaptive-theme ai-setup-prompt">
    <button
      type="button"
      :class="['copy', { copied }]"
      :title="copied ? 'Copied' : 'Copy prompt'"
      @click="copyPrompt"
    />
    <span class="lang">prompt</span>
    <pre><code>{{ prompt }}</code></pre>
  </div>
</template>

<style scoped>
.ai-setup-prompt :deep(pre),
.ai-setup-prompt :deep(code) {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
