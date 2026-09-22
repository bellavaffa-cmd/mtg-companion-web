import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeBrowser } from '../../src/sync/qrLogin.ts'

// What the phone shows the user before signing a browser in.

test('a browser describes itself in words the user will recognise', () => {
  assert.equal(describeBrowser('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36'), 'Chrome on Windows')
  assert.equal(describeBrowser('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/141.0 Safari/537.36 Edg/141.0'), 'Edge on Windows')
  assert.equal(describeBrowser('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'), 'Safari on a Mac')
  assert.equal(describeBrowser('Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0'), 'Firefox on Linux')
  assert.equal(describeBrowser('something else entirely'), 'A browser')
})
