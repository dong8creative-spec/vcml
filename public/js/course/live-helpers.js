/** 클라이언트 라이브 강의 헬퍼 */
;(function (global) {
  function isLiveLikeCourse(c) {
    if (!c) return false
    if (c.delivery_mode === 'live_first') return true
    if (c.course_type === 'live') return true
    if (c.live_starts_at || c.live_schedule) return true
    return false
  }

  function isLiveEnded(c) {
    if (!c) return false
    if (global.CourseEnrollmentUI?.isLiveEnded) return global.CourseEnrollmentUI.isLiveEnded(c)
    return c.live_status === 'ended' || c.live_ended === true || c.live_resources?.live_ended === true
  }

  function isFreeLive(c) {
    return !!(c && Number(c.sale_price) === 0 && isLiveLikeCourse(c))
  }

  function isFreeVod(c) {
    return !!(c && Number(c.sale_price) === 0 && !isLiveLikeCourse(c))
  }

  function isPaidLiveFirst(c) {
    return !!(c && Number(c.sale_price) > 0 && (c.delivery_mode === 'live_first' || c.course_type === 'live'))
  }

  global.LiveHelpers = {
    isLiveLikeCourse,
    isLiveEnded,
    isFreeLive,
    isFreeVod,
    isPaidLiveFirst,
  }
  global.isLiveLikeCourse = global.isLiveLikeCourse || isLiveLikeCourse
})(window)
