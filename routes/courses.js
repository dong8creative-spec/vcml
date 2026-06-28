const router = require('express').Router()
const db = require('../db/schema')
const jwt = require('jsonwebtoken')
const { authMiddleware } = require('../middleware/auth')
const {
  ANTICIPATION_DISCOUNT_PERCENT,
  ANTICIPATION_MIN_LENGTH,
  ANTICIPATION_MAX_LENGTH,
} = require('../db/schema')

function stripCourseMediaFields(course) {
  if (!course || typeof course !== 'object') return course
  const {
    thumbnail_url,
    thumbnail_image,
    hero_gallery,
    detail_intro_text,
    detail_intro_images,
    detail_intro_image,
    live_curriculum_image,
    instructor_avatar,
    ...rest
  } = course
  return {
    ...rest,
    // URL 이미지는 가볍지만 base64는 media API로 지연 로드합니다.
    thumbnail_url: typeof thumbnail_url === 'string' && thumbnail_url.startsWith('http') ? thumbnail_url : null,
    thumbnail_image: typeof thumbnail_image === 'string' && thumbnail_image.startsWith('http') ? thumbnail_image : null,
  }
}

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
  if (result.error === 'edit_locked') {
    return res.status(403).json({ error: result.message || '강의 종료 후에는 기대평을 작성·수정·삭제할 수 없습니다.' })
  }
  if (result.error === 'enrollment_full') {
    return res.status(409).json({ error: '모집 정원이 마감되었습니다.', code: 'enrollment_full' })
  }
  return null
}

function enrollError(res, result) {
  if (result.error === 'already_enrolled') {
    return res.status(409).json({ error: '이미 신청한 강의입니다.' })
  }
  if (result.error === 'course_not_found') {
    return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })
  }
  if (result.error === 'enrollment_full') {
    return res.status(409).json({ error: '모집 정원이 마감되었습니다.', code: 'enrollment_full' })
  }
  if (result.error === 'payment_required') {
    return res.status(400).json({ error: '유료 강의는 결제 후 수강할 수 있습니다.', code: 'payment_required' })
  }
  if (result.error === 'live_ended') {
    return res.status(400).json({ error: '종료된 강의입니다.' })
  }
  return null
}

function publicCache(req, res, next) {
  res.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120')
  next()
}

function formatAnticipationCoupon(coupon) {
  if (!coupon) return null
  return {
    code: coupon.code,
    discount_percent: coupon.discount_percent || ANTICIPATION_DISCOUNT_PERCENT,
    expires_at: coupon.expires_at || null,
    issuance: coupon.issuance || null,
  }
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

router.get('/', publicCache, async (req, res) => {
  const courses = await db.getCourses()
  res.json(courses.map(db.pickCourseCardFields))
})

router.get('/:slug/reviews', publicCache, async (req, res) => {
  try {
    const course = await db.getCourseBySlug(req.params.slug)
    if (!course || !course.is_published) return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })
    const reviews = await db.getReviews(course.id)
    const sorted = [...reviews].sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
    const userIds = [...new Set(sorted.map(r => r.user_id).filter(Boolean))]
    const users = {}
    await Promise.all(userIds.map(async id => {
      const u = await db.findUserById(id)
      if (u?.name) {
        const n = String(u.name).trim()
        users[id] = n.length <= 1 ? n + '**' : n[0] + '**'
      }
    }))
    res.json({
      reviews: sorted.map(r => ({
        id: r.id,
        rating: r.rating || 5,
        content: r.content || '',
        author_display: users[r.user_id] || r.author_display || '수강생',
        created_at: r.created_at,
      })),
      rating: course.rating || 0,
      review_count: course.review_count || 0,
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.get('/:slug/anticipation-reviews', publicCache, async (req, res) => {
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

router.get('/:slug/media', publicCache, async (req, res) => {
  try {
    const course = await db.getCourseBySlug(req.params.slug)
    if (!course || !course.is_published) return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })
    res.json({
      thumbnail_url: course.thumbnail_url || null,
      thumbnail_image: course.thumbnail_image || null,
      hero_gallery: Array.isArray(course.hero_gallery) ? course.hero_gallery : [],
      detail_intro_text: course.detail_intro_text || null,
      detail_intro_images: Array.isArray(course.detail_intro_images) ? course.detail_intro_images : null,
      detail_intro_image: course.detail_intro_image || null,
      live_curriculum_image: course.live_curriculum_image || null,
      live_curriculum_text: course.live_curriculum_text || null,
      instructor_avatar: course.instructor_avatar || null,
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

router.patch('/:slug/anticipation-reviews/mine', authMiddleware, async (req, res) => {
  try {
    const course = await db.getCourseBySlug(req.params.slug)
    if (!course || !course.is_published) return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })

    const result = await db.updateCourseAnticipationReview(req.user.id, course.id, req.body.content)
    if (result.error === 'not_found') {
      return res.status(404).json({ error: '작성한 기대평이 없습니다.' })
    }
    const err = anticipationError(res, result)
    if (err) return err

    res.json({
      success: true,
      review: {
        id: result.review.id,
        content: result.review.content,
        created_at: result.review.created_at,
        updated_at: result.review.updated_at || null,
      },
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.delete('/:slug/anticipation-reviews/mine', authMiddleware, async (req, res) => {
  try {
    const course = await db.getCourseBySlug(req.params.slug)
    if (!course || !course.is_published) return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })

    const result = await db.deleteCourseAnticipationReview(req.user.id, course.id)
    if (result.error === 'not_found') {
      return res.status(404).json({ error: '작성한 기대평이 없습니다.' })
    }
    const err = anticipationError(res, result)
    if (err) return err

    res.json({ success: true, coupons_recalled: result.coupons_recalled || 0 })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/:slug/anticipation-reviews', authMiddleware, async (req, res) => {
  try {
    const course = await db.getCourseBySlug(req.params.slug)
    if (!course || !course.is_published) return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })

    const result = await db.createCourseAnticipationReview(
      req.user.id,
      course.id,
      req.body.content,
      { enroll: false }
    )
    const err = anticipationError(res, result)
    if (err) return err

    const issuance = await db.resolveCouponIssuance(result.coupon)
    res.json({
      success: true,
      review: {
        id: result.review.id,
        content: result.review.content,
        created_at: result.review.created_at,
      },
      coupon: result.coupon ? {
        code: result.coupon.code,
        discount_percent: result.coupon.discount_percent || ANTICIPATION_DISCOUNT_PERCENT,
        expires_at: result.coupon.expires_at || null,
        issuance,
      } : null,
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/:slug/enroll', authMiddleware, async (req, res) => {
  try {
    const course = await db.getCourseBySlug(req.params.slug)
    if (!course || !course.is_published) return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })

    const result = await db.enrollInCourse(req.user.id, course.id)
    const err = enrollError(res, result)
    if (err) return err

    res.json({ success: true, enrolled: true, course_slug: course.slug })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

/** @deprecated anticipation-reviews + enroll 분리 — 하위 호환 */
router.post('/:slug/apply-with-anticipation', authMiddleware, async (req, res) => {
  try {
    const course = await db.getCourseBySlug(req.params.slug)
    if (!course || !course.is_published) return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })

    const result = await db.createCourseAnticipationReview(
      req.user.id,
      course.id,
      req.body.content,
      { enroll: false }
    )
    const err = anticipationError(res, result)
    if (err) return err

    const issuance = result.coupon ? await db.resolveCouponIssuance(result.coupon) : null
    res.json({
      success: true,
      review: {
        id: result.review.id,
        content: result.review.content,
        created_at: result.review.created_at,
      },
      enrolled: false,
      needs_payment: Number(course.sale_price) > 0 && course.course_type !== 'live',
      coupon: result.coupon ? {
        code: result.coupon.code,
        discount_percent: result.coupon.discount_percent || ANTICIPATION_DISCOUNT_PERCENT,
        expires_at: result.coupon.expires_at || null,
        issuance,
      } : null,
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.get('/:slug/live-replay', async (req, res) => {
  try {
    const course = await db.getCourseBySlug(req.params.slug)
    if (!course || !course.is_published || course.course_type !== 'live') {
      return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })
    }
    const access = db.getLiveResourceAccess(course, { enrolled: false })
    if (!access.replay_available) {
      if (access.replay_pending) {
        const when = access.replay_opens_label || '다음 날 오후 1시'
        return res.status(403).json({ error: `강의 다시보기는 ${when}부터 이용할 수 있습니다.` })
      }
      if (!access.live_ended) {
        return res.status(403).json({ error: '라이브 강의 종료 후 다시보기가 제공됩니다.' })
      }
      return res.status(404).json({ error: '다시보기 링크가 아직 준비되지 않았습니다.' })
    }
    const url = String(course.live_replay_url || '').trim()
    if (!url || !/^https?:\/\/.+/i.test(url)) {
      return res.status(404).json({ error: '다시보기 링크가 아직 준비되지 않았습니다.' })
    }
    res.json({ url })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.get('/:slug', async (req, res) => {
  try {
    const course = await db.getCourseBySlug(req.params.slug)
    if (!course || !course.is_published) return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })

    const anticipation_modify = db.getAnticipationModifyMeta(course)
    const u = await optionalUser(req)

    // course.id가 확정된 후 나머지 쿼리를 모두 병렬로 실행
    const [chapters, enrolledResult, myReview] = await Promise.all([
      db.getChaptersByCourse(course.id),
      u ? db.isEnrolled(u.id, course.id) : Promise.resolve(false),
      u ? db.getAnticipationReviewByUserAndCourse(u.id, course.id) : Promise.resolve(null),
    ])

    const enrolled = enrolledResult
    const my_anticipation = myReview ? {
      id: myReview.id,
      content: myReview.content,
      created_at: myReview.created_at,
      can_edit: anticipation_modify.can_modify,
    } : null

    const payload = {
      ...(await db.enrichCourseEnrollment(stripCourseMediaFields(db.stripLiveResourceUrls(course)))),
      chapters,
      enrolled,
      my_anticipation,
      anticipation_modify,
      live_ended: course.course_type === 'live' ? db.isLiveCourseEnded(course) : false,
    }
    if (!enrolled) delete payload.live_chat_url
    if (course.course_type === 'live' && (enrolled || db.isLiveCourseEnded(course))) {
      payload.live_resources = db.getLiveResourceAccess(course, { enrolled: !!enrolled })
    }
    res.json(payload)
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

/** @deprecated /enroll 사용 */
router.post('/:slug/enroll-free', authMiddleware, async (req, res) => {
  const course = await db.getCourseBySlug(req.params.slug)
  if (!course || !course.is_published) return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })
  if (course.course_type !== 'live') return res.status(400).json({ error: '무료 신청은 라이브 강의만 가능합니다.' })
  const result = await db.enrollInCourse(req.user.id, course.id)
  const err = enrollError(res, result)
  if (err) return err
  res.json({ success: true })
})

/** @deprecated /enroll 사용 */
router.post('/:slug/enroll-free-vod', authMiddleware, async (req, res) => {
  const course = await db.getCourseBySlug(req.params.slug)
  if (!course || !course.is_published) return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })
  if (Number(course.sale_price) !== 0 || course.course_type === 'live') {
    return res.status(400).json({ error: '무료 VOD 강의가 아닙니다.' })
  }
  if (await db.isEnrolled(req.user.id, course.id)) {
    return res.json({ success: true, already: true })
  }
  const result = await db.enrollInCourse(req.user.id, course.id)
  const err = enrollError(res, result)
  if (err) return err
  res.json({ success: true })
})

module.exports = router
