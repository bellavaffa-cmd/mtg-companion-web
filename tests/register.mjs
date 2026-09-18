// Lets Node run the app's TypeScript sources directly in tests (npm test): resolves the extensionless
// relative imports Vite allows ("./mergeItems") to their .ts files, and swaps the Supabase auth
// module — which reads Vite's import.meta.env — for a stub.
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'

const authStub = new URL('./sync/stubs/supabaseAuth.ts', import.meta.url).href

registerHooks({
  resolve(specifier, context, nextResolve) {
    const relative = specifier.startsWith('./') || specifier.startsWith('../')
    if (relative && context.parentURL && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      const url = new URL(`${specifier}.ts`, context.parentURL)
      if (url.pathname.endsWith('/src/sync/supabaseAuth.ts')) return { url: authStub, shortCircuit: true }
      if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})
