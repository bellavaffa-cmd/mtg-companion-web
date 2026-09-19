// Stands in for src/sync/supabaseAuth.ts in tests: just what cloudSync.ts and social/api.ts use, with no Vite env.
export const restUrl = (path: string) => `https://sync.test${path}`
export const apiHeaders = (token?: string): Record<string, string> => (token ? { Authorization: `Bearer ${token}` } : {})
export class OfflineError extends Error {}
/** Tests are never signed in to the real server. */
export const accessToken = async (): Promise<string | null> => null
export const realtimeSocketUrl = () => 'wss://sync.test/realtime/v1/websocket'
