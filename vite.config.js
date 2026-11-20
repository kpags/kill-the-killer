import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig(() => {
  const proxy = {
    '/ws': {
      target: `ws://127.0.0.1:${process.env.PORT || 8787}`,
      ws: true,
    },
  }

  return {
    base: './',
    plugins: [vue()],
    server: { proxy },
    preview: { proxy },
  }
})
