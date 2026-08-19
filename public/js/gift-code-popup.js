/** 신규 가입 직후 선물코드 자동발급 팝업 — 정원 내에서 코드가 자동으로 발급되어 화면에 표시된다 */
;(function () {
  const STORAGE_KEY = 'tc_giftcode_prompt'
  let claimResult = null

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

  function clearFlag() {
    sessionStorage.removeItem(STORAGE_KEY)
  }

  function closePopup() {
    document.getElementById('gift-code-popup-overlay')?.remove()
    document.body.style.overflow = ''
    clearFlag()
  }

  function confirmClaim() {
    if (!claimResult?.ok) return
    clearFlag()
    location.href = '/courses/' + encodeURIComponent(claimResult.course_slug) + '?gift=1'
  }

  function renderBody(overlay, html) {
    const box = overlay.querySelector('.gift-code-popup')
    if (box) box.innerHTML = html
  }

  function loadingHtml() {
    return `
      <h2 id="gift-code-popup-title">가입을 환영합니다!</h2>
      <p class="gift-code-popup-body">신규 가입 이벤트 코드를 확인하는 중입니다...</p>`
  }

  function successHtml(res) {
    return `
      <button type="button" class="gift-code-popup-close" aria-label="닫기" onclick="GiftCodePopup.close()">&times;</button>
      <h2 id="gift-code-popup-title">🎁 축하합니다!</h2>
      <p class="gift-code-popup-body">
        <strong>${esc(res.course_title)}</strong> 강의를 3주간 무료로 볼 수 있는 선물코드가 발급되었습니다.<br>
        발급 코드: <strong>${esc(res.code)}</strong><br>
        24시간 이내에 강의 페이지에서 기대평을 작성하시면 무료 수강이 확정됩니다.
      </p>
      <div class="gift-code-popup-actions">
        <button type="button" class="gift-code-popup-btn primary" onclick="GiftCodePopup.confirm()">강의 보러 가기</button>
      </div>`
  }

  function fullHtml() {
    return `
      <button type="button" class="gift-code-popup-close" aria-label="닫기" onclick="GiftCodePopup.close()">&times;</button>
      <h2 id="gift-code-popup-title">가입을 환영합니다!</h2>
      <p class="gift-code-popup-body">아쉽지만 신규가입 이벤트 코드가 모두 소진되어 이번엔 참여하실 수 없습니다.</p>
      <div class="gift-code-popup-actions">
        <button type="button" class="gift-code-popup-btn secondary" onclick="GiftCodePopup.close()">닫기</button>
      </div>`
  }

  function errorHtml(message) {
    return `
      <button type="button" class="gift-code-popup-close" aria-label="닫기" onclick="GiftCodePopup.close()">&times;</button>
      <h2 id="gift-code-popup-title">가입을 환영합니다!</h2>
      <p class="gift-code-popup-body">${esc(message || '이벤트 코드를 확인할 수 없습니다.')}</p>
      <div class="gift-code-popup-actions">
        <button type="button" class="gift-code-popup-btn secondary" onclick="GiftCodePopup.close()">닫기</button>
      </div>`
  }

  async function showGiftCodePopup() {
    if (!window.API?.isLoggedIn?.()) return
    if (sessionStorage.getItem(STORAGE_KEY) !== '1') return
    if (document.getElementById('gift-code-popup-overlay')) return

    // 웰컴 팝업과 중복 노출 방지
    sessionStorage.removeItem('tc_welcome')

    ensureStyles()
    const overlay = document.createElement('div')
    overlay.id = 'gift-code-popup-overlay'
    overlay.className = 'gift-code-popup-overlay'
    overlay.innerHTML = `<div class="gift-code-popup" role="dialog" aria-labelledby="gift-code-popup-title">${loadingHtml()}</div>`
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closePopup() })
    document.body.appendChild(overlay)
    document.body.style.overflow = 'hidden'

    try {
      const res = await API.post('/courses/claim-gift-code')
      claimResult = res
      renderBody(overlay, successHtml(res))
    } catch (e) {
      claimResult = null
      if (e?.reason === 'event_not_configured') {
        // 진행 중인 이벤트가 없으면 신규가입자에게 굳이 알리지 않고 조용히 닫는다
        closePopup()
      } else if (e?.reason === 'event_full') {
        renderBody(overlay, fullHtml())
      } else {
        renderBody(overlay, errorHtml(e?.message))
      }
    }
  }

  function boot() {
    if (sessionStorage.getItem(STORAGE_KEY) === '1' && API.isLoggedIn()) {
      setTimeout(showGiftCodePopup, 300)
    }
  }

  window.GiftCodePopup = { close: closePopup, confirm: confirmClaim, show: showGiftCodePopup }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})()
