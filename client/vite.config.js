import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: 'client',
  plugins: [vue(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8002',
      '/hooks': 'http://localhost:8002'
    }
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true
  }
})
