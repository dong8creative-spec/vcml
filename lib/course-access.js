/**
 * 강의 수강·결제 접근 순수 헬퍼 (DB/라우트 공용)
 * schema.js의 동기 로직을 분리해 도메인 경계를 명확히 합니다.
 */

function addMonthsFrom(iso, months) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  d.setMonth(d.getMonth() + months)
  return d.toISOString()
}

const PAID_COURSE_ACCESS_MONTHS = 3
const PROGRAM_EARLY_ACCESS_MS = 2 * 60 * 60 * 1000

function isPaidCourse(course) {
  return Number(course?.sale_price) > 0
}

function resolveEnrollmentAccessStart({ enrolledAt = null, paidAt = null } = {}) {
  return paidAt || enrolledAt || null
}

function courseSupportsLiveReplayLite(course) {
  if (!course) return false
  if (course.delivery_mode === 'live_first') return true
  if (course.course_type === 'live') return true
  return false
}

function getPaidCourseAccessMeta(course, { enrolledAt = null, paidAt = null, at = new Date() } = {}, opts = {}) {
  const supportsReplay = typeof opts.supportsLiveReplay === 'boolean'
    ? opts.supportsLiveReplay
    : courseSupportsLiveReplayLite(course)

  if (!isPaidCourse(course) || supportsReplay) {
    return {
      access_open: true,
      access_expired: false,
      access_ends_at: null,
      access_start_at: resolveEnrollmentAccessStart({ enrolledAt, paidAt }),
      access_days_left: null,
      access_months: null,
    }
  }
  const accessStartAt = resolveEnrollmentAccessStart({ enrolledAt, paidAt })
  if (!accessStartAt) {
    return {
      access_open: true,
      access_expired: false,
      access_ends_at: null,
      access_start_at: null,
      access_days_left: null,
      access_months: PAID_COURSE_ACCESS_MONTHS,
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
    access_days_left: access_open ? Math.max(0, Math.ceil((endsMs - now) / (24 * 60 * 60 * 1000))) : 0,
    access_months: PAID_COURSE_ACCESS_MONTHS,
  }
}

function isCourseCouponAllowed(course) {
  if (!course) return false
  return course.coupon_allowed !== false && course.coupon_allowed !== 0
}

function canApplyCourseCoupon(course, { skipCoupon = false } = {}) {
  if (!isCourseCouponAllowed(course)) return false
  if (skipCoupon) return false
  return true
}

function normalizeStoreCheckoutUrls(urls = {}) {
  const clean = (value) => {
    const s = String(value || '').trim().slice(0, 500)
    return s || null
  }
  return {
    none: clean(urls.none),
    discount_10: clean(urls.discount_10),
    discount_20: clean(urls.discount_20),
  }
}

function usesSmartstoreCheckout(course) {
  if (!course || course.checkout_provider !== 'smartstore') return false
  const urls = course.store_checkout_urls || {}
  return !!urls.none
}

function parseCheckoutAt(value) {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function formatCheckoutLabel(date) {
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

function getCheckoutWindowPublic(course, at = new Date()) {
  const isLive = course?.course_type === 'live'
  const isFree = !isLive && Number(course?.sale_price) === 0
  const starts = parseCheckoutAt(course?.checkout_starts_at)
  const ends = parseCheckoutAt(course?.checkout_ends_at)
  const now = at.getTime()
  const base = {
    checkout_starts_at: starts ? starts.toISOString() : null,
    checkout_ends_at: ends ? ends.toISOString() : null,
    checkout_starts_label: formatCheckoutLabel(starts),
    checkout_ends_label: formatCheckoutLabel(ends),
    checkout_has_window: !!(starts || ends),
  }

  if (isLive || isFree || (!starts && !ends)) {
    return {
      ...base,
      checkout_open: true,
      checkout_closed: false,
      checkout_upcoming: false,
      checkout_status: 'unlimited',
      checkout_message: null,
      checkout_panel_label: null,
    }
  }

  if (starts && now < starts.getTime()) {
    const label = formatCheckoutLabel(starts)
    return {
      ...base,
      checkout_open: false,
      checkout_closed: false,
      checkout_upcoming: true,
      checkout_status: 'upcoming',
      checkout_message: label ? `${label}부터 결제할 수 있습니다.` : '결제 시작 전입니다.',
      checkout_panel_label: '결제 전',
    }
  }

  if (ends && now > ends.getTime()) {
    const label = formatCheckoutLabel(ends)
    return {
      ...base,
      checkout_open: false,
      checkout_closed: true,
      checkout_upcoming: false,
      checkout_status: 'closed',
      checkout_message: label ? `${label}에 결제가 마감되었습니다.` : '결제 기간이 종료되었습니다.',
      checkout_panel_label: '결제마감',
    }
  }

  const endsLabel = formatCheckoutLabel(ends)
  return {
    ...base,
    checkout_open: true,
    checkout_closed: false,
    checkout_upcoming: false,
    checkout_status: 'open',
    checkout_message: endsLabel ? `${endsLabel}까지 결제 가능` : null,
    checkout_panel_label: null,
  }
}

function isCheckoutBlockedForPurchase(course, at = new Date()) {
  return !getCheckoutWindowPublic(course, at).checkout_open
}

function getCourseLectureStartAt(course) {
  const raw = course?.live_starts_at || course?.checkout_ends_at
  if (!raw) return null
  const d = new Date(raw)
  return isNaN(d.getTime()) ? null : d
}

function getProgramEarlyAccessMs(program) {
  const hours = Number(program?.early_access_hours)
  if (Number.isFinite(hours) && hours >= 0) return hours * 60 * 60 * 1000
  return PROGRAM_EARLY_ACCESS_MS
}

function isProgramAccessOpen(course, program = null, at = new Date()) {
  const start = getCourseLectureStartAt(course)
  if (!start) return true
  const offsetMs = getProgramEarlyAccessMs(program)
  return at.getTime() >= start.getTime() - offsetMs
}

function isCourseLectureStarted(course, at = new Date()) {
  return isProgramAccessOpen(course, null, at)
}

function normalizeCheckoutWindowInput(startsAt, endsAt) {
  const starts = startsAt ? parseCheckoutAt(startsAt) : null
  const ends = endsAt ? parseCheckoutAt(endsAt) : null
  if (startsAt && !starts) return { error: 'invalid_starts' }
  if (endsAt && !ends) return { error: 'invalid_ends' }
  if (starts && ends && starts.getTime() >= ends.getTime()) return { error: 'invalid_range' }
  return {
    checkout_starts_at: starts ? starts.toISOString() : null,
    checkout_ends_at: ends ? ends.toISOString() : null,
  }
}

function normalizeLiveWindowInput(startsAt, endsAt) {
  const starts = startsAt ? parseCheckoutAt(startsAt) : null
  const ends = endsAt ? parseCheckoutAt(endsAt) : null
  if (startsAt && !starts) return { error: 'invalid_live_starts' }
  if (endsAt && !ends) return { error: 'invalid_live_ends' }
  if (starts && ends && starts.getTime() >= ends.getTime()) return { error: 'invalid_live_range' }
  return {
    live_starts_at: starts ? starts.toISOString() : null,
    live_ends_at: ends ? ends.toISOString() : null,
  }
}

module.exports = {
  PAID_COURSE_ACCESS_MONTHS,
  PROGRAM_EARLY_ACCESS_MS,
  addMonthsFrom,
  isPaidCourse,
  resolveEnrollmentAccessStart,
  courseSupportsLiveReplayLite,
  getPaidCourseAccessMeta,
  isCourseCouponAllowed,
  canApplyCourseCoupon,
  normalizeStoreCheckoutUrls,
  usesSmartstoreCheckout,
  parseCheckoutAt,
  formatCheckoutLabel,
  getCheckoutWindowPublic,
  isCheckoutBlockedForPurchase,
  getCourseLectureStartAt,
  getProgramEarlyAccessMs,
  isProgramAccessOpen,
  isCourseLectureStarted,
  normalizeCheckoutWindowInput,
  normalizeLiveWindowInput,
}
