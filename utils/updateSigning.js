const crypto = require('crypto')

/** RFC 8032 Ed25519 서명 — tadaksync_auto/ed25519.py의 순수 파이썬 검증기와 정확히 호환된다.
 * 메시지 형식은 앱 쪽 update.py의 canonical_message()와 반드시 일치해야 한다. */
function canonicalReleaseMessage(version, sha256, size) {
  return Buffer.from(`tadaksync-auto|${version}|${String(sha256).toLowerCase()}|${Number(size)}`, 'utf8')
}

function b64ToB64Url(b64) {
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function loadUpdateSigningKey() {
  const seedB64 = String(process.env.TADAKSYNC_UPDATE_PRIVATE_KEY || '').trim()
  const pubB64 = String(process.env.TADAKSYNC_UPDATE_PUBLIC_KEY || '').trim()
  if (!seedB64 || !pubB64) return null
  return crypto.createPrivateKey({
    key: { kty: 'OKP', crv: 'Ed25519', d: b64ToB64Url(seedB64), x: b64ToB64Url(pubB64) },
    format: 'jwk',
  })
}

/** 서명을 만들 수 없으면(키 미설정) null을 반환한다 — 호출부가 그에 맞게 처리해야 한다. */
function signRelease(version, sha256, size) {
  const key = loadUpdateSigningKey()
  if (!key) return null
  const sig = crypto.sign(null, canonicalReleaseMessage(version, sha256, size), key)
  return sig.toString('base64')
}

module.exports = { canonicalReleaseMessage, signRelease }
