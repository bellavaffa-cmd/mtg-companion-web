import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/** Files from public/ that the installed app needs offline (the rest of public/ isn't used). */
const PUBLIC_FILES = ['favicon.svg', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png']

/**
 * Writes sw.js (from pwa/sw.template.js) listing this build's files, so the service worker keeps them
 * on the device and the app opens offline. Its cache name comes from the file list, which changes
 * with every build that changes anything (as does this template), so each deploy replaces the last
 * one's cache.
 */
function serviceWorker(): Plugin {
  return {
    name: 'mtg-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const built = Object.keys(bundle).filter((file) => !file.endsWith('.map') && file !== 'index.html')
      const files = ['./', ...PUBLIC_FILES, ...built]
      const template = readFileSync(new URL('./pwa/sw.template.js', import.meta.url), 'utf8')
      const version = createHash('sha256').update(files.join('|')).update(template).digest('hex').slice(0, 12)
      const source = template
        .replace('__VERSION__', version)
        .replace('__FILES__', JSON.stringify(files))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), serviceWorker()],
  // Served from https://<user>.github.io/mtg-companion-web/, not the domain root.
  base: '/mtg-companion-web/',
})
