import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: 'settings',
  build: {
    outDir: '../../out/ui/settings',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'settings/index.html'),
      output: {
        entryFileNames: 'main.js',
        assetFileNames: 'main.[ext]'
      }
    }
  }
})
