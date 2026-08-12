/**
 * 기존 courses 컬렉션을 정리된 courses_v2 스키마로 변환합니다.
 * courses 컬렉션은 절대 건드리지 않고, courses_v2에만 (원본과 동일한 문서 ID로) 씁니다.
 * chapters/enrollments/orders/access_codes는 course_id로만 연결되므로 이 스크립트에서
 * 손댈 필요가 없습니다 (문서 ID를 그대로 유지하기 때문).
 *
 * 재실행해도 안전합니다 — 매번 원본에서 다시 계산해서 courses_v2를 덮어씁니다.
 *
 * 사용:
 *   node scripts/migrate-courses-to-v2.js --dry-run
 *   node scripts/migrate-courses-to-v2.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const db = require('../db/schema')
const admin = require('firebase-admin')

const fs = admin.firestore()

function resolvePrice(course) {
  const sale = Number(course.sale_price != null ? course.sale_price : course.price) || 0
  const list = Number(course.price != null ? course.price : sale) || 0
  return { price: sale, list_price: list !== sale ? list : null }
}

function resolveThumbnail(course) {
  return course.thumbnail_url || course.thumbnail_image || null
}

function resolveDetailIntroImages(course) {
  if (Array.isArray(course.detail_intro_images) && course.detail_intro_images.length) {
    return course.detail_intro_images.filter(Boolean).slice(0, 30)
  }
  if (course.detail_intro_image) return [course.detail_intro_image]
  return null
}

function resolveStoreCheckoutUrls(course) {
  const urls = course.store_checkout_urls || {}
  const none = urls.none || course.store_checkout_url || null
  return {
    none: none || null,
    discount_10: urls.discount_10 || null,
    discount_20: urls.discount_20 || null,
  }
}

function transformCourse(course) {
  const kind = db.isLiveFirstCourse(course) ? 'live' : 'vod'
  const { price, list_price } = resolvePrice(course)
  const storeUrls = resolveStoreCheckoutUrls(course)

  return {
    kind,
    price,
    list_price,
    is_offline: !!course.is_offline,
    is_published: course.is_published === 1 || course.is_published === true || course.is_published === '1',
    sort_order: course.sort_order != null ? Number(course.sort_order) : 999,
    badge: course.badge || null,
    slug: course.slug,
    title: course.title || '',
    description: course.description || '',
    category: course.category || '',

    live_starts_at: kind === 'live' ? (course.live_starts_at || null) : null,
    live_ends_at: kind === 'live' ? (course.live_ends_at || null) : null,
    live_status: kind === 'live' ? (course.live_status || 'upcoming') : null,
    live_schedule_label: course.live_schedule || null,
    meet_code: course.meet_code || null,
    live_chat_url: course.live_chat_url || null,
    live_replay_url: course.live_replay_url || null,
    live_material_url: course.live_material_url || null,
    live_curriculum_text: course.live_curriculum_text || null,
    live_curriculum_image: course.live_curriculum_image || null,

    thumbnail_url: resolveThumbnail(course),
    thumbnail_icon: course.thumbnail_icon || null,
    thumb_style: course.thumb_style || null,
    hero_gallery: Array.isArray(course.hero_gallery) && course.hero_gallery.length ? course.hero_gallery : null,
    detail_intro_text: course.detail_intro_text || null,
    detail_intro_images: resolveDetailIntroImages(course),

    checkout_provider: course.checkout_provider === 'smartstore' ? 'smartstore' : 'site',
    store_checkout_urls: storeUrls,
    checkout_starts_at: course.checkout_starts_at || null,
    checkout_ends_at: course.checkout_ends_at || null,
    coupon_allowed: course.coupon_allowed !== false && course.coupon_allowed !== 0,
    enrollment_limit: Math.max(0, parseInt(course.enrollment_limit, 10) || 0),

    learning_outcomes: Array.isArray(course.learning_outcomes) && course.learning_outcomes.length ? course.learning_outcomes : null,
    target_audience: Array.isArray(course.target_audience) && course.target_audience.length ? course.target_audience : null,
    instructor_name: course.instructor_name || null,
    instructor_role: course.instructor_role || null,
    instructor_bio: course.instructor_bio || null,
    instructor_avatar: course.instructor_avatar || null,

    program_id: course.program_id || null,
    rating: course.rating || 0,
    review_count: course.review_count || 0,
    student_count: course.student_count || 0,

    created_at: course.created_at || new Date().toISOString(),
  }
}

/** 과거 course_type/delivery_mode/sale_price가 서로 모순되던 강의인지 표시 (수동 확인용) */
function detectDrift(course) {
  const flags = []
  const liveByType = course.course_type === 'live'
  const liveByMode = course.delivery_mode === 'live_first'
  if (liveByType !== liveByMode) {
    flags.push(`course_type(${course.course_type})/delivery_mode(${course.delivery_mode}) 불일치`)
  }
  if (course.checkout_provider === 'smartstore' && !(course.store_checkout_urls?.none || course.store_checkout_url)) {
    flags.push('smartstore인데 정가 링크(store_checkout_urls.none) 없음')
  }
  return flags
}

function diffKeys(existing, target) {
  if (!existing) return Object.keys(target)
  return Object.keys(target).filter(k => JSON.stringify(existing[k] ?? null) !== JSON.stringify(target[k] ?? null))
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  await new Promise(r => setTimeout(r, 1200))

  const courses = await db.getCourses(false)
  let changedCount = 0
  const driftReport = []

  for (const course of courses) {
    const target = transformCourse(course)
    const existingDoc = await fs.collection('courses_v2').doc(course.id).get()
    const existing = existingDoc.exists ? existingDoc.data() : null
    const changedKeys = diffKeys(existing, target)
    const changed = changedKeys.length > 0
    if (changed) changedCount++

    const drift = detectDrift(course)
    if (drift.length) driftReport.push({ slug: course.slug, id: course.id, drift })

    console.log(
      `${changed ? 'UPDATE' : 'skip  '} ${course.slug || course.id}` +
      ` | kind=${target.kind} price=${target.price} published=${target.is_published}` +
      `${changed ? ` | changed=[${changedKeys.join(',')}]` : ''}` +
      `${drift.length ? ` [DRIFT: ${drift.join('; ')}]` : ''}`
    )

    if (!dryRun && changed) {
      await fs.collection('courses_v2').doc(course.id).set({
        ...target,
        updated_at: new Date().toISOString(),
      }, { merge: false })
    }
  }

  console.log(`\ntotal=${courses.length} changed=${changedCount} dryRun=${dryRun}`)
  if (driftReport.length) {
    console.log(`\n⚠ 수동 확인 필요 (${driftReport.length}건):`)
    for (const d of driftReport) console.log(`  - ${d.slug} (${d.id}): ${d.drift.join('; ')}`)
  }
  process.exit(0)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
