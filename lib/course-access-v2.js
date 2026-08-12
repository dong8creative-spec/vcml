/**
 * courses_v2 강의 접근 상태 계산 — 순수 함수, Firestore 호출 없음.
 * 기존 db/schema.js + lib/course-access.js에 흩어진 8~9개 접근 분기를
 * getCourseAccessState() 하나로 통합한다. kind('vod'|'live')가 강의 종류의
 * 유일한 판단 기준이며, live_starts_at/live_ends_at이 라이브 시각의 유일한
 * 출처다(과거의 live_schedule 텍스트 정규식 파싱은 마이그레이션 시점에만
 * 한 번 수행되고 이후로는 재파싱하지 않는다).
 */

const PAID_COURSE_ACCESS_MONTHS = 3
const PROGRAM_EARLY_ACCESS_MS = 2 * 60 * 60 * 1000
const MEET_OPEN_BEFORE_MS = 2 * 60 * 60 * 1000
const LIVE_END_AFTER_MS = 3 * 60 * 60 * 1000
const REPLAY_OPEN_HOUR_KST = 13
const LIVE_REVIEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const LIVE_MATERIAL_OPEN_BEFORE_MS = 60 * 60 * 1000
const LIVE_MATERIAL_AFTER_END_MS = 7 * 24 * 60 * 60 * 1000

function isLive(course) {
  return course?.kind === 'live'
}

function isPaidCourse(course) {
  return Number(course?.price) > 0
}

function toDate(value) {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function addMonthsFrom(iso, months) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  d.setMonth(d.getMonth() + months)
  return d.toISOString()
}

function kstCalendarParts(date) {
  const t = date.getTime() + 9 * 3600000
  const d = new Date(t)
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), day: d.getUTCDate() }
}

function kstDateKey(date) {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' })
}

function parseLiveStart(course) {
  return toDate(course?.live_starts_at)
}

function parseLiveEndsAt(course) {
  if (course?.live_ends_at) return toDate(course.live_ends_at)
  const start = parseLiveStart(course)
  if (!start) return null
  return new Date(start.getTime() + LIVE_END_AFTER_MS)
}

function getReplayOpensAt(course) {
  const endAt = parseLiveEndsAt(course) || parseLiveStart(course)
  if (!endAt) return null
  const { y, m, day } = kstCalendarParts(endAt)
  return new Date(Date.UTC(y, m, day + 1, REPLAY_OPEN_HOUR_KST - 9, 0, 0))
}

function isLiveCourseEnded(course, at = new Date()) {
  if (course?.live_status === 'ended') return true
  const endAt = parseLiveEndsAt(course)
  if (!endAt) return false
  return at.getTime() > endAt.getTime()
}

function isLiveLectureDay(course, at = new Date()) {
  const start = parseLiveStart(course)
  if (!start) return false
  return kstDateKey(at) === kstDateKey(start)
}

function isMeetJoinAvailable(course, at = new Date()) {
  const start = parseLiveStart(course)
  if (!start) return false
  if (course?.live_status === 'ended' || isLiveCourseEnded(course, at)) return false
  if (!String(course?.meet_code || '').trim()) return false
  const now = at.getTime()
  const t = start.getTime()
  const endAt = parseLiveEndsAt(course)
  const endMs = endAt ? endAt.getTime() : t + LIVE_END_AFTER_MS
  return now >= t - MEET_OPEN_BEFORE_MS && now <= endMs
}

function isLiveMaterialOpen(course, at = new Date()) {
  const start = parseLiveStart(course)
  const endAt = parseLiveEndsAt(course)
  if (!start || !endAt) return false
  const now = at.getTime()
  const openMs = start.getTime() - LIVE_MATERIAL_OPEN_BEFORE_MS
  const closeMs = endAt.getTime() + LIVE_MATERIAL_AFTER_END_MS
  return now >= openMs && now <= closeMs
}

function isLiveReviewOpen(course, at = new Date()) {
  if (!isLive(course)) return true
  const endAt = parseLiveEndsAt(course)
  if (!endAt) return true
  const liveEndsAt = endAt.getTime()
  if (at.getTime() < liveEndsAt) return false
  return at.getTime() <= liveEndsAt + LIVE_REVIEW_WINDOW_MS
}

function formatKstLabel(date) {
  if (!date) return null
  return date.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

/** 유료(VOD) 강의의 3개월 접근창 — 선물코드 override가 최우선 */
function resolvePaidAccessWindow(course, { enrolledAt = null, paidAt = null, accessExpiresAt = null, at = new Date() } = {}) {
  if (accessExpiresAt) {
    const endsMs = new Date(accessExpiresAt).getTime()
    const now = at.getTime()
    const access_open = now <= endsMs
    return {
      access_open,
      access_expired: !access_open,
      access_ends_at: accessExpiresAt,
      access_start_at: paidAt || enrolledAt || null,
      access_days_left: access_open ? Math.max(0, Math.ceil((endsMs - now) / 86400000)) : 0,
      access_months: null,
      source: 'gift_code',
    }
  }

  if (!isPaidCourse(course) || isLive(course)) {
    return {
      access_open: true,
      access_expired: false,
      access_ends_at: null,
      access_start_at: paidAt || enrolledAt || null,
      access_days_left: null,
      access_months: null,
      source: isLive(course) ? 'live_unlimited' : 'free',
    }
  }

  const accessStartAt = paidAt || enrolledAt || null
  if (!accessStartAt) {
    return {
      access_open: true,
      access_expired: false,
      access_ends_at: null,
      access_start_at: null,
      access_days_left: null,
      access_months: PAID_COURSE_ACCESS_MONTHS,
      source: 'paid_window_no_start',
    }
  }
  const endsAtIso = addMonthsFrom(accessStartAt, PAID_COURSE_ACCESS_MONTHS)
  if (!endsAtIso) {
    return {
      access_open: true,
      access_expired: false,
      access_ends_at: null,
      access_start_at: accessStartAt,
      access_days_left: null,
      access_months: PAID_COURSE_ACCESS_MONTHS,
      source: 'paid_window_invalid_start',
    }
  }
  const endsMs = new Date(endsAtIso).getTime()
  const now = at.getTime()
  const access_open = now <= endsMs
  return {
    access_open,
    access_expired: !access_open,
    access_ends_at: endsAtIso,
    access_start_at: accessStartAt,
    access_days_left: access_open ? Math.max(0, Math.ceil((endsMs - now) / 86400000)) : 0,
    access_months: PAID_COURSE_ACCESS_MONTHS,
    source: 'paid_window',
  }
}

function resolveLiveState(course, access, at = new Date()) {
  if (!isLive(course)) return null
  const start = parseLiveStart(course)
  const endAt = parseLiveEndsAt(course)
  const lectureEnded = isLiveCourseEnded(course, at)
  const replayUrl = String(course?.live_replay_url || '').trim()
  const materialUrl = String(course?.live_material_url || '').trim()
  const replayOpensAt = getReplayOpensAt(course)
  const replayReady = replayOpensAt ? at.getTime() >= replayOpensAt.getTime() : false
  const replayAvailableBase = !!replayUrl && lectureEnded && replayReady
  const meetConfigured = !!String(course?.meet_code || '').trim()
  return {
    lecture_start: start ? start.toISOString() : null,
    lecture_end: endAt ? endAt.toISOString() : null,
    lecture_date_label: start
      ? start.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric' })
      : null,
    is_lecture_day: isLiveLectureDay(course, at),
    ended: lectureEnded,
    replay: {
      configured: !!replayUrl,
      available: replayAvailableBase && access.access_open,
      expired: replayAvailableBase && access.access_expired,
      pending: !!replayUrl && lectureEnded && !replayReady,
      opens_at: replayOpensAt ? replayOpensAt.toISOString() : null,
      opens_label: replayOpensAt ? formatKstLabel(replayOpensAt) : null,
    },
    material: {
      configured: !!materialUrl,
      open: isLiveMaterialOpen(course, at),
    },
    meet: {
      configured: meetConfigured,
      join_available: meetConfigured && isMeetJoinAvailable(course, at),
      opens_at: start ? new Date(start.getTime() - MEET_OPEN_BEFORE_MS).toISOString() : null,
    },
    review: {
      open: isLiveReviewOpen(course, at),
      closes_at: endAt ? new Date(endAt.getTime() + LIVE_REVIEW_WINDOW_MS).toISOString() : null,
    },
  }
}

function resolveCheckoutWindow(course, at = new Date()) {
  const isFree = !isLive(course) && Number(course?.price) === 0
  const starts = toDate(course?.checkout_starts_at)
  const ends = toDate(course?.checkout_ends_at)
  const now = at.getTime()
  const base = {
    starts_at: starts ? starts.toISOString() : null,
    ends_at: ends ? ends.toISOString() : null,
    starts_label: formatKstLabel(starts),
    ends_label: formatKstLabel(ends),
    has_window: !!(starts || ends),
  }
  if (isLive(course) || isFree || (!starts && !ends)) {
    return { ...base, open: true, closed: false, upcoming: false, status: 'unlimited', message: null }
  }
  if (starts && now < starts.getTime()) {
    const label = formatKstLabel(starts)
    return { ...base, open: false, closed: false, upcoming: true, status: 'upcoming', message: label ? `${label}부터 결제할 수 있습니다.` : '결제 시작 전입니다.' }
  }
  if (ends && now > ends.getTime()) {
    const label = formatKstLabel(ends)
    return { ...base, open: false, closed: true, upcoming: false, status: 'closed', message: label ? `${label}에 결제가 마감되었습니다.` : '결제 기간이 종료되었습니다.' }
  }
  const endsLabel = formatKstLabel(ends)
  return { ...base, open: true, closed: false, upcoming: false, status: 'open', message: endsLabel ? `${endsLabel}까지 결제 가능` : null }
}

function resolveProgramAccess(course, program, at = new Date()) {
  const raw = course?.live_starts_at || course?.checkout_ends_at
  const start = toDate(raw)
  if (!start) return { open: true, early_access_ms: PROGRAM_EARLY_ACCESS_MS, lecture_start: null }
  const hours = Number(program?.early_access_hours)
  const offsetMs = Number.isFinite(hours) && hours >= 0 ? hours * 60 * 60 * 1000 : PROGRAM_EARLY_ACCESS_MS
  return {
    open: at.getTime() >= start.getTime() - offsetMs,
    early_access_ms: offsetMs,
    lecture_start: start.toISOString(),
  }
}

function resolveEnrollmentStats(course) {
  const limit = Math.max(0, parseInt(course?.enrollment_limit, 10) || 0)
  const count = Math.max(0, parseInt(course?.student_count, 10) || 0)
  if (limit <= 0) return { limit: 0, count, has_limit: false, full: false, remaining: null }
  return { limit, count, has_limit: true, full: count >= limit, remaining: Math.max(0, limit - count) }
}

function isCourseCouponAllowed(course) {
  if (!course) return false
  return course.coupon_allowed !== false && course.coupon_allowed !== 0
}

/**
 * 강의 접근 상태 전체를 한 번에 계산한다.
 * @param {object} course - courses_v2 문서
 * @param {object} ctx - { enrollment, order, program, giftReservation, at }
 */
function getCourseAccessState(course, ctx = {}) {
  const at = ctx.at instanceof Date ? ctx.at : new Date()
  const enrollment = ctx.enrollment || null
  const order = ctx.order || null
  const program = ctx.program || null
  const giftReservation = ctx.giftReservation || null

  const enrolled = !!enrollment
  const access = resolvePaidAccessWindow(course, {
    enrolledAt: enrollment?.enrolled_at || null,
    paidAt: order?.paid_at || null,
    accessExpiresAt: enrollment?.access_expires_at || null,
    at,
  })

  return {
    enrolled,
    access,
    live: resolveLiveState(course, access, at),
    checkout: resolveCheckoutWindow(course, at),
    program_access: program !== undefined ? resolveProgramAccess(course, program, at) : null,
    enrollment_stats: resolveEnrollmentStats(course),
    coupon_allowed: isCourseCouponAllowed(course),
    gift_reservation_pending: !!giftReservation,
    gift_review_deadline: giftReservation?.review_deadline || null,
    is_paid: isPaidCourse(course),
    is_live: isLive(course),
  }
}

module.exports = {
  PAID_COURSE_ACCESS_MONTHS,
  PROGRAM_EARLY_ACCESS_MS,
  isLive,
  isPaidCourse,
  isCourseCouponAllowed,
  parseLiveStart,
  parseLiveEndsAt,
  isLiveCourseEnded,
  getReplayOpensAt,
  getCourseAccessState,
  resolvePaidAccessWindow,
  resolveLiveState,
  resolveCheckoutWindow,
  resolveProgramAccess,
  resolveEnrollmentStats,
}
