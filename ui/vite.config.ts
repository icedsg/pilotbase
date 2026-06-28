import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiUrl = env.VITE_API_URL || 'http://localhost:8000'

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@knowledge': path.resolve(__dirname, '../knowledge'),
      },
    },
    server: {
      fs: { allow: ['..'] },
      port: 5173,
      proxy: {
        '/api': {
          target: apiUrl,
          changeOrigin: true,
        },
        '/ws': {
          target: apiUrl.replace('http', 'ws'),
          ws: true,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
    },
  }
})
