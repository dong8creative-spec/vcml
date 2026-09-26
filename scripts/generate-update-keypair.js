#!/usr/bin/env node
/**
 * 타닥싱크 Auto 자동 업데이트 서명용 Ed25519 키 쌍 생성.
 * 재발급이 필요할 때만 실행한다 — 실행하면 기존 개인키로 서명된 릴리스는 더 이상 검증되지 않으므로,
 * 새 공개키를 tadaksync_auto/update.py의 UPDATE_PUBLIC_KEY_B64에도 반드시 같이 반영해야 한다.
 *
 * 사용법: node scripts/generate-update-keypair.js
 */
const crypto = require('crypto')

function b64urlToB64(s) {
  return s.replace(/-/g, '+').replace(/_/g, '/')
}

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
const pubJwk = publicKey.export({ format: 'jwk' })
const privJwk = privateKey.export({ format: 'jwk' })
const pubB64 = Buffer.from(b64urlToB64(pubJwk.x), 'base64').toString('base64')
const privB64 = Buffer.from(b64urlToB64(privJwk.d), 'base64').toString('base64')

console.log('새 키 쌍이 생성되었습니다. 아래 값을 저장하세요.\n')
console.log('.env에 넣을 개인키 (절대 커밋 금지):')
console.log(`TADAKSYNC_UPDATE_PRIVATE_KEY=${privB64}`)
console.log(`TADAKSYNC_UPDATE_PUBLIC_KEY=${pubB64}`)
console.log('\ntadaksync_auto/update.py의 UPDATE_PUBLIC_KEY_B64에 넣을 공개키:')
console.log(pubB64)
