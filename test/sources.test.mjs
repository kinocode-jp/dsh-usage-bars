import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { getJson, MAX_BODY, findKey, setCredentialResolver } from '../lib/util.js'
import { createClaudeFetcher, antigravityPorts } from '../lib/sources.js'

test('Claude: first 429 honors Retry-After without a previous success', async () => {
  let now = 1000000, calls = 0
  const fetcher = createClaudeFetcher({ now: () => now, tokens: async () => [{ token: 'fake', expiresAt: 0, from: 'test' }], request: async () => { calls++; return { status: 429, retryAfter: 3600 } } })
  assert.match((await fetcher()).error, /60分/)
  now += 5 * 60000; await fetcher(); assert.equal(calls, 1)
  now += 55 * 60000; await fetcher(); assert.equal(calls, 2)
})

test('Claude: account changes cannot reuse previous account usage', async () => {
  let token = 'one', calls = 0
  const fetcher = createClaudeFetcher({ tokens: async () => [{ token, expiresAt: 0 }], request: async () => ++calls === 1 ? { ok: true, status: 200, data: { five_hour: { utilization: 80 } } } : { status: 429, retryAfter: 3600 } })
  assert.equal((await fetcher()).bars[0].usedPercent, 80)
  token = 'two'; const result = await fetcher()
  assert.equal(result.status, 'error'); assert.deepEqual(result.bars, [])
})

test('Response body: stop and cancel stream at 2MB rather than parsing truncated success', async () => {
  let cancelled = false, reads = 0
  const stream = new ReadableStream({ pull(c) { reads++; c.enqueue(new Uint8Array(256 * 1024)) }, cancel() { cancelled = true } })
  await assert.rejects(getJson('https://example.invalid', {}, { fetchImpl: async () => new Response(stream) }), { code: 'RESPONSE_TOO_LARGE' })
  assert.equal(cancelled, true); assert.ok(reads <= MAX_BODY / (256 * 1024) + 2)
})

test('Shared fetch: redirects manual, valid small JSON, Retry-After HTTP-date', async () => {
  const r = await getJson('https://example.invalid', {}, { fetchImpl: async (_u, init) => {
    assert.equal(init.redirect, 'manual')
    return new Response('{"ok":true}', { headers: { 'retry-after': new Date(Date.now() + 120000).toUTCString() } })
  } })
  assert.deepEqual(r.data, { ok: true }); assert.ok(r.retryAfter > 118)
})

test('Antigravity: AND PID/TCP/LISTEN filters, validate PID and deduplicate owned ports', async () => {
  let called = false
  const ports = await antigravityPorts('42', async (bin, args, opts) => {
    called = true; assert.equal(bin, 'lsof'); assert.ok(args.includes('-a')); assert.equal(args[args.indexOf('-p') + 1], '42'); assert.ok(opts.timeout)
    return { stdout: 'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\nserver 42 u 1u IPv4 x 0 TCP 127.0.0.1:1234 (LISTEN)\nother 99 u 2u IPv4 x 0 TCP 127.0.0.1:9999 (LISTEN)\nserver 42 u 3u IPv6 x 0 TCP [::1]:1234 (LISTEN)' }
  })
  assert.equal(called, true); assert.deepEqual(ports, ['1234'])
  assert.deepEqual(await antigravityPorts('42;bad', () => assert.fail('must not run')), [])
})

test('DeepSeek reads saved plugin key, never real HOME credentials', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-bars-source-'))
  const oldHome = process.env.DSH_HOME, oldKey = process.env.DEEPSEEK_API_KEY, originalFetch = globalThis.fetch
  try {
    process.env.DSH_HOME = dir; delete process.env.DEEPSEEK_API_KEY
    await fs.mkdir(path.join(dir, 'storages/usage-bars'), { recursive: true })
    await fs.writeFile(path.join(dir, 'storages/usage-bars/config.json'), JSON.stringify({ keys: { DEEPSEEK_API_KEY: 'fake-saved-key' } }))
    globalThis.fetch = async (url, init) => {
      assert.equal(url, 'https://api.deepseek.com/user/balance'); assert.equal(init.headers.authorization, 'Bearer fake-saved-key')
      return new Response('{"balance_infos":[{"currency":"USD","total_balance":"12.34"}]}')
    }
    const moduleUrl = pathToFileURL(path.resolve('lib/sources.js')).href + '?isolated=deepseek'
    const { fetchDeepSeek } = await import(moduleUrl)
    assert.equal((await fetchDeepSeek()).text, '$12.34 USD')
  } finally {
    globalThis.fetch = originalFetch
    if (oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldHome
    if (oldKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = oldKey
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('キーはDSH資格情報を最優先し、無ければ設定ファイルを見る', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-bars-keys-'))
  const previous = process.env.DSH_HOME, oldResolver = undefined
  try {
    process.env.DSH_HOME = dir
    await fs.mkdir(path.join(dir, 'storages/usage-bars'), { recursive: true })
    await fs.writeFile(path.join(dir, 'storages/usage-bars/config.json'), JSON.stringify({ keys: { DEEPSEEK_API_KEY: 'from-config' } }))
    assert.equal(await findKey(['DEEPSEEK_API_KEY']), 'from-config')
    setCredentialResolver(async name => name === 'DEEPSEEK_API_KEY' ? 'from-credentials' : '')
    assert.equal(await findKey(['DEEPSEEK_API_KEY']), 'from-credentials')
    setCredentialResolver(async () => { throw new Error('broken') })
    assert.equal(await findKey(['DEEPSEEK_API_KEY']), 'from-config')
  } finally {
    setCredentialResolver(null)
    if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous
    await fs.rm(dir, { recursive: true, force: true })
  }
})
