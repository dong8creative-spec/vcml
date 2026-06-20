/** 전화번호 수집 — 라이브 알림톡 · 마케팅용 */
;(function () {
  let cachedPhone = null

  function ensureStyles() {
    if (document.querySelector('link[href="/css/phone-prompt.css"]')) return
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = '/css/phone-prompt.css?v=6'
    document.head.appendChild(link)
  }

  function formatPhoneInput(el) {
    let v = el.value.replace(/\D/g, '').slice(0, 11)
    if (v.length > 7) el.value = `${v.slice(0, 3)}-${v.slice(3, 7)}-${v.slice(7)}`
    else if (v.length > 3) el.value = `${v.slice(0, 3)}-${v.slice(3)}`
    else el.value = v
  }

  async function fetchPhone() {
    if (!window.API?.isLoggedIn?.()) return null
    if (cachedPhone) return cachedPhone
    try {
      const p = await API.get('/my/profile')
      cachedPhone = p.phone || null
      if (cachedPhone) {
        const u = { ...API.user(), phone: cachedPhone }
        localStorage.setItem('tc_user', JSON.stringify(u))
      }
      return cachedPhone
    } catch {
      return null
    }
  }

  function showPhoneModal({ title, message, required = true } = {}) {
    ensureStyles()
    return new Promise(resolve => {
      const overlay = document.createElement('div')
      overlay.className = 'phone-prompt-overlay'
      overlay.innerHTML = `
        <div class="phone-prompt" role="dialog">
          <h3>${title || '휴대폰 번호 등록'}</h3>
          <p>${message || '라이브 강의 안내·알림톡 수신을 위해 휴대폰 번호가 필요합니다.'}</p>
          <input type="tel" id="phone-prompt-input" placeholder="010-0000-0000" maxlength="13" autocomplete="tel" />
          <div class="phone-prompt-actions">
            ${required ? '' : '<button type="button" class="secondary" data-act="skip">나중에</button>'}
            <button type="button" class="primary" data-act="save">저장</button>
          </div>
        </div>`
      document.body.appendChild(overlay)
      const input = overlay.querySelector('#phone-prompt-input')
      input.addEventListener('input', () => formatPhoneInput(input))
      input.focus()

      async function save() {
        const digits = input.value.replace(/\D/g, '')
        if (!/^010\d{8}$/.test(digits)) {
          toast('010으로 시작하는 11자리 번호를 입력해주세요.', 'error')
          return
        }
        try {
          const res = await API.patch('/my/profile', { phone: input.value.trim() })
          cachedPhone = res.user.phone
          const u = { ...API.user(), phone: cachedPhone }
          localStorage.setItem('tc_user', JSON.stringify(u))
          overlay.remove()
          resolve(true)
        } catch (e) {
          toast(e.message, 'error')
        }
      }

      overlay.querySelector('[data-act="save"]').onclick = save
      overlay.querySelector('[data-act="skip"]')?.addEventListener('click', () => {
        overlay.remove()
        resolve(false)
      })
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') save()
      })
    })
  }

  /** 라이브 신청 등 필수 — 번호 없으면 모달 */
  window.ensurePhone = async function ensurePhone(opts) {
    if (!API.isLoggedIn()) return false
    const phone = await fetchPhone()
    if (phone) return true
    return showPhoneModal({ required: true, ...opts })
  }

  /** 로그인 직후 1회 권장 (세션당) */
  async function maybePromptAfterLogin() {
    if (!API.isLoggedIn()) return
    if (sessionStorage.getItem('tc_phone_prompted') === '1') return
    const phone = await fetchPhone()
    if (phone) return
    sessionStorage.setItem('tc_phone_prompted', '1')
    setTimeout(() => {
      showPhoneModal({
        required: false,
        title: '알림을 받으려면 번호가 필요해요',
        message: '라이브 강의 일정·카카오 알림톡 안내를 받으시려면 휴대폰 번호를 등록해주세요. 마이페이지에서도 변경할 수 있습니다.',
      })
    }, 1200)
  }

  window.formatPhoneInput = formatPhoneInput
  window.invalidatePhoneCache = () => { cachedPhone = null }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', maybePromptAfterLogin)
  } else {
    maybePromptAfterLogin()
  }
})()
