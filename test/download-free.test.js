const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function loadRoute({ user = { google_id: 'google-user' }, signingDelay = 0 } = {}) {
  const routes = new Map()
  let userLookups = 0
  let entitlementLookups = 0
  let signedUrls = 0
  const router = {
    get(route, ...handlers) { routes.set(route, handlers.at(-1)) },
    post(route, ...handlers) { routes.set(route, handlers.at(-1)) },
  }
  const db = {
    async findUserById() { userLookups++; return user },
    async ensureSubtitleEntitlement() { entitlementLookups++; throw new Error('free download must not query the wallet') },
  }
  const modules = {
    express: { Router: () => router },
    jsonwebtoken: {},
    '../db/schema': db,
    '../middleware/auth': { authMiddleware() {}, subtitleAppAuth() {}, clientIp() {} },
    '../utils/loginAudit': { recordLoginLog() {} },
    '../utils/storage': { async getSignedDownloadUrl() {
      signedUrls++
      if (signingDelay) await new Promise(resolve => setTimeout(resolve, signingDelay))
      return 'https://storage.example/installer?signature=example'
    } },
  }
  const context = { module: { exports: {} }, require(name) {
    if (!(name in modules)) throw new Error(`unexpected module ${name}`)
    return modules[name]
  }, process: { env: {} }, console, Buffer, fetch, setTimeout }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../routes/subtitle.js'), 'utf8'), context)
  const invoke = async () => {
    const response = { statusCode: 200, headers: {}, body: null,
      status(code) { this.statusCode = code; return this },
      set(key, value) { this.headers[key] = value; return this },
      json(data) { this.body = data; return this } }
    await routes.get('/download-free')({ user: { id: 'member-1' } }, response)
    return response
  }
  return { invoke, counts: () => ({ userLookups, entitlementLookups, signedUrls }) }
}

test('free download checks only membership and reuses signed URLs', async () => {
  const route = loadRoute({ signingDelay: 40 })
  const firstStart = performance.now()
  const [first, simultaneous] = await Promise.all([route.invoke(), route.invoke()])
  const firstMs = performance.now() - firstStart
  const warmStart = performance.now()
  const warm = await route.invoke()
  const warmMs = performance.now() - warmStart
  assert.equal(first.statusCode, 200)
  assert.equal(simultaneous.statusCode, 200)
  assert.equal(warm.body.url, first.body.url)
  assert.ok(warm.body.expires_in > 0 && warm.body.expires_in <= 900)
  assert.deepEqual(route.counts(), { userLookups: 3, entitlementLookups: 0, signedUrls: 1 })
  assert.equal(warm.headers['Cache-Control'], 'private, no-store')
  console.log(`mocked signing: first ${firstMs.toFixed(1)}ms, warm ${warmMs.toFixed(1)}ms`)
})

test('non-Google members cannot obtain an installer URL', async () => {
  const route = loadRoute({ user: { google_id: null } })
  const response = await route.invoke()
  assert.equal(response.statusCode, 403)
  assert.equal(response.body.code, 'google_required')
  assert.equal(route.counts().signedUrls, 0)
})

test('download button appears before signed URL request completes', async () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/subtitle-tool.html'), 'utf8')
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  const source = scripts.at(-1)[1]
  let resolveDownload
  let requests = 0
  const elements = new Map(['st-download-actions', 'st-download-actions-bottom', 'st-msg', 'af-kakao-link']
    .map(id => [id, { innerHTML: '', href: '', hidden: false }]))
  const context = {
    document: { getElementById: id => elements.get(id), querySelectorAll: () => [] },
    API: { isLoggedIn: () => true, get: route => {
      if (route === '/subtitle/entitlement') return Promise.resolve({ ok: true })
      if (route !== '/subtitle/download-free') throw new Error(`unexpected route ${route}`)
      requests++
      return new Promise(resolve => { resolveDownload = resolve })
    } },
    fetch: async () => ({ ok: false }),
    buildGoogleAuthUrl: () => '/login', GOOGLE_ICON_SVG: '', location: { href: '' },
    console,
  }
  vm.runInNewContext(source, context)
  assert.match(elements.get('st-download-actions').innerHTML, /btn-download-free/)
  assert.equal(requests, 1)
  resolveDownload({ url: 'https://storage.example/installer', expires_in: 900 })
  await new Promise(resolve => setImmediate(resolve))
  await vm.runInNewContext('downloadFreeInstaller()', context)
  assert.equal(requests, 1)
  assert.equal(context.location.href, 'https://storage.example/installer')
})
