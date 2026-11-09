import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Each deploy gets an ID. The app compares it with /version.json to know when a newer
// version is live and offer a refresh (phones can keep DRIFT open for hours).
const BUILD_ID = (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 12) || Date.now().toString(36)

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [
    react(),
    {
      name: 'drift-version',
      apply: 'build',
      generateBundle() { this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ id: BUILD_ID }) }) },
    },
  ],
})
