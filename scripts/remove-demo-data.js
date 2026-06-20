#!/usr/bin/env node
/** Firestore 데모·테스트 데이터 일괄 삭제 (가짜 후기, 테스트 계정, 샘플 의뢰 등)
 *  수강생 테스트 계정 demo@tadakclass.com 은 유지합니다. */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const admin = require('firebase-admin')
require('../db/schema')

const fs = admin.firestore()

/** 삭제 대상 테스트 계정 (수강생 demo@ 는 제외) */
const DEMO_EMAILS = [
  'client@tadakclass.com',
  'editor@tadakclass.com',
  'admin@tadakclass.com',
]

async function deleteDocs(docs) {
  if (!docs.length) return 0
  const batch = fs.batch()
  docs.forEach(d => batch.delete(d.ref))
  await batch.commit()
  return docs.length
}

async function deleteByUserId(userId) {
  const collections = [
    'enrollments', 'progress', 'orders', 'coupons', 'reviews',
    'workbook_submissions', 'editor_applications', 'support_tickets',
  ]
  let total = 0
  for (const col of collections) {
    const snap = await fs.collection(col).where('user_id', '==', userId).get()
    total += await deleteDocs(snap.docs)
  }
  await fs.collection('editor_programs').doc(userId).delete().catch(() => {})
  return total
}

async function deleteProjectCascade(projectId) {
  const [quotes, messages] = await Promise.all([
    fs.collection('quotes').where('project_id', '==', projectId).get(),
    fs.collection('messages').where('project_id', '==', projectId).get(),
  ])
  await deleteDocs(quotes.docs)
  await deleteDocs(messages.docs)
  await fs.collection('projects').doc(projectId).delete()
}

async function recalcCourseRatings() {
  const courses = await fs.collection('courses').get()
  for (const doc of courses.docs) {
    const revSnap = await fs.collection('reviews')
      .where('course_id', '==', doc.id)
      .where('is_public', '==', 1)
      .get()
    const reviews = revSnap.docs.map(d => d.data())
    const count = reviews.length
    const rating = count
      ? Math.round(reviews.reduce((s, r) => s + (r.rating || 0), 0) / count * 10) / 10
      : 0
    await doc.ref.update({ rating, review_count: count })
  }
}

async function main() {
  const counts = {}

  // 시드 플랫폼 후기 삭제
  const prSnap = await fs.collection('platform_reviews').get()
  const seedReviews = prSnap.docs.filter(d => d.data().seed_key)
  counts.platform_reviews = await deleteDocs(seedReviews)

  // 테스트 의뢰 (seed_key 또는 [테스트] 제목)
  const projSnap = await fs.collection('projects').get()
  const testProjects = projSnap.docs.filter(d => {
    const p = d.data()
    return p.seed_key || (p.title && String(p.title).includes('[테스트]'))
  })
  for (const doc of testProjects) {
    await deleteProjectCascade(doc.id)
  }
  counts.projects = testProjects.length

  // 테스트 계정 및 연관 데이터 삭제
  counts.users = 0
  for (const email of DEMO_EMAILS) {
    const snap = await fs.collection('users').where('email', '==', email).limit(1).get()
    if (snap.empty) continue
    const userId = snap.docs[0].id
    await deleteByUserId(userId)
    await snap.docs[0].ref.delete()
    counts.users++
  }

  // 강의 평점·후기 수 실제 데이터 기준 재계산
  await recalcCourseRatings()
  counts.courses_recalculated = (await fs.collection('courses').get()).size

  console.log('✓ 데모·테스트 데이터 삭제 완료')
  Object.entries(counts).forEach(([k, n]) => console.log(`  · ${k}: ${n}`))
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
