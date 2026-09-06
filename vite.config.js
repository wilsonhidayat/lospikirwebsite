import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Dev server only: serve public/admin/index.html for "/admin" and "/admin/".
 * Vite's dev server doesn't resolve directory indexes inside public/, so
 * without this the SPA fallback answers /admin/ with the site itself.
 * On Netlify the static host handles this already.
 */
function serveAdminIndex() {
  return {
    name: 'serve-admin-index',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const path = (req.url || '').split('?')[0]
        if (path === '/admin' || path === '/admin/') {
          req.url = '/admin/index.html'
        }
        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), serveAdminIndex()],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
})
