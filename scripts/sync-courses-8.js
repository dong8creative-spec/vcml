#!/usr/bin/env node
/** Firestore 강의 목록을 8개(3/3/2) 구성으로 교체 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const admin = require('firebase-admin')
require('../db/schema')

const fs = admin.firestore()

const COURSES = [
  { slug:'capcut-pro-1', title:'캡컷프로', category:'영상 편집', description:'캡컷프로 강의', thumbnail_icon:'ti-device-mobile', thumb_style:'light', price:89000, sale_price:69000, badge:'NEW', rating:4.8, review_count:0, student_count:0, is_published:1, course_type:'recorded' },
  { slug:'premiere-pro-1', title:'프리미어 프로', category:'영상 편집', description:'프리미어 프로 강의', thumbnail_icon:'ti-cut', thumb_style:'dark', price:120000, sale_price:89000, badge:'BEST', rating:4.9, review_count:0, student_count:0, is_published:1, course_type:'recorded' },
  { slug:'ai-detail-page-1', title:'AI를 활용한 상세페이지', category:'AI·웹', description:'AI 상세페이지 강의', thumbnail_icon:'ti-robot', thumb_style:'light', price:99000, sale_price:79000, badge:'NEW', rating:4.8, review_count:0, student_count:0, is_published:1, course_type:'recorded' },
  { slug:'vibe-coding-1', title:'바이브코딩', category:'AI·웹', description:'바이브코딩 강의', thumbnail_icon:'ti-code', thumb_style:'dark', price:89000, sale_price:69000, badge:null, rating:4.7, review_count:0, student_count:0, is_published:1, course_type:'recorded' },
  { slug:'capcut-pro-2', title:'캡컷프로', category:'영상 편집', description:'캡컷프로 강의', thumbnail_icon:'ti-device-mobile', thumb_style:'dark', price:89000, sale_price:69000, badge:null, rating:4.8, review_count:0, student_count:0, is_published:1, course_type:'recorded' },
  { slug:'premiere-pro-2', title:'프리미어 프로', category:'영상 편집', description:'프리미어 프로 강의', thumbnail_icon:'ti-cut', thumb_style:'light', price:120000, sale_price:89000, badge:null, rating:4.9, review_count:0, student_count:0, is_published:1, course_type:'recorded' },
  { slug:'ai-detail-page-2', title:'AI를 활용한 상세페이지', category:'AI·웹', description:'AI 상세페이지 강의', thumbnail_icon:'ti-robot', thumb_style:'dark', price:99000, sale_price:79000, badge:null, rating:4.8, review_count:0, student_count:0, is_published:1, course_type:'recorded' },
  { slug:'vibe-coding-2', title:'바이브코딩', category:'AI·웹', description:'바이브코딩 강의', thumbnail_icon:'ti-code', thumb_style:'light', price:89000, sale_price:69000, badge:null, rating:4.7, review_count:0, student_count:0, is_published:1, course_type:'recorded' },
]

const TARGET_SLUGS = new Set(COURSES.map(c => c.slug))
const now = () => new Date().toISOString()

async function sync() {
  const snap = await fs.collection('courses').get()
  let batch = fs.batch()
  let n = 0

  for (const doc of snap.docs) {
    const slug = doc.data().slug
    if (TARGET_SLUGS.has(slug)) {
      batch.update(doc.ref, { ...COURSES.find(c => c.slug === slug), updated_at: now() })
    } else {
      batch.update(doc.ref, { is_published: 0, updated_at: now() })
    }
    n++
    if (n % 400 === 0) { await batch.commit(); batch = fs.batch() }
  }
  if (n % 400 !== 0) await batch.commit()

  for (const c of COURSES) {
    const existing = await fs.collection('courses').where('slug', '==', c.slug).limit(1).get()
    if (existing.empty) {
      const ref = await fs.collection('courses').add({ ...c, created_at: now() })
      await fs.collection('chapters').add({ course_id: ref.id, order_num: 1, title: '강의 소개', duration: '10분', is_free: 1, video_url: null })
    }
  }

  console.log('✓ 강의 8개(3/3/2) 동기화 완료')
  process.exit(0)
}

sync().catch(e => { console.error(e); process.exit(1) })
