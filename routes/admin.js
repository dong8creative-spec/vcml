const router = require('express').Router()
const db = require('../db/schema')
const { getTotalMailCountFromConfig } = require('../db/schema')
const { adminMiddleware } = require('../middleware/auth')
const { sendLiveInviteMessage } = require('../utils/kakaoMessage')

router.use(adminMiddleware)

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
  const result = await Promise.all(orders.map(async o => {
    const u = await db.findUserById(o.user_id)
    const c = await db.getCourseById(o.course_id)
    return { ...o, user_name: u?.name, email: u?.email, course_title: c?.title }
  }))
  res.json(result)
})

router.get('/students', async (req, res) => {
  res.json(await db.getAllStudents())
})

router.get('/reviews', async (req, res) => {
  const reviews = await db.getAllReviews()
  const result = await Promise.all(reviews.map(async r => {
    const u = await db.findUserById(r.user_id)
    const c = await db.getCourseById(r.course_id)
    return { ...r, user_name: u?.name, course_title: c?.title }
  }))
  res.json(result)
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
      ...(await db.enrichCourseEnrollment(c)),
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
    'live_curriculum_text', 'live_curriculum_image', 'live_chat_url',
    'live_replay_url', 'live_material_url',
    'badge', 'thumbnail_icon', 'thumb_style', 'thumbnail_url', 'hero_gallery', 'sort_order', 'is_offline', 'enrollment_limit',
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
  if (Object.keys(update).length === 0) return res.status(400).json({ error: '변경할 항목이 없습니다.' })
  if (update.enrollment_limit !== undefined) {
    update.enrollment_limit = Math.max(0, parseInt(update.enrollment_limit, 10) || 0)
  }
  update.updated_at = new Date().toISOString()
  await db.updateCourse(req.params.id, update)
  const course = await db.enrichCourseEnrollment(await db.getCourseById(req.params.id))
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
  const result = await Promise.all(apps.map(async a => {
    const u = await db.findUserById(a.user_id)
    return { ...a, user_name: u?.name, email: u?.email }
  }))
  res.json(result)
})

router.patch('/editor-applications/:id', async (req, res) => {
  const { status, reject_reason } = req.body
  if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: '유효하지 않은 상태입니다.' })
  const result = await db.reviewEditorApplication(req.params.id, status, reject_reason)
  if (!result) return res.status(404).json({ error: '신청을 찾을 수 없습니다.' })
  res.json({ success: true })
})

const MAX_IMAGE_LEN = 480000

function isValidImage(value) {
  if (!value) return true
  if (typeof value !== 'string') return false
  if (value.length > MAX_IMAGE_LEN) return false
  return /^https?:\/\/.+/i.test(value) || /^data:image\/(jpeg|jpg|png|webp);base64,/.test(value)
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
  const result = await Promise.all(subs.map(async s => {
    const [u, wb] = await Promise.all([
      db.findUserById(s.user_id),
      db.getEditorWorkbookById(s.workbook_id),
    ])
    return {
      ...s,
      user_name: u?.name || '-',
      user_email: u?.email || '-',
      workbook_subject: wb?.subject || '-',
      workbook_order: wb?.order_num || '-',
      stage_num: wb?.stage_num || '-',
    }
  }))
  res.json(result)
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
