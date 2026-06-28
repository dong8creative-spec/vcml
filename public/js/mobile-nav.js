/** 모바일 하단 탭 + 햄버거 메뉴 */
;(function () {
  if (location.pathname.includes('admin.html')) return

  const BOTTOM_TABS = [
    { href: '/', label: '홈', icon: 'ti-home', match: p => p === '/' || p === '/index.html' },
    { href: '/#all', label: '강의', icon: 'ti-book', match: p => p === '/course.html' },
    { href: '/instructors.html', label: '강사', icon: 'ti-users', match: p => p === '/instructors.html' },
    { href: '/notices.html', label: '공지', icon: 'ti-speakerphone', match: p => p.includes('notice') },
    { href: '/mypage.html', label: '마이', icon: 'ti-user', match: p => p === '/mypage.html' || p === '/orders.html' || p === '/player.html', auth: true },
  ]

  const DRAWER_LINKS = [
    { section: '강의', items: [
      { href: '/#all', label: '전체강의' },
      { href: '/?cat=capcut#all', label: '캡컷 PRO' },
    ]},
    { section: '서비스', items: [
      { href: '/instructors.html', label: '강사 소개' },
      { href: '/editors.html', label: '에디터즈' },
      { href: '/projects.html', label: '클라이언츠' },
    ]},
    { section: '고객지원', items: [
      { href: '/notices.html', label: '공지사항' },
      { href: '/faq.html', label: 'FAQ' },
      { href: '/inquiry.html', label: '1:1 문의' },
      { href: '/support.html', label: '고객지원' },
    ]},
  ]

  function ensureStyles() {
    if (document.querySelector('link[href="/css/mobile-nav.css"]')) return
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = '/css/mobile-nav.css?v=6'
    document.head.appendChild(link)
  }

  function isActiveTab(tab) {
    const p = location.pathname
    if (tab.match(p)) return true
    if (tab.href === '/#all' && (p === '/' || p === '/index.html') && location.hash === '#all') return true
    return false
  }

  function mountBottomNav() {
    if (document.getElementById('mobile-bottom-nav')) return
    const nav = document.createElement('nav')
    nav.id = 'mobile-bottom-nav'
    nav.className = 'mobile-bottom-nav'
    nav.setAttribute('aria-label', '하단 메뉴')
    nav.innerHTML = BOTTOM_TABS.map(tab => {
      const href = tab.auth && window.API && !API.isLoggedIn() ? '/login.html?next=' + encodeURIComponent(tab.href) : tab.href
      const active = isActiveTab(tab) ? ' is-active' : ''
      return `<a href="${href}" class="${active.trim()}"><i class="ti ${tab.icon}"></i>${tab.label}</a>`
    }).join('')
    document.body.appendChild(nav)
    document.body.classList.add('has-mobile-nav')
  }

  function openDrawer() {
    let overlay = document.getElementById('nav-drawer-overlay')
    if (!overlay) {
      overlay = document.createElement('div')
      overlay.id = 'nav-drawer-overlay'
      overlay.className = 'nav-drawer-overlay hidden'
      overlay.innerHTML = `<div class="nav-drawer" role="dialog" aria-label="메뉴">
        <div class="nav-drawer-head"><span>메뉴</span><button type="button" class="nav-drawer-close" aria-label="닫기">&times;</button></div>
        <div class="nav-drawer-body"></div>
      </div>`
      document.body.appendChild(overlay)
      overlay.querySelector('.nav-drawer-close').onclick = closeDrawer
      overlay.addEventListener('click', e => { if (e.target === overlay) closeDrawer() })
    }
    const body = overlay.querySelector('.nav-drawer-body')
    body.innerHTML = DRAWER_LINKS.map(sec => `
      <div class="nav-drawer-label">${sec.section}</div>
      ${sec.items.map(it => `<a href="${it.href}">${it.label}</a>`).join('')}
      <div class="nav-drawer-divider"></div>`).join('')
    body.querySelectorAll('a').forEach(a => a.addEventListener('click', closeDrawer))
    overlay.classList.remove('hidden')
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onDrawerKeydown)
  }

  function onDrawerKeydown(e) {
    if (e.key === 'Escape') closeDrawer()
  }

  function closeDrawer() {
    const overlay = document.getElementById('nav-drawer-overlay')
    if (overlay) overlay.classList.add('hidden')
    document.body.style.overflow = ''
    document.removeEventListener('keydown', onDrawerKeydown)
  }

  function mountMenuButton() {
    const inner = document.querySelector('.header:not(.header--logo-only) .header-inner')
    if (!inner || document.getElementById('header-menu-btn')) return
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.id = 'header-menu-btn'
    btn.className = 'header-menu-btn'
    btn.setAttribute('aria-label', '메뉴 열기')
    btn.innerHTML = '<i class="ti ti-menu-2"></i>'
    btn.onclick = openDrawer
    const hr = document.getElementById('header-right')
    if (hr) inner.insertBefore(btn, hr)
    else inner.appendChild(btn)
  }

  function boot() {
    ensureStyles()
    mountBottomNav()
    mountMenuButton()
  }

  document.addEventListener('site-header-ready', boot)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 100))
  } else {
    setTimeout(boot, 100)
  }
  window.openMobileNav = openDrawer
})()
