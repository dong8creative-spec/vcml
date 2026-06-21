/** 앱 공통 상단 메뉴 — 1단 (로고 · GNB · 로그인) */
;(function () {
  const SHOW_LOGIN_LINK = false // 임시: 「로그인」 텍스트 링크 숨김

  const guestAuthHtml = (next) => {
    const icon = typeof GOOGLE_ICON_SVG !== 'undefined' ? GOOGLE_ICON_SVG : (window.GOOGLE_ICON_SVG || '')
    const loginLink = SHOW_LOGIN_LINK
      ? `<a href="/login.html?next=${next}" class="nav-btn">로그인</a>`
      : ''
    return `${loginLink}<a href="#" class="nav-btn nav-btn-google" onclick="startGoogleLogin('${next}');return false">${icon} Google로 시작</a>`
  }

  const DEFAULT_AUTH_HTML = guestAuthHtml(encodeURIComponent('/'))

  const APP_HEADER_HTML = `<header class="header">
  <div class="header-inner">
    <a href="/" class="logo">타닥클래스</a>
    <nav class="gnb" aria-label="주요 메뉴">
      <a href="/#all" data-gnb-all data-nav-key="all">전체강의</a>
      <a href="/instructors.html" data-nav-key="instructors">강사 소개</a>
      <a href="/?cat=capcut#all" data-gnb-cat="capcut" data-nav-key="capcut">캡컷 PRO</a>
      <a href="/?cat=premiere#all" data-gnb-cat="premiere" data-nav-key="premiere">프리미어 PRO</a>
      <a href="/?cat=ai#all" data-gnb-cat="ai" data-nav-key="ai">AI 콘텐츠 제작</a>
      <a href="/editors.html" data-nav-key="editors">에디터즈</a>
      <a href="/projects.html" data-nav-key="projects">클라이언츠</a>
    </nav>
    <div class="header-right" id="header-right">${DEFAULT_AUTH_HTML}</div>
  </div>
</header>`

  const LOGO_ONLY_HEADER_HTML = `<header class="header header--logo-only">
  <div class="header-inner">
    <a href="/" class="logo">타닥클래스</a>
  </div>
</header>`

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  function getApi() {
    return window.API || (typeof API !== 'undefined' ? API : null)
  }

  function renderHeaderAuth() {
    const hr = document.getElementById('header-right')
    if (!hr) return
    const api = getApi()
    if (!api) {
      hr.innerHTML = DEFAULT_AUTH_HTML
      return
    }
    const next = encodeURIComponent(location.pathname + location.search)
    if (api.isLoggedIn()) {
      const user = api.user()
      const name = user?.name ? esc(user.name) : '마이페이지'
      hr.innerHTML = `<a href="/mypage.html" class="nav-btn">${name}</a><a href="#" class="nav-btn nav-btn-outline" onclick="API.logout();return false">로그아웃</a>`
    } else {
      hr.innerHTML = guestAuthHtml(next)
    }
  }

  function mountHeaderMarkup() {
    document.querySelectorAll('[data-site-header]').forEach(el => {
      el.outerHTML = el.dataset.siteHeader === 'logo-only' ? LOGO_ONLY_HEADER_HTML : APP_HEADER_HTML
    })
  }

  async function boot() {
    mountHeaderMarkup()
    const hr = document.getElementById('header-right')
    if (!hr) return

    renderHeaderAuth()

    if (typeof applyHomepageLayout === 'function') {
      try { await applyHomepageLayout() } catch (_) {}
    }
    renderHeaderAuth()
    if (typeof initGnbCatLinks === 'function') initGnbCatLinks()
    document.dispatchEvent(new Event('site-header-ready'))
  }

  window.renderHeaderAuth = renderHeaderAuth
  window.updateNav = renderHeaderAuth

  function scheduleBoot() {
    boot().catch(() => renderHeaderAuth())
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleBoot)
  } else {
    scheduleBoot()
  }
  window.addEventListener('load', renderHeaderAuth)
})()
