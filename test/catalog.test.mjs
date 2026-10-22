import test from 'node:test'
import assert from 'node:assert/strict'
import { SOURCES } from '../lib/sources.js'
import { KEY_NAMES } from '../lib/index.js'
import { QUOTA_SOURCES, keyNamesBySource, routeKeyNames, validateCatalog, sourceToProvider } from '../lib/vendor/catalog/index.js'

test('共有カタログの取得元と実装が一致する', () => {
  assert.deepEqual(validateCatalog(), [])
  assert.deepEqual(Object.keys(SOURCES).sort(), Object.keys(QUOTA_SOURCES).sort())
  for (const source of Object.keys(SOURCES)) assert.ok(sourceToProvider(source), source)
})

test('設定画面のキー名は共有カタログと一致する', () => {
  assert.deepEqual(KEY_NAMES, keyNamesBySource())
  assert.deepEqual(KEY_NAMES.opencode, ['OPENCODE_COOKIE', 'OPENCODE_WORKSPACE_ID'])
  assert.equal(KEY_NAMES.claude, undefined)
  assert.deepEqual(routeKeyNames().opencode, ['OPENCODE_API_KEY'])
  assert.deepEqual(KEY_NAMES.commandcode, routeKeyNames().commandcode, 'クォータとモデル登録で同じキー名')
})
