<script setup>
import { ref, useId } from 'vue'

const levels = defineModel({ type: Object, required: true })
defineEmits(['back'])

const id = useId()
const heading = ref(null)
const channels = [
  { key: 'sfx', label: 'SFX' },
  { key: 'music', label: 'Music' },
]

defineExpose({ focusHeading: () => heading.value?.focus({ preventScroll: true }) })
</script>

<template>
  <section class="audio-settings" :aria-labelledby="`${id}-title`">
    <h2 :id="`${id}-title`" ref="heading" tabindex="-1">Settings</h2>
    <div v-for="{ key, label } in channels" :key="key" class="audio-channel">
      <label :for="`${id}-${key}`">{{ label }}</label>
      <span aria-hidden="true">{{ levels[key] }}%</span>
      <input
        :id="`${id}-${key}`"
        type="range"
        min="0"
        max="100"
        :value="levels[key]"
        :aria-valuetext="`${levels[key]} percent`"
        @input="levels = { ...levels, [key]: $event.currentTarget.valueAsNumber }"
      />
    </div>
    <button type="button" class="glass-button" @click="$emit('back')">Back</button>
  </section>
</template>

<style scoped>
.audio-settings {
  display: grid;
  gap: 16px;
  width: min(100%, 20rem);
  padding: 18px;
  border: 1px solid #ffdfba80;
  border-radius: 24px;
  background: #41241deb;
  backdrop-filter: blur(16px);
  box-shadow: inset 0 1px 0 #fff4e459, 0 10px 28px #20100c55;
  text-align: left;
}

h2 {
  margin: 0;
  font-size: 1.35rem;
}

.audio-channel {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  column-gap: 14px;
  font-size: 0.94rem;
  font-weight: 700;
}

.audio-channel span {
  font-variant-numeric: tabular-nums;
}

.audio-channel input {
  grid-column: 1 / -1;
  width: 100%;
  min-height: 36px;
  margin: 0;
  accent-color: #69adff;
}

.audio-channel input:focus-visible {
  outline: 2px solid #fff6e5;
  outline-offset: 2px;
}

.audio-settings button {
  min-height: 44px;
  border-radius: 14px;
}
</style>
