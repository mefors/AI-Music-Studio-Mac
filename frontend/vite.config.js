import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite' // Bunu ekleyin

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(), // Bunu ekleyin
  ],
})