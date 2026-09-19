import { test } from 'node:test'
import assert from 'node:assert/strict'
import qrcode from 'qrcode-generator'
import jsQR from 'jsqr'
import { appLinkPath } from '../../src/scan/qr.ts'

// The app's QR codes on the web Scan page. The Android app reads the same links — see
// AppLink.parse (TradeLogicTest.kt checks it).

const base = 'https://bellavaffa-cmd.github.io/mtg-companion-web/'

test("the app's links open where they lead; anything else doesn't", () => {
  assert.equal(appLinkPath(`${base}add/Bob_99`), '/add/bob_99')
  assert.equal(appLinkPath(`${base}add/bob/`), '/add/bob')
  assert.equal(appLinkPath(`${base}join/0123456789abcdef/3`), '/join/0123456789abcdef/3')
  assert.equal(appLinkPath(`${base}s/${'a'.repeat(32)}?x=1`), `/s/${'a'.repeat(32)}`)
  // A dev build's links too.
  assert.equal(appLinkPath('http://localhost:5174/mtg-companion-web/add/carol'), '/add/carol')
  assert.equal(appLinkPath(`${base}add/a`), null)
  assert.equal(appLinkPath(`${base}join/not-a-code/3`), null)
  assert.equal(appLinkPath(`${base}decks/abc`), null)
  assert.equal(appLinkPath('https://example.com/add/bob'), null)
  assert.equal(appLinkPath('hello'), null)
})

test('a friend code made by the app reads back through jsQR', () => {
  // The same generator the Friends page draws its code with.
  const link = `${base}add/bob`
  const qr = qrcode(0, 'M')
  qr.addData(link)
  qr.make()
  const modules = qr.getModuleCount()
  const cell = 6
  const quiet = 4 * cell
  const size = modules * cell + quiet * 2
  const data = new Uint8ClampedArray(size * size * 4).fill(255)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const mx = Math.floor((x - quiet) / cell)
      const my = Math.floor((y - quiet) / cell)
      if (mx >= 0 && my >= 0 && mx < modules && my < modules && qr.isDark(my, mx)) {
        const i = (y * size + x) * 4
        data[i] = data[i + 1] = data[i + 2] = 0
      }
    }
  }
  const read = jsQR(data, size, size, { inversionAttempts: 'dontInvert' })
  assert.equal(read?.data, link)
  assert.equal(appLinkPath(read!.data), '/add/bob')
})
