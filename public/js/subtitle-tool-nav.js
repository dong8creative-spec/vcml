/**
 * 타닥싱크 서브 네비게이션 — body[data-st-active] 로 현재 탭 지정
 * home | start | pricing | guide
 */
(function () {
  const TABS = [
    { key: 'home', href: '/subtitle-tool.html', label: '홈', icon: 'ti-home' },
    { key: 'start', href: '/subtitle-tool/start.html', label: '시작하기', icon: 'ti-download' },
    { key: 'pricing', href: '/subtitle-tool/pricing.html', label: '요금', icon: 'ti-coin' },
    { key: 'guide', href: '/subtitle-tool/guide.html', label: '사용법', icon: 'ti-book' },
  ]

  function renderSubnav() {
    const mount = document.querySelector('[data-st-subnav]')
    if (!mount) return
    const active = document.body.dataset.stActive || 'home'
    mount.className = 'st-subnav'
    mount.innerHTML = TABS.map((tab) => {
      const cls = tab.key === active ? ' class="on"' : ''
      return `<a href="${tab.href}"${cls}><i class="ti ${tab.icon}"></i>${tab.label}</a>`
    }).join('')
  }

  function initPlanToggle() {
    const toggle = document.getElementById('st-plan-toggle')
    if (!toggle) return
    const buttons = toggle.querySelectorAll('button')
    const cards = document.querySelectorAll('#st-plan-grid .st-plan-card, #st-plan-grid [data-plan]')
    function applyBill(mode) {
      buttons.forEach((b) => b.classList.toggle('on', b.dataset.bill === mode))
      cards.forEach((card) => {
        const priceEl = card.querySelector('.plan-price')
        const billEl = card.querySelector('.plan-bill')
        if (!priceEl || !billEl) return
        if (mode === 'annual') {
          priceEl.innerHTML = `${priceEl.dataset.annualMonthly}<small>원/월</small>`
          billEl.textContent = billEl.dataset.annual || ''
        } else {
          priceEl.innerHTML = `${priceEl.dataset.monthly}<small>원/월</small>`
          billEl.textContent = billEl.dataset.monthly || ''
        }
      })
    }
    buttons.forEach((btn) => {
      btn.addEventListener('click', () => applyBill(btn.dataset.bill || 'monthly'))
    })
  }

  renderSubnav()
  initPlanToggle()
})()
