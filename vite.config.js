import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  root: path.resolve(process.cwd(), 'client'),
  plugins: [react()],
  build: {
    outDir: path.resolve(process.cwd(), 'client/dist'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          motion: ['framer-motion'],
          audio: ['meyda'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3000',
    },
  },
})
