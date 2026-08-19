/** 마이페이지 — 할인 쿠폰 발급 안내 팝업 */
;(function () {
  const STORAGE_KEY = 'tc_coupon_guide_hide'

  function ensureStyles() {
    if (document.querySelector('link[href="/css/coupon-guide-popup.css"]')) return
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = '/css/coupon-guide-popup.css'
    document.head.appendChild(link)
  }

  function closePopup() {
    document.getElementById('coupon-guide-overlay')?.remove()
    document.body.style.overflow = ''
  }

  function dismissForever() {
    localStorage.setItem(STORAGE_KEY, '1')
    closePopup()
  }

  async function shouldShow() {
    if (!window.API?.isLoggedIn?.()) return false
    if (localStorage.getItem(STORAGE_KEY) === '1') return false
    if (!location.pathname.endsWith('/mypage.html') && location.pathname !== '/mypage.html') return false

    try {
      const coursesPromise = window.__myCoursesPromise || API.get('/my/courses').catch(() => [])
      window.__myCoursesPromise = coursesPromise
      const [coupons, courses] = await Promise.all([
        API.get('/my/coupons'),
        coursesPromise.catch(() => []),
      ])
      const available = (coupons || []).filter(c => c.status === 'available')
      const hasAnticipation = available.some(c => c.reason === 'anticipation_review')
      const hasReviewCoupon = available.some(c => c.reason === 'course_review_five_star')
      const canWriteReview = (courses || []).some(c => c.course_type !== 'live' && c.my_review?.rating !== 5)

      if (!hasAnticipation) return true
      if (canWriteReview && !hasReviewCoupon) return true
      return false
    } catch {
      return true
    }
  }

  function renderPopup() {
    if (document.getElementById('coupon-guide-overlay')) return

    ensureStyles()
    const overlay = document.createElement('div')
    overlay.id = 'coupon-guide-overlay'
    overlay.className = 'coupon-guide-overlay'
    overlay.innerHTML = `
      <div class="coupon-guide" role="dialog" aria-labelledby="coupon-guide-title">
        <button type="button" class="coupon-guide-close" aria-label="닫기" onclick="CouponGuidePopup.close()">&times;</button>
        <div class="coupon-guide-badge"><i class="ti ti-gift"></i> 작은 선물</div>
        <h2 id="coupon-guide-title">
          <span class="coupon-guide-title-line">짧은 한마디 남겨 주시면</span>
          <span class="coupon-guide-title-line">할인 쿠폰을 챙겨드릴게요</span>
        </h2>
        <p class="coupon-guide-lead">
          강의 듣기 전에 기대평을 남기시면 10% 쿠폰을 드려요.
          듣고 나서 후기를 남겨 주시면 1장 더 드려요.
        </p>
        <div class="coupon-guide-actions">
          <a href="/" class="coupon-guide-btn primary">강의 둘러보기</a>
          <button type="button" class="coupon-guide-btn secondary" onclick="CouponGuidePopup.goCourses()">내 강의 보기</button>
        </div>
        <button type="button" class="coupon-guide-dismiss" onclick="CouponGuidePopup.dismiss()">다시 보지 않기</button>
      </div>`
    overlay.addEventListener('click', e => { if (e.target === overlay) closePopup() })
    document.body.appendChild(overlay)
    document.body.style.overflow = 'hidden'
    overlay.querySelector('.coupon-guide-close')?.focus()
  }

  async function show() {
    if (!(await shouldShow())) return
    renderPopup()
  }

  function goCourses() {
    closePopup()
    if (typeof showSection === 'function') {
      showSection('courses')
    } else {
      location.href = '/mypage.html?tab=courses'
    }
  }

  async function boot() {
    if (!window.API?.isLoggedIn?.()) return
    setTimeout(() => {
      if (sessionStorage.getItem('tc_welcome') === '1') return
      if (document.getElementById('welcome-popup-overlay')) return
      if (document.querySelector('.phone-prompt-overlay')) return
      show()
    }, 400)
  }

  window.CouponGuidePopup = { close: closePopup, dismiss: dismissForever, show, goCourses }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})()
