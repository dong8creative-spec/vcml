const router = require('express').Router()
const multer = require('multer')
const db = require('../db/schema')
const { getTotalMailCountFromConfig } = require('../db/schema')
const { adminMiddleware } = require('../middleware/auth')
const { sendLiveInviteMessage } = require('../utils/kakaoMessage')
const { uploadCourseImage } = require('../utils/storage')

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
})

router.use(adminMiddleware)

router.post('/uploads', upload.single('file'), async (req, res) => {
  try {
    const kind = String(req.body?.kind || '').trim()
    const courseId = String(req.body?.course_id || '').trim()
    if (!['detail-intro', 'thumbnail'].includes(kind)) {
      return res.status(400).json({ error: '유효하지 않은 업로드 종류입니다.' })
    }
    if (!req.file?.buffer?.length) {
      return res.status(400).json({ error: '파일을 선택해주세요.' })
    }
    const ct = String(req.file.mimetype || '').toLowerCase()
    if (kind === 'detail-intro') {
      if (ct !== 'image/webp') {
        return res.status(400).json({ error: '상세 소개 이미지는 WebP만 업로드할 수 있습니다.' })
      }
    } else if (!['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(ct)) {
      return res.status(400).json({ error: 'JPEG, PNG, WebP만 업로드할 수 있습니다.' })
    }
    if (kind === 'thumbnail' && req.file.size > 2 * 1024 * 1024) {
      return res.status(400).json({ error: '2MB 이하 이미지만 업로드할 수 있습니다.' })
    }
    const url = await uploadCourseImage(req.file.buffer, {
      kind,
      courseId: courseId || 'draft',
      contentType: ct === 'image/jpg' ? 'image/jpeg' : ct,
    })
    res.json({ success: true, url })
  } catch (e) {
    console.error('[admin/uploads]', e)
    res.status(500).json({ error: e.message || '업로드에 실패했습니다.' })
  }
})

router.get('/dashboard', async (req, res) => {
  const [stats, allOrders, courseStats, allReviews] = await Promise.all([
    db.getStats(),
    db.getAllOrders(),
    db.getCourseStats(),
    db.getAllReviews(),
  ])
  const orderSlice = allOrders.slice(0, 5)
  const reviewSlice = allReviews.slice(0, 5)
  const userIds = [...new Set([
    ...orderSlice.map(o => o.user_id),
    ...reviewSlice.map(r => r.user_id),
  ].filter(Boolean))]
  const courseIds = [...new Set([
    ...orderSlice.map(o => o.course_id),
    ...reviewSlice.map(r => r.course_id),
  ].filter(Boolean))]
  const [userMap, courseMap] = await Promise.all([
    db.batchGetUsers(userIds),
    db.batchGetCourses(courseIds),
  ])
  res.json({
    stats,
    orders: orderSlice.map(o => ({
      ...o,
      user_name: userMap[o.user_id]?.name,
      email: userMap[o.user_id]?.email,
      course_title: courseMap[o.course_id]?.title,
    })),
    courseStats,
    reviews: reviewSlice.map(r => ({
      ...r,
      user_name: userMap[r.user_id]?.name,
      course_title: courseMap[r.course_id]?.title,
    })),
  })
})

router.get('/stats', async (req, res) => {
  res.json(await db.getStats())
})

router.get('/coupons', async (req, res) => {
  res.json(await db.getAdminCouponReport())
})

router.get('/coupon-issuance', async (req, res) => {
  res.json(await db.getCouponIssuanceConfig())
})

router.patch('/coupon-issuance', async (req, res) => {
  const config = await db.updateCouponIssuanceConfig(req.body)
  res.json({ success: true, config })
})

router.get('/orders', async (req, res) => {
  const orders = await db.getAllOrders()
  const userIds = [...new Set(orders.map(o => o.user_id).filter(Boolean))]
  const courseIds = [...new Set(orders.map(o => o.course_id).filter(Boolean))]
  const [userMap, courseMap] = await Promise.all([
    db.batchGetUsers(userIds),
    db.batchGetCourses(courseIds),
  ])
  res.json(orders.map(o => ({
    ...o,
    user_name: userMap[o.user_id]?.name,
    email: userMap[o.user_id]?.email,
    course_title: courseMap[o.course_id]?.title,
  })))
})

router.get('/students', async (req, res) => {
  res.json(await db.getAllStudents())
})

router.get('/reviews', async (req, res) => {
  const reviews = await db.getAllReviews()
  const userIds = [...new Set(reviews.map(r => r.user_id).filter(Boolean))]
  const courseIds = [...new Set(reviews.map(r => r.course_id).filter(Boolean))]
  const [userMap, courseMap] = await Promise.all([
    db.batchGetUsers(userIds),
    db.batchGetCourses(courseIds),
  ])
  res.json(reviews.map(r => ({
    ...r,
    user_name: userMap[r.user_id]?.name,
    course_title: courseMap[r.course_id]?.title,
  })))
})

router.patch('/reviews/:id', async (req, res) => {
  await db.updateReviewPublic(req.params.id, req.body.is_public)
  res.json({ success: true })
})

router.delete('/reviews/:id', async (req, res) => {
  await db.deleteReview(req.params.id)
  res.json({ success: true })
})

router.get('/courses', async (req, res) => {
  const { TARGET_SLUGS } = require('../db/course-catalog')
  const courses = await db.getCourses(false)
  const enriched = await Promise.all(courses.map(async c => {
    const row = {
      ...(await db.enrichCourseEnrollment(c, { liveCount: true })),
      is_catalog: TARGET_SLUGS.has(c.slug),
    }
    if (Number(c.student_count || 0) !== Number(row.student_count || 0)) {
      await db.updateCourse(c.id, { student_count: row.student_count })
    }
    return row
  }))
  res.json(enriched)
})

router.get('/courses/:id/enrollments', async (req, res) => {
  const course = await db.getCourseById(req.params.id)
  if (!course) return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })
  const enrollments = await db.getActiveEnrolleesByCourse(course.id)
  await db.syncCourseStudentCount(course.id)
  res.json({
    course: { id: course.id, title: course.title },
    count: enrollments.length,
    enrollments,
  })
})

router.get('/courses/:id/chapters', async (req, res) => {
  const course = await db.getCourseById(req.params.id)
  if (!course) return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })
  const chapters = await db.getChaptersByCourse(course.id)
  res.json({
    course: {
      id: course.id,
      title: course.title,
      slug: course.slug,
      course_type: course.course_type,
      live_curriculum_text: course.live_curriculum_text || null,
      live_curriculum_image: course.live_curriculum_image || null,
      detail_intro_text: course.detail_intro_text || null,
      detail_intro_images: normalizeDetailIntroImages(course),
      detail_intro_image: course.detail_intro_image || null,
    },
    chapters,
  })
})

router.post('/courses/:id/chapters', async (req, res) => {
  const course = await db.getCourseById(req.params.id)
  if (!course) return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })
  const result = await db.createChapter(course.id, req.body)
  if (result.error === 'title_required') {
    return res.status(400).json({ error: '챕터 제목을 입력해주세요.' })
  }
  res.json({ success: true, chapter: result })
})

router.patch('/chapters/:id', async (req, res) => {
  const result = await db.updateChapter(req.params.id, req.body)
  if (result?.error === 'not_found') return res.status(404).json({ error: '챕터를 찾을 수 없습니다.' })
  if (result?.error === 'title_required') return res.status(400).json({ error: '챕터 제목을 입력해주세요.' })
  res.json({ success: true, chapter: result })
})

router.delete('/chapters/:id', async (req, res) => {
  const result = await db.deleteChapter(req.params.id)
  if (result?.error === 'not_found') return res.status(404).json({ error: '챕터를 찾을 수 없습니다.' })
  res.json({ success: true })
})

router.post('/chapters/:id/move', async (req, res) => {
  const direction = req.body?.direction === 'up' ? 'up' : 'down'
  const result = await db.moveChapter(req.params.id, direction)
  if (result?.error === 'not_found') return res.status(404).json({ error: '챕터를 찾을 수 없습니다.' })
  if (result?.error === 'cannot_move') return res.status(400).json({ error: '더 이상 이동할 수 없습니다.' })
  res.json({ success: true, chapters: result })
})

router.post('/courses/sync-catalog', async (req, res) => {
  const result = await db.syncCoursesFromCatalog()
  res.json({ success: true, ...result })
})

router.post('/courses/delete-legacy', async (req, res) => {
  const includeLive = !!req.body?.include_live
  const result = await db.deleteLegacyCourses({ includeLive })
  res.json({ success: true, ...result })
})

router.patch('/courses/:id', async (req, res) => {
  const allowed = [
    'title', 'description', 'category', 'price', 'sale_price', 'is_published',
    'course_type', 'live_schedule', 'live_starts_at', 'meet_code', 'live_status',
    'live_curriculum_text', 'live_curriculum_image', 'detail_intro_text', 'detail_intro_image', 'detail_intro_images', 'live_chat_url',
    'live_replay_url', 'live_material_url',
    'badge', 'thumbnail_icon', 'thumb_style', 'thumbnail_url', 'hero_gallery', 'sort_order', 'is_offline', 'enrollment_limit',
    'learning_outcomes', 'target_audience', 'instructor_name', 'instructor_role', 'instructor_bio', 'instructor_avatar',
  ]
  const update = {}
  for (const key of allowed) {
    if (req.body[key] !== undefined) update[key] = req.body[key]
  }
  if (update.thumbnail_url !== undefined && update.thumbnail_url !== null && update.thumbnail_url !== '' && !isValidImage(update.thumbnail_url)) {
    return res.status(400).json({ error: '썸네일은 URL 또는 JPG/PNG/WebP(base64)만 사용할 수 있습니다.' })
  }
  if (update.hero_gallery !== undefined) {
    if (update.hero_gallery === null || update.hero_gallery === '') {
      update.hero_gallery = null
    } else if (!Array.isArray(update.hero_gallery)) {
      return res.status(400).json({ error: '히어로 갤러리는 배열 형식이어야 합니다.' })
    } else {
      const cleaned = []
      for (const item of update.hero_gallery.slice(0, 9)) {
        const url = String(item || '').trim()
        if (!url) continue
        if (!isValidImage(url)) {
          return res.status(400).json({ error: '히어로 갤러리 이미지는 URL 또는 JPG/PNG/WebP(base64)만 사용할 수 있습니다.' })
        }
        cleaned.push(url)
      }
      update.hero_gallery = cleaned.length ? cleaned : null
    }
  }
  for (const key of ['live_chat_url', 'live_replay_url', 'live_material_url']) {
    if (update[key] === undefined) continue
    if (update[key] === null || update[key] === '') {
      update[key] = null
      continue
    }
    const url = String(update[key]).trim()
    if (!/^https?:\/\/.+/i.test(url)) {
      const label = key === 'live_chat_url' ? '단톡방' : key === 'live_replay_url' ? '다시보기' : '자료 다운로드'
      return res.status(400).json({ error: `${label} 링크는 http:// 또는 https:// 로 시작해야 합니다.` })
    }
    update[key] = url.slice(0, 500)
  }
  if (update.detail_intro_images !== undefined) {
    if (update.detail_intro_images === null || update.detail_intro_images === '') {
      update.detail_intro_images = null
      update.detail_intro_image = null
    } else if (!Array.isArray(update.detail_intro_images)) {
      return res.status(400).json({ error: '상세 소개 이미지는 배열 형식이어야 합니다.' })
    } else {
      const cleaned = []
      for (const item of update.detail_intro_images.slice(0, 10)) {
        const url = String(item || '').trim()
        if (!url) continue
        if (url.startsWith('data:') && url.length > MAX_DETAIL_INTRO_IMAGE_LEN) {
          return res.status(400).json({ error: '상세 소개 이미지 용량이 너무 큽니다. WebP 파일을 줄여서 다시 업로드해주세요.' })
        }
        if (!isValidWebpImage(url)) {
          return res.status(400).json({ error: '상세 소개 이미지는 WebP(URL 또는 base64)만 사용할 수 있습니다.' })
        }
        cleaned.push(url)
      }
      update.detail_intro_images = cleaned.length ? cleaned : null
      update.detail_intro_image = null
    }
  }
  if (update.detail_intro_image !== undefined && update.detail_intro_image !== null && update.detail_intro_image !== '') {
    if (typeof update.detail_intro_image === 'string' && update.detail_intro_image.length > MAX_DETAIL_INTRO_IMAGE_LEN) {
      return res.status(400).json({ error: '상세 소개 이미지 용량이 너무 큽니다. 더 작은 이미지를 업로드해주세요.' })
    }
    if (!isValidWebpImage(update.detail_intro_image)) {
      return res.status(400).json({ error: '상세 소개 이미지는 WebP(URL 또는 base64)만 사용할 수 있습니다.' })
    }
  }
  if (update.detail_intro_text !== undefined) {
    update.detail_intro_text = String(update.detail_intro_text || '').trim() || null
  }
  for (const key of ['learning_outcomes', 'target_audience']) {
    if (update[key] === undefined) continue
    if (!Array.isArray(update[key])) {
      update[key] = null
    } else {
      const cleaned = update[key].map(s => String(s || '').trim()).filter(Boolean).slice(0, 10)
      update[key] = cleaned.length ? cleaned : null
    }
  }
  for (const key of ['instructor_name', 'instructor_role', 'instructor_bio']) {
    if (update[key] !== undefined) update[key] = String(update[key] || '').trim() || null
  }
  if (update.instructor_avatar !== undefined) {
    if (!update.instructor_avatar || update.instructor_avatar === '') update.instructor_avatar = null
    else if (!isValidImage(update.instructor_avatar)) return res.status(400).json({ error: '강사 사진은 URL 또는 JPG/PNG/WebP(base64)만 사용할 수 있습니다.' })
  }
  if (update.detail_intro_image !== undefined && (update.detail_intro_image === null || update.detail_intro_image === '')) {
    update.detail_intro_image = null
  }
  if (Object.keys(update).length === 0) return res.status(400).json({ error: '변경할 항목이 없습니다.' })
  if (update.enrollment_limit !== undefined) {
    update.enrollment_limit = Math.max(0, parseInt(update.enrollment_limit, 10) || 0)
  }
  update.updated_at = new Date().toISOString()
  await db.updateCourse(req.params.id, update)
  const course = await db.enrichCourseEnrollment(await db.getCourseById(req.params.id), { liveCount: true })
  res.json({ success: true, course })
})

router.post('/live-courses', async (req, res) => {
  const { title, description, category, thumbnail_icon, live_schedule, live_starts_at, meet_code } = req.body
  if (!title || !category) return res.status(400).json({ error: '제목과 카테고리는 필수입니다.' })
  const course = await db.createLiveCourse({ title, description, category, thumbnail_icon, live_schedule, live_starts_at, meet_code })
  res.json({ success: true, course })
})

router.post('/courses/:id/send-live-invite', async (req, res) => {
  const course = await db.getCourseById(req.params.id)
  if (!course) return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })
  if (course.course_type !== 'live') return res.status(400).json({ error: '라이브 강의가 아닙니다.' })
  if (!course.meet_code) return res.status(400).json({ error: 'Google Meet 코드를 먼저 입력해주세요.' })
  if (!course.live_schedule) return res.status(400).json({ error: '라이브 일정을 먼저 입력해주세요.' })

  const enrollments = await db.getEnrollmentsByCourse(course.id)
  const results = { sent: 0, skipped: 0, failed: 0, skipped_users: [] }

  for (const e of enrollments) {
    const user = await db.findUserById(e.user_id)
    if (!user) continue
    if (!user.phone) {
      results.skipped++
      results.skipped_users.push(user.name)
      continue
    }
    try {
      await sendLiveInviteMessage(user.phone, user.name, course.title, course.live_schedule, course.meet_code)
      results.sent++
    } catch (err) {
      results.failed++
    }
  }

  res.json({ success: true, ...results })
})

router.get('/course-stats', async (req, res) => {
  res.json(await db.getCourseStats())
})

// ── 편집자 신청 관리 ──
router.get('/editor-applications', async (req, res) => {
  const { status } = req.query
  const apps = await db.getAllEditorApplications(status || null)
  const userIds = [...new Set(apps.map(a => a.user_id).filter(Boolean))]
  const userMap = await db.batchGetUsers(userIds)
  res.json(apps.map(a => ({ ...a, user_name: userMap[a.user_id]?.name, email: userMap[a.user_id]?.email })))
})

router.patch('/editor-applications/:id', async (req, res) => {
  const { status, reject_reason } = req.body
  if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: '유효하지 않은 상태입니다.' })
  const result = await db.reviewEditorApplication(req.params.id, status, reject_reason)
  if (!result) return res.status(404).json({ error: '신청을 찾을 수 없습니다.' })
  res.json({ success: true })
})

const MAX_IMAGE_LEN = 480000
const MAX_DETAIL_INTRO_IMAGE_LEN = 950000

function normalizeDetailIntroImages(course) {
  if (!course) return []
  if (Array.isArray(course.detail_intro_images) && course.detail_intro_images.length) {
    return course.detail_intro_images.filter(Boolean).slice(0, 10)
  }
  if (course.detail_intro_image) return [course.detail_intro_image]
  return []
}

function isStorageImageUrl(value) {
  return typeof value === 'string'
    && /^https:\/\/(storage\.googleapis\.com|firebasestorage\.googleapis\.com)\/.+/i.test(value)
}

function isValidWebpImage(value) {
  if (!value) return true
  if (typeof value !== 'string') return false
  if (/^data:image\/webp;base64,/.test(value)) {
    return value.length <= MAX_DETAIL_INTRO_IMAGE_LEN
  }
  if (isStorageImageUrl(value)) return true
  if (/^https?:\/\/.+/i.test(value)) return /\.webp(\?|#|$)/i.test(value)
  return false
}

function isValidImage(value) {
  if (!value) return true
  if (typeof value !== 'string') return false
  if (isStorageImageUrl(value)) return true
  if (/^data:image\//.test(value)) return value.length <= MAX_IMAGE_LEN
  if (/^https?:\/\/.+/i.test(value)) return true
  return false
}

router.get('/site-settings/editor-apply', async (req, res) => {
  res.json(await db.getSiteSettings('editor_apply'))
})

router.patch('/site-settings/editor-apply', async (req, res) => {
  const { pending_review_image } = req.body
  if (pending_review_image !== null && pending_review_image !== undefined && pending_review_image !== '') {
    if (!isValidImage(pending_review_image)) {
      return res.status(400).json({ error: '이미지 URL 또는 JPG/PNG/WebP(base64)만 사용할 수 있습니다.' })
    }
  }
  const settings = await db.updateSiteSettings('editor_apply', {
    pending_review_image: pending_review_image || null,
  })
  res.json({ success: true, ...settings })
})

router.get('/homepage-layout', async (req, res) => {
  res.json(await db.getHomepageLayout())
})

router.patch('/homepage-layout', async (req, res) => {
  const { sections, nav, copy, categories, site } = req.body
  if (sections !== undefined && (typeof sections !== 'object' || Array.isArray(sections))) {
    return res.status(400).json({ error: 'sections 형식이 올바르지 않습니다.' })
  }
  if (nav !== undefined && (typeof nav !== 'object' || Array.isArray(nav))) {
    return res.status(400).json({ error: 'nav 형식이 올바르지 않습니다.' })
  }
  if (copy !== undefined && (typeof copy !== 'object' || Array.isArray(copy))) {
    return res.status(400).json({ error: 'copy 형식이 올바르지 않습니다.' })
  }
  if (categories !== undefined) {
    if (!Array.isArray(categories)) return res.status(400).json({ error: 'categories는 배열이어야 합니다.' })
    for (const cat of categories) {
      if (cat?.image && !isValidImage(cat.image)) {
        return res.status(400).json({ error: '카테고리 이미지는 URL 또는 JPG/PNG/WebP(base64)만 사용할 수 있습니다.' })
      }
    }
  }
  if (site !== undefined && (typeof site !== 'object' || Array.isArray(site))) {
    return res.status(400).json({ error: 'site 형식이 올바르지 않습니다.' })
  }
  const layout = await db.updateHomepageLayout({ sections, nav, copy, categories, site })
  res.json({ success: true, ...layout })
})

router.get('/platform-reviews', async (req, res) => {
  res.json(await db.getAllPlatformReviews())
})

router.post('/platform-reviews', async (req, res) => {
  try {
    const review = await db.createPlatformReview(req.body)
    res.json({ success: true, review })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

router.patch('/platform-reviews/:id', async (req, res) => {
  try {
    const review = await db.updatePlatformReview(req.params.id, req.body)
    if (!review) return res.status(404).json({ error: '후기를 찾을 수 없습니다.' })
    res.json({ success: true, review })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

router.delete('/platform-reviews/:id', async (req, res) => {
  await db.deletePlatformReview(req.params.id)
  res.json({ success: true })
})

router.get('/footer', async (req, res) => {
  res.json(await db.getFooterConfig())
})

router.patch('/footer', async (req, res) => {
  const footer = await db.updateFooterConfig(req.body)
  res.json({ success: true, ...footer })
})

router.get('/hero', async (req, res) => {
  res.json(await db.getHeroConfig())
})

router.patch('/hero', async (req, res) => {
  const { image } = req.body
  if (image !== null && image !== undefined && image !== '' && !isValidImage(image)) {
    return res.status(400).json({ error: '히어로 이미지는 URL 또는 JPG/PNG/WebP(base64)만 사용할 수 있습니다.' })
  }
  const hero = await db.updateHeroConfig(req.body)
  res.json({ success: true, ...hero })
})

router.get('/instructors-intro', async (req, res) => {
  res.json(await db.getInstructorsIntro())
})

router.patch('/instructors-intro', async (req, res) => {
  try {
    const intro = await db.updateInstructorsIntro(req.body)
    res.json({ success: true, ...intro })
  } catch (e) {
    res.status(400).json({ error: e.message || '저장에 실패했습니다.' })
  }
})

router.get('/instructors', async (req, res) => {
  res.json(await db.getInstructors({ publicOnly: false }))
})

router.post('/instructors', async (req, res) => {
  try {
    const instructor = await db.createInstructor(req.body)
    res.json({ success: true, instructor })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

router.patch('/instructors/:id', async (req, res) => {
  const instructor = await db.updateInstructor(req.params.id, req.body)
  if (!instructor) return res.status(404).json({ error: '강사를 찾을 수 없습니다.' })
  res.json({ success: true, instructor })
})

router.delete('/instructors/:id', async (req, res) => {
  await db.deleteInstructor(req.params.id)
  res.json({ success: true })
})

// ── 에디터즈 선발 프로그램 설계 ──
router.get('/editor-program/config', async (req, res) => {
  const config = await db.getEditorProgramConfig()
  const workbooks = await db.getEditorWorkbooks()
  res.json({
    ...config,
    total_mails: getTotalMailCountFromConfig(config),
    workbooks: workbooks.map(w => ({
      id: w.id,
      order_num: w.order_num,
      stage_num: w.stage_num,
      position_in_stage: w.position_in_stage,
      from_name: w.from_name,
      from_company: w.from_company,
      subject: w.subject,
      mission_title: w.mission_title,
    })),
  })
})

router.patch('/editor-program/config', async (req, res) => {
  const { stages, guide_cards, terms_version } = req.body
  if (stages !== undefined && (!Array.isArray(stages) || !stages.length)) {
    return res.status(400).json({ error: '단계 설정이 올바르지 않습니다.' })
  }
  const config = await db.updateEditorProgramConfig({ stages, guide_cards, terms_version })
  res.json({
    success: true,
    ...config,
    total_mails: getTotalMailCountFromConfig(config),
  })
})

router.patch('/editor-program/workbooks/:id', async (req, res) => {
  const workbook = await db.updateEditorWorkbook(req.params.id, req.body)
  if (!workbook) return res.status(404).json({ error: '메일을 찾을 수 없습니다.' })
  res.json({ success: true, workbook })
})

router.get('/editor-program/workbooks/:id', async (req, res) => {
  const workbook = await db.getEditorWorkbookById(req.params.id)
  if (!workbook) return res.status(404).json({ error: '메일을 찾을 수 없습니다.' })
  res.json(workbook)
})

router.post('/editor-program/sync', async (req, res) => {
  const result = await db.syncWorkbookSlotsFromConfig()
  res.json({ success: true, ...result })
})

// ── 미션 제출 검수 ──
router.get('/workbook-submissions', async (req, res) => {
  const { user_id, workbook_id } = req.query
  const subs = await db.getWorkbookSubmissions({ userId: user_id, workbookId: workbook_id })
  const userIds = [...new Set(subs.map(s => s.user_id).filter(Boolean))]
  const workbookIds = [...new Set(subs.map(s => s.workbook_id).filter(Boolean))]
  const [userMap, workbooks] = await Promise.all([
    db.batchGetUsers(userIds),
    Promise.all(workbookIds.map(id => db.getEditorWorkbookById(id))),
  ])
  const wbMap = Object.fromEntries(workbookIds.map((id, i) => [id, workbooks[i]]))
  res.json(subs.map(s => {
    const wb = wbMap[s.workbook_id]
    const u = userMap[s.user_id]
    return {
      ...s,
      user_name: u?.name || '-',
      user_email: u?.email || '-',
      workbook_subject: wb?.subject || '-',
      workbook_order: wb?.order_num || '-',
      stage_num: wb?.stage_num || '-',
    }
  }))
})

router.post('/workbook-submissions/:id/review', async (req, res) => {
  const { verdict, feedback } = req.body
  if (!['passed', 'failed'].includes(verdict)) return res.status(400).json({ error: 'verdict must be passed or failed' })
  const result = await db.adminReviewSubmission(req.params.id, { verdict, feedback })
  res.json({ success: true, submission: result })
})

// ── 공지사항 ──
router.get('/notices', async (req, res) => {
  res.json(await db.getNotices())
})
router.post('/notices', async (req, res) => {
  const { title, content, is_public, is_pinned } = req.body
  if (!title || !content) return res.status(400).json({ error: '제목과 내용은 필수입니다.' })
  res.json(await db.createNotice({ title, content, is_public: !!is_public, is_pinned: !!is_pinned }))
})
router.patch('/notices/:id', async (req, res) => {
  const notice = await db.updateNotice(req.params.id, req.body)
  if (!notice) return res.status(404).json({ error: '공지를 찾을 수 없습니다.' })
  res.json({ success: true, notice })
})
router.delete('/notices/:id', async (req, res) => {
  await db.deleteNotice(req.params.id)
  res.json({ success: true })
})

// ── 고객지원 문의 ──
router.get('/tickets', async (req, res) => {
  res.json(await db.getTickets({ status: req.query.status }))
})
router.get('/tickets/:id', async (req, res) => {
  const t = await db.getTicketById(req.params.id)
  if (!t) return res.status(404).json({ error: '문의를 찾을 수 없습니다.' })
  res.json(t)
})
router.post('/tickets/:id/answer', async (req, res) => {
  const { answer } = req.body
  if (!answer) return res.status(400).json({ error: '답변 내용이 필요합니다.' })
  const t = await db.answerTicket(req.params.id, { answer })
  res.json({ success: true, ticket: t })
})
router.patch('/tickets/:id/status', async (req, res) => {
  const { status } = req.body
  if (!['open', 'answered', 'closed'].includes(status)) return res.status(400).json({ error: '유효하지 않은 상태입니다.' })
  const t = await db.updateTicketStatus(req.params.id, status)
  res.json({ success: true, ticket: t })
})
router.delete('/tickets/:id', async (req, res) => {
  await db.deleteTicket(req.params.id)
  res.json({ success: true })
})

// ── FAQ ──
router.get('/faqs', async (req, res) => {
  res.json(await db.getFaqs())
})
router.post('/faqs', async (req, res) => {
  const { question, answer, category, is_public, sort_order } = req.body
  if (!question || !answer) return res.status(400).json({ error: '질문과 답변은 필수입니다.' })
  res.json(await db.createFaq({ question, answer, category, is_public: is_public !== false, sort_order }))
})
router.patch('/faqs/:id', async (req, res) => {
  const faq = await db.updateFaq(req.params.id, req.body)
  if (!faq) return res.status(404).json({ error: 'FAQ를 찾을 수 없습니다.' })
  res.json({ success: true, faq })
})
router.delete('/faqs/:id', async (req, res) => {
  await db.deleteFaq(req.params.id)
  res.json({ success: true })
})

module.exports = router
