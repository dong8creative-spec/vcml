const router = require('express').Router()
const db = require('../db/schema')
const jwt = require('jsonwebtoken')
const { authMiddleware } = require('../middleware/auth')
const {
  ANTICIPATION_DISCOUNT_PERCENT,
  ANTICIPATION_MIN_LENGTH,
  ANTICIPATION_MAX_LENGTH,
} = require('../db/schema')

function anticipationError(res, result) {
  if (result.error === 'already_submitted') {
    return res.status(409).json({ error: '이미 이 강의에 기대평을 작성하셨습니다.', review: result.review })
  }
  if (result.error === 'already_enrolled') {
    return res.status(409).json({ error: '이미 신청한 강의입니다.' })
  }
  if (result.error === 'too_short') {
    return res.status(400).json({ error: `기대평은 ${ANTICIPATION_MIN_LENGTH}자 이상 입력해주세요.` })
  }
  if (result.error === 'too_long') {
    return res.status(400).json({ error: `기대평은 ${ANTICIPATION_MAX_LENGTH}자 이내로 입력해주세요.` })
  }
  if (result.error === 'user_not_found') {
    return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' })
  }
  if (result.error === 'course_not_found') {
    return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })
  }
  return null
}

async function optionalUser(req) {
  try {
    const h = req.headers.authorization
    if (h?.startsWith('Bearer ')) {
      return jwt.verify(h.slice(7), process.env.JWT_SECRET)
    }
  } catch {}
  return null
}

router.get('/', async (req, res) => {
  const courses = await db.getCourses()
  res.json(courses)
})

router.get('/:slug/anticipation-reviews', async (req, res) => {
  try {
    const course = await db.getCourseBySlug(req.params.slug)
    if (!course || !course.is_published) return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })
    const reviews = await db.getCourseAnticipationReviews(course.id)
    res.json({
      reviews: reviews.map(r => ({
        id: r.id,
        author_id_display: r.author_id_display || r.author_display,
        author_display: r.author_display,
        content: r.content,
        created_at: r.created_at,
      })),
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.get('/:slug/anticipation-reviews/mine', authMiddleware, async (req, res) => {
  try {
    const course = await db.getCourseBySlug(req.params.slug)
    if (!course) return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })
    const review = await db.getAnticipationReviewByUserAndCourse(req.user.id, course.id)
    res.json({
      submitted: !!review,
      review: review ? {
        id: review.id,
        content: review.content,
        created_at: review.created_at,
      } : null,
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/:slug/apply-with-anticipation', authMiddleware, async (req, res) => {
  try {
    const course = await db.getCourseBySlug(req.params.slug)
    if (!course || !course.is_published) return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })

    const isLive = course.course_type === 'live'
    const isFreeVod = !isLive && Number(course.sale_price) === 0
    const isPaid = !isLive && Number(course.sale_price) > 0

    if (isLive && course.live_status === 'ended') {
      return res.status(400).json({ error: '종료된 강의입니다.' })
    }

    const shouldEnroll = isLive || isFreeVod
    const result = await db.createCourseAnticipationReview(
      req.user.id,
      course.id,
      req.body.content,
      { enroll: shouldEnroll }
    )
    const err = anticipationError(res, result)
    if (err) return err

    const payload = {
      success: true,
      review: {
        id: result.review.id,
        content: result.review.content,
        created_at: result.review.created_at,
      },
      enrolled: !!result.enrolled,
      needs_payment: isPaid && !result.enrolled,
      coupon: result.coupon ? {
        code: result.coupon.code,
        discount_percent: result.coupon.discount_percent || ANTICIPATION_DISCOUNT_PERCENT,
        expires_at: result.coupon.expires_at || null,
      } : null,
    }

    res.json(payload)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.get('/:slug', async (req, res) => {
  try {
    const course = await db.getCourseBySlug(req.params.slug)
    if (!course || !course.is_published) return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })
    const chapters = await db.getChaptersByCourse(course.id)
    let enrolled = false
    let my_anticipation = null
    const u = await optionalUser(req)
    if (u) {
      enrolled = await db.isEnrolled(u.id, course.id)
      const review = await db.getAnticipationReviewByUserAndCourse(u.id, course.id)
      if (review) {
        my_anticipation = {
          id: review.id,
          content: review.content,
          created_at: review.created_at,
        }
      }
    }
    res.json({ ...course, chapters, enrolled, my_anticipation })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.get('/:slug/chapters/:chapterId', authMiddleware, async (req, res) => {
  const course = await db.getCourseBySlug(req.params.slug)
  if (!course) return res.status(404).json({ error: '강의 없음' })
  const chapter = await db.getChapterById(req.params.chapterId)
  if (!chapter || chapter.course_id !== course.id) return res.status(404).json({ error: '챕터 없음' })
  if (!chapter.is_free && !await db.isEnrolled(req.user.id, course.id)) return res.status(403).json({ error: '수강 신청이 필요합니다.' })
  const progress = await db.getProgress(req.user.id, chapter.id)
  const allChs = await db.getChaptersByCourse(course.id)
  const idx = allChs.findIndex(c => c.id === chapter.id)
  res.json({ ...chapter, progress: progress || null, prev_id: allChs[idx-1]?.id || null, next_id: allChs[idx+1]?.id || null })
})

/** @deprecated apply-with-anticipation 사용 */
router.post('/:slug/enroll-free', authMiddleware, async (req, res) => {
  const course = await db.getCourseBySlug(req.params.slug)
  if (!course || !course.is_published) return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })
  if (course.course_type !== 'live') return res.status(400).json({ error: '무료 신청은 라이브 강의만 가능합니다.' })
  const review = await db.getAnticipationReviewByUserAndCourse(req.user.id, course.id)
  if (!review) {
    return res.status(400).json({ error: '기대평 작성 후 신청할 수 있습니다.', code: 'anticipation_required' })
  }
  if (await db.isEnrolled(req.user.id, course.id)) return res.status(409).json({ error: '이미 신청한 강의입니다.' })
  await db.enroll(req.user.id, course.id)
  await db.createOrder(req.user.id, course.id, 0, '무료', 0)
  await db.updateCourse(course.id, { student_count: (course.student_count || 0) + 1 })
  res.json({ success: true })
})

/** @deprecated apply-with-anticipation 사용 */
router.post('/:slug/enroll-free-vod', authMiddleware, async (req, res) => {
  const course = await db.getCourseBySlug(req.params.slug)
  if (!course || !course.is_published) return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })
  if (Number(course.sale_price) !== 0 || course.course_type === 'live') {
    return res.status(400).json({ error: '무료 VOD 강의가 아닙니다.' })
  }
  const review = await db.getAnticipationReviewByUserAndCourse(req.user.id, course.id)
  if (!review) {
    return res.status(400).json({ error: '기대평 작성 후 신청할 수 있습니다.', code: 'anticipation_required' })
  }
  if (await db.isEnrolled(req.user.id, course.id)) {
    return res.json({ success: true, already: true })
  }
  await db.enroll(req.user.id, course.id)
  await db.createOrder(req.user.id, course.id, 0, '무료', 0)
  await db.updateCourse(course.id, { student_count: (course.student_count || 0) + 1 })
  res.json({ success: true })
})

module.exports = router
