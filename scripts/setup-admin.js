#!/usr/bin/env node
/** Firestore users 컬렉션에서 지정 이메일 계정을 관리자(role=admin)로 승격 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const admin = require('firebase-admin')
require('../db/schema')

const fs = admin.firestore()
const email = (process.argv[2] || 'dong8creative@gmail.com').toLowerCase().trim()

async function main() {
  const snap = await fs.collection('users').where('email', '==', email).limit(1).get()
  if (snap.empty) {
    console.error(`✗ ${email} 계정이 없습니다.`)
    console.error('  1) 웹사이트에서 Google 로그인으로 해당 계정을 먼저 생성하세요.')
    console.error(`  2) 다시 실행: node scripts/setup-admin.js ${email}`)
    process.exit(1)
  }
  const doc = snap.docs[0]
  await doc.ref.update({
    role: 'admin',
    profile_complete: true,
    member_type: doc.data().member_type || 'student',
  })
  console.log(`✓ ${email} → role=admin 설정 완료 (uid: ${doc.id})`)
  console.log('  .env 의 ADMIN_EMAILS에도 동일 이메일이 포함되어 있는지 확인하세요.')
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
