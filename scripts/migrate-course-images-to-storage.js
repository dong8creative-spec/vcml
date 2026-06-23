#!/usr/bin/env node
/**
 * base64 상세 소개·썸네일 → Firebase Storage URL 마이그레이션 (MVP)
 * 사용: node scripts/migrate-course-images-to-storage.js [--dry-run]
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })

const db = require('../db/schema')
const { uploadCourseImage } = require('../utils/storage')

const DRY = process.argv.includes('--dry-run')

function isDataUrl(value) {
  return typeof value === 'string' && value.startsWith('data:image/')
}

function mimeFromDataUrl(dataUrl) {
  const m = String(dataUrl).match(/^data:(image\/[a-z0-9.+-]+);base64,/i)
  return m ? m[1].toLowerCase() : 'image/jpeg'
}

function bufferFromDataUrl(dataUrl) {
  const b64 = String(dataUrl).split(',')[1] || ''
  return Buffer.from(b64, 'base64')
}

async function uploadDataUrl(dataUrl, { kind, courseId }) {
  const contentType = mimeFromDataUrl(dataUrl)
  const buffer = bufferFromDataUrl(dataUrl)
  return uploadCourseImage(buffer, { kind, courseId, contentType })
}

async function main() {
  const courses = await db.getCourses(false)
  let updated = 0

  for (const course of courses) {
    const patch = {}
    const images = []
    if (Array.isArray(course.detail_intro_images) && course.detail_intro_images.length) {
      for (const src of course.detail_intro_images) {
        if (isDataUrl(src)) {
          const url = await uploadDataUrl(src, { kind: 'detail-intro', courseId: course.id })
          images.push(url)
          console.log(`  detail-intro → ${url.slice(0, 80)}…`)
        } else if (src) {
          images.push(src)
        }
      }
      if (images.length) patch.detail_intro_images = images
      patch.detail_intro_image = null
    } else if (isDataUrl(course.detail_intro_image)) {
      patch.detail_intro_images = [await uploadDataUrl(course.detail_intro_image, { kind: 'detail-intro', courseId: course.id })]
      patch.detail_intro_image = null
    }

    if (isDataUrl(course.thumbnail_url)) {
      patch.thumbnail_url = await uploadDataUrl(course.thumbnail_url, { kind: 'thumbnail', courseId: course.id })
      console.log(`  thumbnail → ${patch.thumbnail_url.slice(0, 80)}…`)
    }

    if (!Object.keys(patch).length) continue
    console.log(`${DRY ? '[dry-run] ' : ''}update ${course.slug || course.id}`)
    if (!DRY) {
      await db.updateCourse(course.id, patch)
      updated++
    }
  }

  console.log(DRY ? 'dry-run complete' : `done — ${updated} course(s) updated`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
