#!/usr/bin/env node
/** course-catalog.js에 없는 구버전 강의 및 연관 데이터 일괄 삭제 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const db = require('../db/schema')

async function main() {
  const result = await db.deleteLegacyCourses()
  console.log('✓ 구버전 강의 삭제 완료')
  console.log(`  · 삭제 강의: ${result.deleted_count}개`)
  console.log(`  · 챕터: ${result.totals.chapters} · 수강: ${result.totals.enrollments} · 후기: ${result.totals.reviews}`)
  console.log(`  · 기대평: ${result.totals.anticipation_reviews} · 진도: ${result.totals.progress} · 주문: ${result.totals.orders}`)
  if (result.deleted.length) {
    console.log('  · 삭제 목록:')
    result.deleted.forEach(c => console.log(`    - ${c.slug} (${c.title})`))
  }
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
