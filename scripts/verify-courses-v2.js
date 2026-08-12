/**
 * courses -> courses_v2 마이그레이션 검증 리포트 (읽기 전용, courses_v2에도 쓰지 않음).
 *
 * 사용: node scripts/verify-courses-v2.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const db = require('../db/schema')
const admin = require('firebase-admin')

const fs = admin.firestore()

function isEmpty(v) {
  if (v === null || v === undefined || v === '') return true
  if (Array.isArray(v)) return v.length === 0
  return false
}

async function main() {
  await new Promise(r => setTimeout(r, 1200))

  const oldCourses = await db.getCourses(false)
  const newSnap = await fs.collection('courses_v2').get()
  const newById = new Map(newSnap.docs.map(d => [d.id, { id: d.id, ...d.data() }]))

  console.log(`courses(원본)=${oldCourses.length}  courses_v2=${newById.size}\n`)

  const missing = oldCourses.filter(c => !newById.has(c.id))
  if (missing.length) {
    console.log(`❌ courses_v2에 없는 원본 강의 (${missing.length}건) — 마이그레이션 미실행:`)
    for (const c of missing) console.log(`  - ${c.slug || c.id}`)
    console.log('')
  }

  const orphans = [...newById.values()].filter(c => !oldCourses.some(o => o.id === c.id))
  if (orphans.length) {
    console.log(`⚠ 원본에 없는 courses_v2 문서 (${orphans.length}건, 원본이 이후 삭제되었을 가능성):`)
    for (const c of orphans) console.log(`  - ${c.slug || c.id}`)
    console.log('')
  }

  // 필드 손실 여부: 원본에 값이 있는데 courses_v2에서 사라진 케이스
  const lossReport = []
  for (const old of oldCourses) {
    const v2 = newById.get(old.id)
    if (!v2) continue
    const checks = [
      ['thumbnail_url/thumbnail_image', old.thumbnail_url || old.thumbnail_image, v2.thumbnail_url],
      ['detail_intro_images/detail_intro_image', (old.detail_intro_images?.length ? old.detail_intro_images : old.detail_intro_image), v2.detail_intro_images],
      ['store_checkout_urls.none/store_checkout_url', (old.store_checkout_urls?.none || old.store_checkout_url), v2.store_checkout_urls?.none],
      ['hero_gallery', old.hero_gallery, v2.hero_gallery],
      ['learning_outcomes', old.learning_outcomes, v2.learning_outcomes],
      ['target_audience', old.target_audience, v2.target_audience],
      ['program_id', old.program_id, v2.program_id],
    ]
    for (const [label, oldVal, newVal] of checks) {
      if (!isEmpty(oldVal) && isEmpty(newVal)) {
        lossReport.push(`${old.slug || old.id}: ${label} 손실`)
      }
    }
  }
  if (lossReport.length) {
    console.log(`❌ 필드 손실 의심 (${lossReport.length}건):`)
    lossReport.forEach(l => console.log(`  - ${l}`))
    console.log('')
  } else {
    console.log('✅ 필드 손실 없음\n')
  }

  // course_type/delivery_mode 모순 강의 (kind 결정 시 수동 확인 필요)
  const drift = oldCourses.filter(c => (c.course_type === 'live') !== (c.delivery_mode === 'live_first'))
  if (drift.length) {
    console.log(`⚠ course_type/delivery_mode 모순 (${drift.length}건, kind 자동판정값을 직접 확인하세요):`)
    for (const c of drift) {
      const v2 = newById.get(c.id)
      console.log(`  - ${c.slug}: course_type=${c.course_type} delivery_mode=${c.delivery_mode} sale_price=${c.sale_price} → kind=${v2?.kind}`)
    }
    console.log('')
  }

  // smartstore인데 정가 링크 없는 강의
  const badSmartstore = [...newById.values()].filter(c => c.checkout_provider === 'smartstore' && !c.store_checkout_urls?.none)
  if (badSmartstore.length) {
    console.log(`⚠ smartstore 결제인데 정가 링크 없음 (${badSmartstore.length}건):`)
    for (const c of badSmartstore) console.log(`  - ${c.slug || c.id}`)
    console.log('')
  }

  const ok = !missing.length && !lossReport.length && !badSmartstore.length
  console.log(ok ? '✅ 검증 통과' : '⚠ 위 항목 확인 필요')
  process.exit(0)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
