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
      const [coupons, courses] = await Promise.all([
        API.get('/my/coupons'),
        API.get('/my/courses').catch(() => []),
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
        <div class="coupon-guide-badge"><i class="ti ti-gift"></i> 수강 혜택</div>
        <h2 id="coupon-guide-title">
          <span class="coupon-guide-title-line">기대평·후기 남겨주시면</span>
          <span class="coupon-guide-title-line">제가 쿠폰 챙겨드릴게요</span>
        </h2>
        <p class="coupon-guide-lead">
          타닥클래스는 여러분의 응원 한마디를 보면서 강의를 더 좋게 다듬고 있습니다.<br>
          짧은 기대평과 후기를 남겨주시면, 강의 결제에 사용할 수 있는 할인 쿠폰을 드려요.
        </p>
        <div class="coupon-guide-steps">
          <div class="coupon-guide-step">
            <div class="coupon-guide-step-num">1</div>
            <div class="coupon-guide-step-body">
              <div class="coupon-guide-step-title">강의 듣기 전, 기대평 남기기</div>
              <p>강의 상세페이지에 기대평을 남겨주시면<br><strong>10% 할인 쿠폰</strong>을 드립니다.</p>
              <p class="coupon-guide-step-note">「이 강의 기대돼요」 정도의 짧은 한마디도 괜찮습니다.<br>
              쿠폰은 최초 유료 강의 결제 시 사용할 수 있어요.<br>
              사용 기간은 발급일로부터 1개월입니다.</p>
            </div>
          </div>
          <div class="coupon-guide-step">
            <div class="coupon-guide-step-num">2</div>
            <div class="coupon-guide-step-body">
              <div class="coupon-guide-step-title">수강 후, 5점 후기 남기기</div>
              <p>강의를 들어보신 뒤<br>
              마이페이지 &gt; 내 강의에서 5점 후기를 남겨주시면<br><strong>10% 추가 쿠폰</strong>을 드립니다.</p>
              <p class="coupon-guide-step-note">기대평 쿠폰과 함께 사용하면<br>
              최대 20%까지 할인받을 수 있어요.<br>
              사용 기간은 발급일로부터 1개월입니다.</p>
            </div>
          </div>
        </div>
        <p class="coupon-guide-tip">
          발급된 쿠폰은 <strong>마이페이지 &gt; 내 쿠폰</strong>에서 확인하실 수 있습니다.<br>
          유료 강의 결제 시 보유 쿠폰이 자동으로 적용됩니다.
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
    setTimeout(show, 400)
  }

  window.CouponGuidePopup = { close: closePopup, dismiss: dismissForever, show, goCourses }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})()
