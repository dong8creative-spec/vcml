/** 강의 상세 결제/쿠폰/환불보장 헬퍼 */
;(function (global) {
  const REFUND_GUARANTEE_LOCK_MS = 60 * 60 * 1000
  const PROGRAM_EARLY_ACCESS_MS = 2 * 60 * 60 * 1000

  function usesSmartstoreCheckout(c) {
    return !!c?.uses_smartstore_checkout
  }

  function isPaidCourse(c) {
    return Number(c?.sale_price) > 0
  }

  function isCourseCouponAllowed(c) {
    return c && c.coupon_allowed !== false && c.coupon_allowed !== 0
  }

  function shouldSkipCouponForCheckout(c, checkoutNoCoupon) {
    if (!isCourseCouponAllowed(c)) return true
    return !!checkoutNoCoupon
  }

  function renderCouponCheckoutNote(c, { checkoutNoCoupon = false, isFreeVod } = {}) {
    const freeVod = typeof isFreeVod === 'function' ? isFreeVod(c) : false
    if (c.course_type === 'live' || freeVod) return ''
    if (isPaidCourse(c)) {
      return `<p class="buy-coupon-note">네이버 스마트스토어 결제 · 쿠폰 보유 시 자동 안내</p>`
    }
    if (!isCourseCouponAllowed(c)) {
      return `<p class="buy-coupon-note buy-coupon-note--disabled">이 강의는 쿠폰 적용이 불가합니다.</p>`
    }
    if (checkoutNoCoupon) {
      return `<p class="buy-coupon-note">정가 결제 링크입니다. 보유 쿠폰이 적용되지 않습니다.</p>`
    }
    return ''
  }

  function getCourseLectureStart(c) {
    const raw = c?.live_starts_at || c?.checkout_ends_at
    if (!raw) return null
    const d = new Date(raw)
    return isNaN(d.getTime()) ? null : d
  }

  function isCourseLectureStarted(c, at = new Date()) {
    const start = getCourseLectureStart(c)
    if (!start) return true
    return at.getTime() >= start.getTime() - PROGRAM_EARLY_ACCESS_MS
  }

  function getProgramOpenAt(c) {
    const start = getCourseLectureStart(c)
    if (!start) return null
    return new Date(start.getTime() - PROGRAM_EARLY_ACCESS_MS)
  }

  function formatLectureStartLabel(date) {
    if (!date) return ''
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

  function isRefundGuaranteeActive(c, at = new Date()) {
    const start = getCourseLectureStart(c)
    if (!start) return true
    return at.getTime() < start.getTime() - REFUND_GUARANTEE_LOCK_MS
  }

  function renderBuyGuarantee(c, { isFreeVod, esc = (s) => s } = {}) {
    const freeVod = typeof isFreeVod === 'function' ? isFreeVod(c) : false
    if (c.course_type === 'live' || freeVod || !isRefundGuaranteeActive(c)) return ''
    return `<div class="buy-guarantee"><i class="ti ti-shield-check"></i> 강의 시작 1시간 전까지 전액 환불 보장</div>`
  }

  function renderCheckoutScheduleNote(c, { isFreeVod, esc = (s) => String(s || '') } = {}) {
    const freeVod = typeof isFreeVod === 'function' ? isFreeVod(c) : false
    if (c.course_type === 'live' || freeVod || !c.checkout_has_window) return ''
    const msg = c.checkout_message
    if (!msg) return ''
    const mod = c.checkout_upcoming ? ' buy-checkout-schedule--upcoming'
      : c.checkout_closed ? ' buy-checkout-schedule--closed' : ''
    return `<p class="buy-checkout-schedule${mod}"><i class="ti ti-calendar-time"></i> ${esc(msg)}</p>`
  }

  function assertCheckoutOpen(c, { isFreeVod, toast } = {}) {
    const freeVod = typeof isFreeVod === 'function' ? isFreeVod(c) : false
    if (freeVod || c.enrolled || c.checkout_open !== false) return true
    if (typeof toast === 'function') toast(c.checkout_message || '현재 결제할 수 없습니다.', 'error')
    return false
  }

  global.CourseCheckout = {
    REFUND_GUARANTEE_LOCK_MS,
    PROGRAM_EARLY_ACCESS_MS,
    usesSmartstoreCheckout,
    isPaidCourse,
    isCourseCouponAllowed,
    shouldSkipCouponForCheckout,
    renderCouponCheckoutNote,
    getCourseLectureStart,
    isCourseLectureStarted,
    getProgramOpenAt,
    formatLectureStartLabel,
    isRefundGuaranteeActive,
    renderBuyGuarantee,
    renderCheckoutScheduleNote,
    assertCheckoutOpen,
  }
})(window)
