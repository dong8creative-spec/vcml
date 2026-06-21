const router = require('express').Router()
const db = require('../db/schema')
const userPayload = require('../db/schema').userPayload
const { authMiddleware } = require('../middleware/auth')

const MAX_BIO = 500
const MAX_IMAGE_LEN = 480000
const MAX_LINKS = 5

function profileView(user) {
  if (!user) return null
  return {
    ...userPayload(user),
    marketing_agreed: !!user.marketing_agreed,
    phone: user.phone || null,
  }
}

function isValidImage(value) {
  if (!value) return true
  if (typeof value !== 'string') return false
  if (value.length > MAX_IMAGE_LEN) return false
  return /^https?:\/\/.+/i.test(value) || /^data:image\/(jpeg|jpg|png|webp);base64,/.test(value)
}

function normalizeSocialLinks(links) {
  if (!Array.isArray(links)) return []
  return links
    .slice(0, MAX_LINKS)
    .map(l => ({
      label: String(l?.label || '').trim().slice(0, 30),
      url: String(l?.url || '').trim(),
    }))
    .filter(l => l.url && /^https?:\/\/.+/i.test(l.url))
}

router.get('/profile', authMiddleware, async (req, res) => {
  const user = await db.findUserById(req.user.id)
  if (!user) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' })
  res.json(profileView(user))
})

router.patch('/profile', authMiddleware, async (req, res) => {
  const { name, bio, profile_image, social_links, phone } = req.body
  const trimmedName = name !== undefined ? String(name).trim() : undefined
  if (trimmedName !== undefined && (trimmedName.length < 2 || trimmedName.length > 30)) {
    return res.status(400).json({ error: '이름은 2~30자로 입력해주세요.' })
  }
  if (bio !== undefined && String(bio).length > MAX_BIO) {
    return res.status(400).json({ error: `자기소개는 ${MAX_BIO}자 이내로 입력해주세요.` })
  }
  if (profile_image !== undefined && profile_image !== null && !isValidImage(profile_image)) {
    return res.status(400).json({ error: '프로필 사진은 JPG/PNG/WEBP 이미지 또는 http(s) URL만 사용할 수 있습니다.' })
  }
  let normalizedPhone = undefined
  if (phone !== undefined) {
    const digits = String(phone || '').replace(/\D/g, '')
    if (!digits) {
      normalizedPhone = null
    } else if (!/^010\d{8}$/.test(digits)) {
      return res.status(400).json({ error: '휴대폰 번호는 010으로 시작하는 11자리로 입력해주세요.' })
    } else {
      normalizedPhone = `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
    }
  }
  const links = social_links !== undefined ? normalizeSocialLinks(social_links) : undefined

  const user = await db.updateUserProfile(req.user.id, {
    name: trimmedName,
    bio: bio !== undefined ? String(bio).trim() : undefined,
    profile_image: profile_image === undefined ? undefined : (profile_image || null),
    social_links: links,
    phone: normalizedPhone,
  })
  res.json({ success: true, user: profileView(user) })
})

router.get('/live-sessions', authMiddleware, async (req, res) => {
  const enrollments = await db.getEnrollmentsByUser(req.user.id)
  const sessions = []
  for (const e of enrollments) {
    const c = await db.getCourseById(e.course_id)
    if (!c || c.course_type !== 'live') continue
    if (c.live_status === 'ended') continue
    sessions.push({
      id: c.id,
      slug: c.slug,
      title: c.title,
      category: c.category,
      live_schedule: c.live_schedule,
      live_starts_at: c.live_starts_at || null,
      meet_code: c.meet_code || null,
      live_status: c.live_status || 'upcoming',
    })
  }
  sessions.sort((a, b) => {
    const parseStart = (c) => {
      if (c.live_starts_at) {
        const t = new Date(c.live_starts_at).getTime()
        if (!isNaN(t)) return t
      }
      const ko = String(c.live_schedule || '').match(/^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(오전|오후)\s*(\d{1,2}):(\d{2})/)
      if (ko) {
        let h = parseInt(ko[5], 10)
        if (ko[4] === '오후' && h !== 12) h += 12
        if (ko[4] === '오전' && h === 12) h = 0
        return new Date(parseInt(ko[1], 10), parseInt(ko[2], 10) - 1, parseInt(ko[3], 10), h, parseInt(ko[6], 10)).getTime()
      }
      const t = new Date(c.live_schedule || '').getTime()
      return isNaN(t) ? Infinity : t
    }
    return parseStart(a) - parseStart(b)
  })
  res.json(sessions)
})

router.get('/courses', authMiddleware, async (req, res) => {
  const enrollments = await db.getEnrollmentsByUser(req.user.id)
  const courses = await Promise.all(enrollments.map(async e => {
    const c = await db.getCourseById(e.course_id)
    if (!c) return null
    const chapters = await db.getChaptersByCourse(c.id)
    const progress = await db.getProgressByCourse(req.user.id, c.id)
    const completed = progress.filter(p => p.completed).length
    const order = await db.getActiveOrderForCourse(req.user.id, c.id)
    const cancelPlan = db.computeEnrollmentCancelPlan(c, order, progress, chapters)
    const myReview = await db.getReviewByUserAndCourse(req.user.id, c.id)
    const base = db.stripLiveResourceUrls(c)
    const row = {
      ...base,
      enrolled_at: e.enrolled_at,
      total_chapters: chapters.length,
      completed_chapters: completed,
      last_chapter_id: e.last_chapter_id || null,
      paid_amount: order ? Number(order.amount || 0) : 0,
      can_cancel: cancelPlan.allowed,
      cancel_label: cancelPlan.label || (Number(order?.amount || 0) > 0 ? '환불 신청' : '신청 취소'),
      cancel_hint: cancelPlan.error || null,
      refund_preview: cancelPlan.refund_amount || 0,
      my_review: myReview ? { rating: myReview.rating, content: myReview.content || '' } : null,
    }
    if (c.course_type === 'live') {
      row.live_resources = db.getLiveResourceAccess(c, { enrolled: true })
    }
    return row
  }))
  res.json(courses.filter(Boolean).reverse())
})

router.get('/courses/:courseId/live-replay', authMiddleware, async (req, res) => {
  const course = await db.getCourseById(req.params.courseId)
  if (!course || course.course_type !== 'live') {
    return res.status(404).json({ error: '라이브 강의를 찾을 수 없습니다.' })
  }
  if (!await db.isEnrolled(req.user.id, course.id)) {
    return res.status(403).json({ error: '수강 신청 후 이용할 수 있습니다.' })
  }
  const url = String(course.live_replay_url || '').trim()
  if (!url || !/^https?:\/\/.+/i.test(url)) {
    return res.status(404).json({ error: '다시보기 링크가 아직 준비되지 않았습니다.' })
  }
  res.json({ url })
})

router.get('/courses/:courseId/live-material', authMiddleware, async (req, res) => {
  const course = await db.getCourseById(req.params.courseId)
  if (!course || course.course_type !== 'live') {
    return res.status(404).json({ error: '라이브 강의를 찾을 수 없습니다.' })
  }
  if (!await db.isEnrolled(req.user.id, course.id)) {
    return res.status(403).json({ error: '수강 신청 후 이용할 수 있습니다.' })
  }
  if (!db.isLiveLectureDay(course)) {
    return res.status(403).json({ error: '강의 자료는 강의 당일에만 다운로드할 수 있습니다.' })
  }
  const url = String(course.live_material_url || '').trim()
  if (!url || !/^https?:\/\/.+/i.test(url)) {
    return res.status(404).json({ error: '자료 다운로드 링크가 아직 준비되지 않았습니다.' })
  }
  res.json({ url })
})

router.get('/courses/:courseId/cancel-preview', authMiddleware, async (req, res) => {
  const courseId = req.params.courseId
  if (!await db.isEnrolled(req.user.id, courseId)) {
    return res.status(404).json({ error: '수강 중인 강의가 아닙니다.' })
  }
  const course = await db.getCourseById(courseId)
  if (!course) return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })
  const chapters = await db.getChaptersByCourse(courseId)
  const progress = await db.getProgressByCourse(req.user.id, courseId)
  const order = await db.getActiveOrderForCourse(req.user.id, courseId)
  const plan = db.computeEnrollmentCancelPlan(course, order, progress, chapters)
  res.json({
    allowed: plan.allowed,
    type: plan.type || null,
    label: plan.label || null,
    refund_amount: plan.refund_amount || 0,
    message: plan.error || null,
    paid_amount: order ? Number(order.amount || 0) : 0,
    watched_chapters: db.countWatchedChapters(progress),
    total_chapters: chapters.length,
    course_title: course.title,
  })
})

router.post('/courses/:courseId/cancel', authMiddleware, async (req, res) => {
  try {
    const result = await db.cancelEnrollmentWithCleanup(req.user.id, req.params.courseId)
    if (result.error === 'not_enrolled') {
      return res.status(404).json({ error: '수강 중인 강의가 아닙니다.' })
    }
    if (result.error === 'course_not_found') {
      return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })
    }
    if (result.error === 'not_allowed') {
      return res.status(400).json({ error: result.message || '취소·환불할 수 없습니다.' })
    }
    res.json(result)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/progress', authMiddleware, async (req, res) => {
  const { chapter_id, completed, watched_sec } = req.body
  const chapter = await db.getChapterById(chapter_id)
  if (!chapter) return res.status(404).json({ error: '챕터 없음' })
  if (!await db.isEnrolled(req.user.id, chapter.course_id)) return res.status(403).json({ error: '수강 신청 필요' })
  await db.upsertProgress(req.user.id, chapter_id, completed, watched_sec || 0)
  res.json({ success: true })
})

router.post('/reviews', authMiddleware, async (req, res) => {
  const { course_id, rating, content } = req.body
  if (!course_id || !rating) return res.status(400).json({ error: '필수 항목 누락' })
  if (!await db.isEnrolled(req.user.id, course_id)) return res.status(403).json({ error: '수강생만 후기를 작성할 수 있습니다.' })
  const result = await db.upsertReview(req.user.id, course_id, rating, content)
  res.json({
    success: true,
    coupon: result.coupon ? db.enrichCoupon(result.coupon) : null,
    rating: result.rating,
  })
})

router.get('/coupons', authMiddleware, async (req, res) => {
  const coupons = await db.getCouponsByUserNormalized(req.user.id)
  res.json(coupons)
})

router.delete('/marketing-consent', authMiddleware, async (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress
  await db.revokeMarketing(req.user.id, ip)
  res.json({ success: true })
})

module.exports = router
