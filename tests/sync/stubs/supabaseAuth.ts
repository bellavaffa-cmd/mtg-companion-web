// Stands in for src/sync/supabaseAuth.ts in tests: just what cloudSync.ts uses, with no Vite env.
export const restUrl = (path: string) => `https://sync.test${path}`
export const apiHeaders = (token?: string): Record<string, string> => (token ? { Authorization: `Bearer ${token}` } : {})
export class OfflineError extends Error {}
