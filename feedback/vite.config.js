import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    // `npm run dev` serves the React app; API calls proxy to `wrangler dev`
    // running on 8787 so the full flow works locally.
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
})
