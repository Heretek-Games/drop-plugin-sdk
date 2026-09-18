<template>
  <div class="plugin-panel">
    <div class="header">
      <h4 class="title">Extension Panel</h4>
      <span class="badge">Vue 3 SFC</span>
    </div>
    <p class="desc">
      This component was written in standard Vue 3 with scoped CSS and compiled by drop-plugin build.
    </p>
    <div class="actions">
      <button class="btn" @click="count++">
        Clicked {{ count }} times
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";

const count = ref(0);
</script>

<style scoped>
.plugin-panel {
  padding: 1rem;
  background: rgba(24, 24, 27, 0.6);
  border: 1px solid rgba(63, 63, 70, 0.5);
  border-radius: 0.75rem;
  margin-top: 0.75rem;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}

.title {
  font-size: 0.875rem;
  font-weight: 600;
  color: #c084fc;
  margin: 0;
}

.badge {
  font-size: 0.625rem;
  font-family: monospace;
  background: rgba(168, 85, 247, 0.2);
  color: #d8b4fe;
  padding: 0.125rem 0.375rem;
  border-radius: 0.25rem;
}

.desc {
  font-size: 0.75rem;
  color: #a1a1aa;
  margin: 0 0 0.75rem 0;
}

.btn {
  font-size: 0.75rem;
  font-weight: 500;
  background: #7c3aed;
  color: #ffffff;
  padding: 0.375rem 0.75rem;
  border-radius: 0.375rem;
  border: none;
  cursor: pointer;
  transition: background 0.15s ease;
}

.btn:hover {
  background: #6d28d9;
}
</style>
