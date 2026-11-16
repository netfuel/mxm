import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Builds the mail admin into public/admin (served at /admin by Cloudflare Pages).
// `npm run dev` proxies the API to `wrangler pages dev` on :8788.
export default defineConfig({
  plugins: [react()],
  base: '/admin/',
  build: { outDir: '../public/admin', emptyOutDir: true, sourcemap: false },
  server: { proxy: { '/admin/api': 'http://localhost:8788', '/assets': 'http://localhost:8788', '/media': 'http://localhost:8788' } },
})
