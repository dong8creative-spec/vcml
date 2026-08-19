/** 선물코드로 받은 무료 시청권이 살아있는 동안, 로그인할 때마다 남은 기간을 안내하는 리마인더 */
;(function () {
  const STORAGE_KEY = 'tc_check_gift_access'

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  function ensureStyles() {
    if (document.querySelector('link[href="/css/gift-code-popup.css"]')) return
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = '/css/gift-code-popup.css'
    document.head.appendChild(link)
  }

  function closePopup() {
    document.getElementById('gift-access-reminder-overlay')?.remove()
    document.body.style.overflow = ''
  }

  function goWatch(slug) {
    closePopup()
    location.href = '/courses/' + encodeURIComponent(slug)
  }

  function showReminder(access) {
    if (document.getElementById('gift-access-reminder-overlay')) return
    ensureStyles()
    const overlay = document.createElement('div')
    overlay.id = 'gift-access-reminder-overlay'
    overlay.className = 'gift-code-popup-overlay'
    overlay.innerHTML = `
      <div class="gift-code-popup" role="dialog" aria-labelledby="gift-access-reminder-title">
        <button type="button" class="gift-code-popup-close" aria-label="닫기" onclick="GiftAccessReminder.close()">&times;</button>
        <h2 id="gift-access-reminder-title">🎁 무료 시청권이 남아있어요</h2>
        <p class="gift-code-popup-body">
          <strong>${esc(access.course_title)}</strong> 무료 시청이 <strong>${access.access_days_left}일</strong> 후 종료됩니다.<br>
          지금 다시 보러 가시겠어요?
        </p>
        <div class="gift-code-popup-actions">
          <button type="button" class="gift-code-popup-btn primary" onclick="GiftAccessReminder.watch('${esc(access.course_slug)}')">강의 보러 가기</button>
          <button type="button" class="gift-code-popup-btn secondary" onclick="GiftAccessReminder.close()">나중에</button>
        </div>
      </div>`
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closePopup() })
    document.body.appendChild(overlay)
    document.body.style.overflow = 'hidden'
  }

  async function checkAndShow() {
    if (!window.API?.isLoggedIn?.()) return
    if (sessionStorage.getItem(STORAGE_KEY) !== '1') return
    sessionStorage.removeItem(STORAGE_KEY)
    // 신규가입 직후 선물코드 발급 팝업과 겹치지 않도록 양보
    if (sessionStorage.getItem('tc_giftcode_prompt') === '1') return
    try {
      const res = await API.get('/courses/gift-access-status')
      if (res?.active) showReminder(res)
    } catch {}
  }

  function boot() {
    setTimeout(checkAndShow, 400)
  }

  window.GiftAccessReminder = { close: closePopup, watch: goWatch }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})()
