/**
 * courses_v2 — 재설계된 강의 데이터 레이어.
 * 기존 db/schema.js(courses 컬렉션)와 완전히 분리된 병행 구조. 문서 ID를
 * courses 원본과 동일하게 유지하는 것이 전제이므로 chapters/enrollments/
 * orders/access_codes는 그대로 재사용하고 이 파일에서는 건드리지 않는다.
 */

const admin = require('firebase-admin')
const db = require('./schema') // Firebase Admin 초기화 + fs.settings()가 여기서 한 번 실행됨을 보장
const courseAccess = require('../lib/course-access')

const fs = admin.firestore()

const now = () => new Date().toISOString()

function cacheInvalidate(...keys) {
  db._cacheInvalidate(...keys)
}

// ── slug 헬퍼 (schema.js의 buildSlug/ensureUniqueSlug와 동일한 로직, 비공개라 복제) ──

function buildSlug(title, fallbackPrefix = 'course') {
  const base = String(title || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9가-힣_-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
  return base || `${fallbackPrefix}-${Date.now().toString(36)}`
}

async function ensureUniqueSlug(baseSlug, excludeId = null) {
  let candidate = baseSlug
  let n = 2
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await getCourseBySlug(candidate)
    if (!existing || existing.id === excludeId) return candidate
    candidate = `${baseSlug}-${n}`
    n += 1
  }
}

// ── 이미지 검증 (routes/admin.js의 isValidImage/isValidWebpImage와 동일한 규칙) ──

const MAX_IMAGE_LEN = 480000
const MAX_DETAIL_INTRO_IMAGE_LEN = 950000

function isStorageImageUrl(value) {
  return typeof value === 'string'
    && /^https:\/\/(storage\.googleapis\.com|firebasestorage\.googleapis\.com)\/.+/i.test(value)
}

function isValidImage(value) {
  if (!value) return true
  if (typeof value !== 'string') return false
  if (isStorageImageUrl(value)) return true
  if (/^data:image\//.test(value)) return value.length <= MAX_IMAGE_LEN
  if (/^https?:\/\/.+/i.test(value)) return true
  return false
}

function isValidWebpImage(value) {
  if (!value) return true
  if (typeof value !== 'string') return false
  if (/^data:image\/webp;base64,/.test(value)) return value.length <= MAX_DETAIL_INTRO_IMAGE_LEN
  if (isStorageImageUrl(value)) return true
  if (/^https?:\/\/.+/i.test(value)) return /\.webp(\?|#|$)/i.test(value)
  return false
}

function isValidHttpUrl(value) {
  return /^https?:\/\/.+/i.test(String(value || ''))
}

// ── 공유 검증기: 생성/수정 양쪽에서 동일하게 사용 ──
// isCreate=true면 필수값 채워서 완전한 문서를 반환, false면 body에 있는 필드만 채운 부분 업데이트를 반환.

function normalizeCourseInput(body = {}, { isCreate = false } = {}) {
  const data = {}
  const has = (key) => body[key] !== undefined

  if (isCreate || has('title')) {
    const title = String(body.title || '').trim()
    if (isCreate && !title) return { error: '제목을 입력하세요.' }
    if (has('title')) data.title = title
  }
  if (isCreate || has('category')) {
    const category = String(body.category || '').trim()
    if (isCreate && !category) return { error: '카테고리를 입력하세요.' }
    if (has('category')) data.category = category
  }
  if (has('description')) data.description = String(body.description || '').trim()
  else if (isCreate) data.description = ''

  const kind = has('kind') ? body.kind : (isCreate ? 'vod' : undefined)
  if (kind !== undefined) {
    if (kind !== 'vod' && kind !== 'live') return { error: "kind는 'vod' 또는 'live'여야 합니다." }
    data.kind = kind
  }
  const resolvedKind = kind !== undefined ? kind : undefined

  if (has('price')) data.price = Math.max(0, Number(body.price) || 0)
  else if (isCreate) data.price = 0
  if (has('list_price')) {
    const lp = body.list_price === null || body.list_price === '' ? null : Number(body.list_price)
    data.list_price = Number.isFinite(lp) ? lp : null
  }
  if (has('is_offline')) data.is_offline = !!body.is_offline
  else if (isCreate) data.is_offline = false
  if (has('is_published')) data.is_published = !!body.is_published
  else if (isCreate) data.is_published = false
  if (has('sort_order')) data.sort_order = body.sort_order != null ? Number(body.sort_order) : 999
  else if (isCreate) data.sort_order = 999
  if (has('badge')) data.badge = body.badge ? String(body.badge).trim() : null

  // 라이브 필드 — kind가 'live'인 경우에만 의미 있음. 생성 시 kind==='live'면 live_starts_at 필수.
  if (resolvedKind === 'live') {
    const startsRaw = has('live_starts_at') ? body.live_starts_at : undefined
    if (isCreate) {
      const d = startsRaw ? new Date(startsRaw) : null
      if (!d || Number.isNaN(d.getTime())) return { error: '라이브 강의 시작 일시를 입력하세요.' }
      data.live_starts_at = d.toISOString()
    } else if (has('live_starts_at')) {
      const d = body.live_starts_at ? new Date(body.live_starts_at) : null
      if (body.live_starts_at && (!d || Number.isNaN(d.getTime()))) return { error: '강의 시작일 형식이 올바르지 않습니다.' }
      data.live_starts_at = d ? d.toISOString() : null
    }
  }
  if (has('live_ends_at')) {
    const d = body.live_ends_at ? new Date(body.live_ends_at) : null
    if (body.live_ends_at && (!d || Number.isNaN(d.getTime()))) return { error: '강의 종료일 형식이 올바르지 않습니다.' }
    const startIso = data.live_starts_at
    if (d && startIso && d.getTime() <= new Date(startIso).getTime()) {
      return { error: '강의 종료일은 시작일보다 뒤여야 합니다.' }
    }
    data.live_ends_at = d ? d.toISOString() : null
  }
  if (has('live_status')) {
    if (!['upcoming', 'ended'].includes(body.live_status)) return { error: 'live_status가 올바르지 않습니다.' }
    data.live_status = body.live_status
  } else if (isCreate && resolvedKind === 'live') {
    data.live_status = 'upcoming'
  }
  if (has('live_schedule_label')) data.live_schedule_label = body.live_schedule_label ? String(body.live_schedule_label).trim() : null
  if (has('meet_code')) data.meet_code = body.meet_code ? String(body.meet_code).trim() : null
  for (const key of ['live_chat_url', 'live_replay_url', 'live_material_url']) {
    if (!has(key)) continue
    const v = body[key]
    if (v === null || v === '') { data[key] = null; continue }
    if (!isValidHttpUrl(v)) {
      const label = key === 'live_chat_url' ? '단톡방' : key === 'live_replay_url' ? '다시보기' : '자료 다운로드'
      return { error: `${label} 링크는 http:// 또는 https:// 로 시작해야 합니다.` }
    }
    data[key] = String(v).trim().slice(0, 500)
  }
  if (has('live_curriculum_text')) data.live_curriculum_text = body.live_curriculum_text ? String(body.live_curriculum_text).trim() : null
  if (has('live_curriculum_image')) {
    if (!isValidImage(body.live_curriculum_image)) return { error: '커리큘럼 이미지는 URL 또는 JPG/PNG/WebP(base64)만 사용할 수 있습니다.' }
    data.live_curriculum_image = body.live_curriculum_image || null
  }

  // 미디어
  if (has('thumbnail_url')) {
    if (!isValidImage(body.thumbnail_url)) return { error: '썸네일은 URL 또는 JPG/PNG/WebP(base64)만 사용할 수 있습니다.' }
    data.thumbnail_url = body.thumbnail_url || null
  }
  if (has('thumbnail_icon')) data.thumbnail_icon = body.thumbnail_icon ? String(body.thumbnail_icon).trim() : null
  else if (isCreate) data.thumbnail_icon = 'ti-video'
  if (has('thumb_style')) data.thumb_style = body.thumb_style === 'dark' ? 'dark' : 'light'
  if (has('hero_gallery')) {
    if (body.hero_gallery === null) data.hero_gallery = null
    else if (!Array.isArray(body.hero_gallery)) return { error: '히어로 갤러리는 배열 형식이어야 합니다.' }
    else {
      const cleaned = []
      for (const item of body.hero_gallery.slice(0, 9)) {
        const url = String(item || '').trim()
        if (!url) continue
        if (!isValidImage(url)) return { error: '히어로 갤러리 이미지는 URL 또는 JPG/PNG/WebP(base64)만 사용할 수 있습니다.' }
        cleaned.push(url)
      }
      data.hero_gallery = cleaned.length ? cleaned : null
    }
  }
  if (has('detail_intro_text')) data.detail_intro_text = body.detail_intro_text ? String(body.detail_intro_text).trim() : null
  if (has('detail_intro_images')) {
    if (body.detail_intro_images === null) data.detail_intro_images = null
    else if (!Array.isArray(body.detail_intro_images)) return { error: '상세 소개 이미지는 배열 형식이어야 합니다.' }
    else {
      const cleaned = []
      for (const item of body.detail_intro_images.slice(0, 30)) {
        const url = String(item || '').trim()
        if (!url) continue
        if (!isValidWebpImage(url)) return { error: '상세 소개 이미지는 WebP(URL 또는 base64)만 사용할 수 있습니다.' }
        cleaned.push(url)
      }
      data.detail_intro_images = cleaned.length ? cleaned : null
    }
  }

  // 결제/체크아웃
  if (has('checkout_provider')) data.checkout_provider = body.checkout_provider === 'smartstore' ? 'smartstore' : 'site'
  else if (isCreate) data.checkout_provider = (data.price > 0) ? 'smartstore' : 'site'
  if (has('store_checkout_urls')) {
    const urls = courseAccess.normalizeStoreCheckoutUrls(body.store_checkout_urls || {})
    for (const key of ['none', 'discount_10', 'discount_20']) {
      if (urls[key] && !isValidHttpUrl(urls[key])) {
        const label = key === 'none' ? '정가' : key === 'discount_10' ? '10% 할인' : '20% 할인'
        return { error: `${label} 스마트스토어 링크는 http:// 또는 https:// 로 시작해야 합니다.` }
      }
    }
    data.store_checkout_urls = urls
  } else if (isCreate) {
    data.store_checkout_urls = courseAccess.normalizeStoreCheckoutUrls({})
  }
  const effectiveProvider = data.checkout_provider
  const effectiveUrls = data.store_checkout_urls
  const effectivePublished = data.is_published
  if (effectiveProvider === 'smartstore' && effectivePublished && effectiveUrls && !effectiveUrls.none) {
    return { error: '스마트스토어 결제 시 정가(쿠폰 없음) 링크는 필수입니다.' }
  }
  if (has('checkout_starts_at') || has('checkout_ends_at')) {
    const normalized = courseAccess.normalizeCheckoutWindowInput(
      body.checkout_starts_at === '' ? null : body.checkout_starts_at,
      body.checkout_ends_at === '' ? null : body.checkout_ends_at,
    )
    if (normalized.error === 'invalid_starts') return { error: '결제 시작일 형식이 올바르지 않습니다.' }
    if (normalized.error === 'invalid_ends') return { error: '결제 마감일 형식이 올바르지 않습니다.' }
    if (normalized.error === 'invalid_range') return { error: '결제 마감일은 시작일보다 뒤여야 합니다.' }
    if (has('checkout_starts_at')) data.checkout_starts_at = normalized.checkout_starts_at
    if (has('checkout_ends_at')) data.checkout_ends_at = normalized.checkout_ends_at
  }
  if (has('coupon_allowed')) data.coupon_allowed = !!body.coupon_allowed
  else if (isCreate) data.coupon_allowed = true
  if (has('enrollment_limit')) data.enrollment_limit = Math.max(0, parseInt(body.enrollment_limit, 10) || 0)
  else if (isCreate) data.enrollment_limit = 0

  // 커리큘럼/콘텐츠
  for (const key of ['learning_outcomes', 'target_audience']) {
    if (!has(key)) continue
    if (!Array.isArray(body[key])) { data[key] = null; continue }
    const cleaned = body[key].map(s => String(s || '').trim()).filter(Boolean).slice(0, 10)
    data[key] = cleaned.length ? cleaned : null
  }
  for (const key of ['instructor_name', 'instructor_role', 'instructor_bio']) {
    if (has(key)) data[key] = body[key] ? String(body[key]).trim() : null
  }
  if (has('instructor_avatar')) {
    if (!isValidImage(body.instructor_avatar)) return { error: '강사 사진은 URL 또는 JPG/PNG/WebP(base64)만 사용할 수 있습니다.' }
    data.instructor_avatar = body.instructor_avatar || null
  }
  if (has('program_id')) data.program_id = body.program_id || null

  return { data }
}

// ── CRUD ──

async function getCourses({ publishedOnly = true } = {}) {
  const key = publishedOnly ? 'courses_v2:pub' : 'courses_v2:all'
  const cached = db._cacheGet(key)
  if (cached) return cached
  let q = fs.collection('courses_v2')
  if (publishedOnly) q = q.where('is_published', '==', true)
  const snap = await q.get()
  const items = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999))
  db._cacheSet(key, items, 60000)
  return items
}

/**
 * courses_v2 문서를 옛 courses 문서 형태(course_type/delivery_mode/sale_price/live_schedule 등)로
 * 투영한다. course.html 등 기존 렌더링·접근제어 코드(db/schema.js의 courseSupportsLiveReplay,
 * getLiveResourceAccess, usesSmartstoreCheckout, getAnticipationModifyMeta 등)를 그대로 재사용하기
 * 위한 호환 레이어 — 실제 화면 기능(탭/후기/라이브 Meet/환불보장/쿠폰등급 결제 등)을 새로 베끼지 않고
 * 검증된 기존 코드에 courses_v2 데이터를 흘려보내기 위함이다.
 */
function toLegacyShape(course) {
  if (!course) return course
  const isLive = course.kind === 'live'
  return {
    ...course,
    course_type: isLive ? 'live' : 'recorded',
    delivery_mode: isLive ? 'live_first' : 'vod_only',
    sale_price: course.price,
    price: course.list_price != null ? course.list_price : course.price,
    live_schedule: course.live_schedule_label || null,
  }
}

async function getCourseById(id) {
  if (!id) return null
  const doc = await fs.collection('courses_v2').doc(id).get()
  return doc.exists ? { id: doc.id, ...doc.data() } : null
}

async function getCourseBySlug(slug) {
  if (!slug) return null
  const snap = await fs.collection('courses_v2').where('slug', '==', slug).limit(1).get()
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() }
}

async function createCourse(body) {
  const { data, error } = normalizeCourseInput(body, { isCreate: true })
  if (error) return { error }
  const slug = await ensureUniqueSlug(buildSlug(data.title))
  const full = {
    ...data,
    slug,
    rating: 0,
    review_count: 0,
    student_count: 0,
    program_id: data.program_id ?? null,
    created_at: now(),
    updated_at: now(),
  }
  const ref = await fs.collection('courses_v2').add(full)
  cacheInvalidate('courses_v2:pub', 'courses_v2:all')
  return { id: ref.id, ...full }
}

async function updateCourse(id, body) {
  const existing = await getCourseById(id)
  if (!existing) return { error: 'not_found' }
  const { data, error } = normalizeCourseInput(body, { isCreate: false })
  if (error) return { error }
  if (Object.keys(data).length === 0) return { error: '변경할 항목이 없습니다.' }
  // 스마트스토어 필수 링크 검증은 provider/urls 중 하나만 바뀌어도 최신 값 기준으로 재확인
  const provider = data.checkout_provider ?? existing.checkout_provider
  const urls = data.store_checkout_urls ?? existing.store_checkout_urls
  const published = data.is_published ?? existing.is_published
  if (provider === 'smartstore' && published && (!urls || !urls.none)) {
    return { error: '스마트스토어 결제 시 정가(쿠폰 없음) 링크는 필수입니다.' }
  }
  if (data.title && data.title !== existing.title) {
    data.slug = await ensureUniqueSlug(buildSlug(data.title), id)
  }
  data.updated_at = now()
  await fs.collection('courses_v2').doc(id).update(data)
  cacheInvalidate('courses_v2:pub', 'courses_v2:all')
  return await getCourseById(id)
}

// 기존 db.createChapter는 내부적으로 구 courses 컬렉션에서 존재를 확인하므로
// courses_v2에만 있는(마이그레이션되지 않은 신규) 강의에는 쓸 수 없다. 동일한
// Firestore 쓰기 로직을 courses_v2 기준 존재 확인으로 바꿔 얇게 재구현한다.
async function createChapter(courseId, data = {}) {
  const course = await getCourseById(courseId)
  if (!course) return { error: 'course_not_found' }
  const chapters = await db.getChaptersByCourse(courseId)
  const maxOrder = chapters.reduce((m, c) => Math.max(m, Number(c.order_num) || 0), 0)
  const title = String(data.title || '').trim()
  if (!title) return { error: 'title_required' }
  const payload = {
    course_id: courseId,
    order_num: Number(data.order_num) > 0 ? Number(data.order_num) : maxOrder + 1,
    title,
    duration: String(data.duration || '').trim() || null,
    is_free: !!data.is_free,
    video_url: String(data.video_url || '').trim() || null,
  }
  const ref = await fs.collection('chapters').add(payload)
  cacheInvalidate(`chapters:${courseId}`)
  return { id: ref.id, ...payload }
}

module.exports = {
  normalizeCourseInput,
  getCourses,
  getCourseById,
  getCourseBySlug,
  createCourse,
  updateCourse,
  createChapter,
  buildSlug,
  ensureUniqueSlug,
  toLegacyShape,
  // 챕터 조회/수정/삭제/이동, 수강/주문/선물코드는 문서 ID 공유 설계 덕분에
  // 기존 함수를 그대로 재사용한다 (course 존재 검증을 하지 않는 함수들이다).
  getChaptersByCourse: db.getChaptersByCourse,
  updateChapter: db.updateChapter,
  deleteChapter: db.deleteChapter,
  moveChapter: db.moveChapter,
  isEnrolled: db.isEnrolled,
  getEnrollmentRecord: db.getEnrollmentRecord,
  getActiveOrderForCourse: db.getActiveOrderForCourse,
  getPendingGiftReservation: db.getPendingGiftReservation,
  getProgramForCourse: db.getProgramForCourse,
}
