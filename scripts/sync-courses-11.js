#!/usr/bin/env node
/** Firestore 강의 목록을 course-catalog.js(11개) 기준으로 동기화 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const db = require('../db/schema')

async function sync() {
  const result = await db.syncCoursesFromCatalog()
  console.log('✓ 강의 카탈로그 동기화 완료')
  console.log(`  · 카탈로그: ${result.catalog_count}개`)
  console.log(`  · 갱신: ${result.updated}개`)
  console.log(`  · 신규 생성: ${result.created}개`)
  console.log(`  · 구버전 비공개 처리: ${result.unpublished}개`)
  process.exit(0)
}

sync().catch(e => { console.error(e); process.exit(1) })
