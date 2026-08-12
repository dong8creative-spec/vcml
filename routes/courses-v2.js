const express = require('express')
const router = express.Router()
const { optionalAuth } = require('../middleware/auth')
const coursesV2 = require('../db/courses-v2')
const legacyDb = require('../db/schema')
const { getCourseAccessState } = require('../lib/course-access-v2')

function stripCourseMediaFields(course) {
  if (!course || typeof course !== 'object') return course
  const {
    thumbnail_url, thumbnail_image, hero_gallery, detail_intro_text,
    detail_intro_images, detail_intro_image, live_curriculum_image, instructor_avatar,
    ...rest
  } = course
  return {
    ...rest,
    thumbnail_url: typeof thumbnail_url === 'string' && thumbnail_url.startsWith('http') ? thumbnail_url : null,
    thumbnail_image: typeof thumbnail_image === 'string' && thumbnail_image.startsWith('http') ? thumbnail_image : null,
  }
}

/** 강의종류×라이브상태×가격유형×수강여부 조합을 하나의 상태값으로 축약 */
function resolveUiState(course, state) {
  if (state.is_live) {
    if (!state.live) return 'live_upcoming'
    if (!state.live.ended) {
      return state.live.meet.join_available ? 'live_joinable' : 'live_upcoming'
    }
    if (state.live.replay.available) return 'live_replay_available'
    if (state.live.replay.expired) return 'live_replay_expired'
    return 'live_day_ended_pending_replay'
  }
  if (!state.is_paid) return 'vod_free'
  if (!state.enrolled) return 'vod_paid_locked'
  return state.access.access_expired ? 'vod_paid_expired' : 'vod_paid_open'
}

router.get('/', async (req, res) => {
  try {
    res.json(await coursesV2.getCourses({ publishedOnly: true }))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

/** 옛 GET /api/courses(카드 목록)와 동일한 형태 — courses.html/catalog-cards.js 재사용용 */
router.get('/legacy', async (req, res) => {
  try {
    const courses = await coursesV2.getCourses({ publishedOnly: true })
    res.json(courses.map(c => legacyDb.pickCourseCardFields(coursesV2.toLegacyShape(c))))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

/**
 * courses_v2 기반이지만 옛 GET /api/courses/:slug와 동일한 응답 형태를 반환한다.
 * course.html의 검증된 렌더링·체크아웃·라이브 로직을 그대로 재사용하기 위한 호환 엔드포인트.
 */
router.get('/:slug/legacy', optionalAuth, async (req, res) => {
  try {
    const raw = await coursesV2.getCourseBySlug(req.params.slug)
    if (!raw || !raw.is_published) return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })
    const course = coursesV2.toLegacyShape(raw)

    const anticipation_modify = legacyDb.getAnticipationModifyMeta(course)
    const u = req.user || null

    const [chapters, enrollmentRecord, orderRecord, myAnticipation, myCourseReview, giftReservation] = await Promise.all([
      coursesV2.getChaptersByCourse(course.id),
      u ? coursesV2.getEnrollmentRecord(u.id, course.id) : Promise.resolve(null),
      u ? coursesV2.getActiveOrderForCourse(u.id, course.id) : Promise.resolve(null),
      u ? legacyDb.getAnticipationReviewByUserAndCourse(u.id, course.id) : Promise.resolve(null),
      u ? legacyDb.getReviewByUserAndCourse(u.id, course.id) : Promise.resolve(null),
      u ? coursesV2.getPendingGiftReservation(u.id, course.id) : Promise.resolve(null),
    ])

    const enrolled = !!enrollmentRecord
    const accessStartAt = legacyDb.resolveEnrollmentAccessStart({
      enrolledAt: enrollmentRecord?.enrolled_at,
      paidAt: orderRecord?.paid_at,
    })
    const access = enrolled && u
      ? legacyDb.getPaidCourseAccessMeta(course, {
        enrolledAt: enrollmentRecord?.enrolled_at,
        paidAt: orderRecord?.paid_at,
        accessExpiresAt: enrollmentRecord?.access_expires_at || null,
      })
      : null
    const my_anticipation = myAnticipation ? {
      id: myAnticipation.id,
      content: myAnticipation.content,
      created_at: myAnticipation.created_at,
      can_edit: anticipation_modify.can_modify,
    } : null
    const myReviewRewardLocked = myCourseReview && u
      ? await legacyDb.isCourseReviewRewardLocked(u.id, course.id, myCourseReview)
      : false

    const payload = {
      ...(await legacyDb.enrichCourseEnrollment(stripCourseMediaFields(legacyDb.stripLiveResourceUrls(course)))),
      checkout_provider: course.checkout_provider === 'smartstore' ? 'smartstore' : 'site',
      uses_smartstore_checkout: legacyDb.usesSmartstoreCheckout(course),
      chapters,
      enrolled,
      auth_expired: false,
      access,
      my_anticipation,
      my_review: myCourseReview ? {
        rating: myCourseReview.rating,
        content: myCourseReview.content || '',
        created_at: myCourseReview.created_at || null,
        reward_locked: myReviewRewardLocked,
      } : null,
      anticipation_modify,
      live_ended: legacyDb.courseSupportsLiveReplay(course) ? legacyDb.isLiveCourseEnded(course) : false,
      gift_reservation: giftReservation,
    }
    if (!enrolled) delete payload.live_chat_url
    if (legacyDb.courseSupportsLiveReplay(course)) {
      payload.live_resources = legacyDb.getLiveResourceAccess(course, {
        enrolled: !!enrolled,
        hasReview: !!(myCourseReview && myCourseReview.rating),
        reviewSubmittedAt: myCourseReview?.created_at || myCourseReview?.updated_at || null,
        accessStartAt,
        paidAt: orderRecord?.paid_at,
      })
    }
    try {
      payload.program = await coursesV2.getProgramForCourse(course)
    } catch {
      payload.program = null
    }
    res.json(payload)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.get('/:slug/view', optionalAuth, async (req, res) => {
  try {
    const course = await coursesV2.getCourseBySlug(req.params.slug)
    if (!course || !course.is_published) return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })
    const u = req.user || null

    const [chapters, enrollment, order, program, giftReservation] = await Promise.all([
      coursesV2.getChaptersByCourse(course.id),
      u ? coursesV2.getEnrollmentRecord(u.id, course.id) : Promise.resolve(null),
      u ? coursesV2.getActiveOrderForCourse(u.id, course.id) : Promise.resolve(null),
      coursesV2.getProgramForCourse(course).catch(() => null),
      u ? coursesV2.getPendingGiftReservation(u.id, course.id) : Promise.resolve(null),
    ])

    const state = getCourseAccessState(course, { enrollment, order, program, giftReservation })
    const uiState = resolveUiState(course, state)
    const enrolled = state.enrolled

    const courseOut = {
      id: course.id,
      slug: course.slug,
      title: course.title,
      description: course.description,
      category: course.category,
      kind: course.kind,
      price: course.price,
      list_price: course.list_price,
      badge: course.badge,
      thumbnail_url: course.thumbnail_url,
      thumbnail_icon: course.thumbnail_icon,
      thumb_style: course.thumb_style,
      hero_gallery: course.hero_gallery,
      detail_intro_text: course.detail_intro_text,
      detail_intro_images: course.detail_intro_images,
      learning_outcomes: course.learning_outcomes,
      target_audience: course.target_audience,
      instructor_name: course.instructor_name,
      instructor_role: course.instructor_role,
      instructor_bio: course.instructor_bio,
      instructor_avatar: course.instructor_avatar,
      live_starts_at: course.live_starts_at,
      live_ends_at: course.live_ends_at,
      live_schedule_label: course.live_schedule_label,
      live_curriculum_text: course.live_curriculum_text,
      live_curriculum_image: course.live_curriculum_image,
      enrollment_limit: course.enrollment_limit,
      checkout_provider: course.checkout_provider,
      store_checkout_urls: course.store_checkout_urls,
      program_id: course.program_id,
    }
    // 수강생에게만 라이브 리소스 URL 노출 (기존 stripLiveResourceUrls와 동일한 취지)
    if (enrolled) {
      courseOut.meet_code = course.meet_code
      courseOut.live_chat_url = course.live_chat_url
      courseOut.live_replay_url = course.live_replay_url
      courseOut.live_material_url = course.live_material_url
    }

    res.json({
      course: courseOut,
      chapters,
      enrolled,
      ui_state: uiState,
      access: state.access,
      live: state.live,
      checkout: state.checkout,
      enrollment_stats: state.enrollment_stats,
      coupon_allowed: state.coupon_allowed,
      gift_reservation: giftReservation,
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
