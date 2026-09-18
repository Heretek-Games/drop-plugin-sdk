<template>
  <div class="fullstack-panel">
    <div class="header">
      <h4 class="title">Sync Status</h4>
      <span class="badge">Fullstack</span>
    </div>
    <p class="desc">
      Server routes and this client panel ship together in a single plugin bundle.
    </p>
    <div class="actions">
      <button class="btn" @click="refresh">Refresh {{ count }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";

const count = ref(0);

function refresh() {
  count.value += 1;
}
</script>

<style scoped>
.fullstack-panel {
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
  color: #22d3ee;
  margin: 0;
}

.badge {
  font-size: 0.625rem;
  font-family: monospace;
  background: rgba(6, 182, 212, 0.2);
  color: #a5f3fc;
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
  background: #0891b2;
  color: #ffffff;
  padding: 0.375rem 0.75rem;
  border-radius: 0.375rem;
  border: none;
  cursor: pointer;
}

.btn:hover {
  background: #0e7490;
}
</style>
