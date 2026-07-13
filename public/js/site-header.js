/** 앱 공통 상단 메뉴 — 1단 (로고 · GNB · 로그인) */
;(function () {


  const guestAuthHtml = (next) => {
    const nextQ = next && next !== encodeURIComponent('/') ? `?next=${next}` : ''
    return `<a href="/login.html${nextQ}" class="nav-btn nav-btn-primary">로그인 / 가입</a>`
  }

  const DEFAULT_AUTH_HTML = guestAuthHtml(encodeURIComponent('/'))

  const APP_HEADER_HTML = `<header class="header">
  <div class="header-inner">
    <a href="/" class="logo">타닥클래스</a>
    <nav class="gnb" aria-label="주요 메뉴">
      <a href="/instructors.html" data-nav-key="instructors">강사 소개</a>
      <a href="/notices.html" data-nav-key="notices">공지사항</a>
      <a href="/#all" data-gnb-all data-nav-key="all">전체강의</a>
      <a href="/?cat=capcut#all" data-gnb-cat="capcut" data-nav-key="capcut">캡컷 PRO</a>
      <a href="/institution.html" data-nav-key="institution">열람실</a>
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

  function userIdLabel(user) {
    const email = String(user?.email || '').trim()
    if (email) return email.split('@')[0]
    return user?.name || '마이페이지'
  }

  function getApi() {
    return window.API || (typeof API !== 'undefined' ? API : null)
  }

  function renderHeaderAuth(wallet) {
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
      const id = esc(userIdLabel(user))
      const coinText = wallet && Number.isFinite(Number(wallet.balance))
        ? Number(wallet.balance).toLocaleString()
        : '-'
      hr.innerHTML = `
        <a href="/mypage.html" class="nav-btn nav-user-id">${id}</a>
        <a href="/coins.html" class="nav-btn nav-coin" title="코인 관리">🪙 ${coinText}</a>
        <a href="#" class="nav-btn nav-btn-outline" onclick="API.logout();return false">로그아웃</a>`
    } else {
      hr.innerHTML = guestAuthHtml(next)
    }
  }

  async function renderHeaderAuthWithWallet() {
    const api = getApi()
    if (!api || !api.isLoggedIn()) {
      renderHeaderAuth()
      return
    }
    renderHeaderAuth()
    try {
      const wallet = await api.get('/subtitle/wallet?limit=1')
      renderHeaderAuth(wallet)
    } catch (_) {
      renderHeaderAuth({ balance: 0 })
    }
  }

  const TEXT_EXCLUDE_SELECTOR = [
    'script', 'style', 'noscript', 'template',
    'code', 'pre', 'kbd', 'samp',
    'textarea', 'input', 'select', 'button',
    'svg', 'canvas', 'table',
    'header', 'nav',
    'a',
    '.no-readable-break',
    '[data-no-readable-break]',
  ].join(',')

  function shouldSplitAt(text, idx) {
    const ch = text[idx]
    const prev = text[idx - 1] || ''
    const next = text[idx + 1] || ''
    if ((ch === '.' || ch === ',') && /\d/.test(prev) && /\d/.test(next)) return false
    return ch === ',' || ch === '，' || ch === '、' || ch === '.' || ch === '。'
  }

  function splitReadableText(text) {
    const chunks = []
    let buf = ''
    for (let i = 0; i < text.length; i++) {
      if (shouldSplitAt(text, i)) {
        const part = buf.trim()
        if (part) chunks.push(part)
        buf = ''
      } else {
        buf += text[i]
      }
    }
    const tail = buf.trim()
    if (tail) chunks.push(tail)
    return chunks
  }

  function formatReadableText(root = document.body) {
    if (!root || root.nodeType !== 1) return
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement
        if (!parent || parent.closest(TEXT_EXCLUDE_SELECTOR)) return NodeFilter.FILTER_REJECT
        if (parent.classList?.contains('readable-chunk')) return NodeFilter.FILTER_REJECT
        const text = node.nodeValue || ''
        if (!/[,.，、。]/.test(text)) return NodeFilter.FILTER_REJECT
        if (!text.trim()) return NodeFilter.FILTER_REJECT
        return NodeFilter.FILTER_ACCEPT
      }
    })
    const nodes = []
    while (walker.nextNode()) nodes.push(walker.currentNode)
    nodes.forEach(node => {
      const chunks = splitReadableText(node.nodeValue || '')
      if (chunks.length <= 1) return
      const frag = document.createDocumentFragment()
      chunks.forEach((chunk, idx) => {
        if (idx > 0) frag.appendChild(document.createElement('br'))
        const span = document.createElement('span')
        span.className = 'readable-chunk'
        span.textContent = chunk
        frag.appendChild(span)
      })
      node.parentNode?.replaceChild(frag, node)
    })
  }

  function initReadableTextFormatter() {
    formatReadableText(document.body)
    let timer = null
    const observer = new MutationObserver(() => {
      clearTimeout(timer)
      timer = setTimeout(() => formatReadableText(document.body), 80)
    })
    observer.observe(document.body, { childList: true, subtree: true })
  }

  function mountHeaderMarkup() {
    document.querySelectorAll('[data-site-header]').forEach(el => {
      el.outerHTML = el.dataset.siteHeader === 'logo-only' ? LOGO_ONLY_HEADER_HTML : APP_HEADER_HTML
    })
  }

  function initGnbCatLinks() {
    document.querySelectorAll('[data-gnb-cat]').forEach(a => {
      a.addEventListener('click', e => {
        if (location.pathname === '/' || location.pathname === '/index.html') {
          e.preventDefault()
          if (typeof toggleCategory === 'function') toggleCategory(a.dataset.gnbCat)
        }
      })
    })
    document.querySelectorAll('[data-gnb-all]').forEach(a => {
      a.addEventListener('click', e => {
        if (location.pathname === '/' || location.pathname === '/index.html') {
          e.preventDefault()
          if (typeof applyFilter === 'function') applyFilter({ cat: null, q: '', filter: null }, true)
          document.getElementById('all')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      })
    })
  }

  async function boot() {
    mountHeaderMarkup()
    const hr = document.getElementById('header-right')
    if (!hr) return

    renderHeaderAuth()

    const isHome = location.pathname === '/' || location.pathname.endsWith('/index.html')
    if (!isHome && typeof applyHomepageLayout === 'function') {
      try { await applyHomepageLayout() } catch (_) {}
    }
    await renderHeaderAuthWithWallet()
    initGnbCatLinks()
    initReadableTextFormatter()
    document.dispatchEvent(new Event('site-header-ready'))
  }

  window.renderHeaderAuth = () => renderHeaderAuthWithWallet()

  function scheduleBoot() {
    boot().catch(() => renderHeaderAuthWithWallet())
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleBoot)
  } else {
    scheduleBoot()
  }
  window.addEventListener('load', () => renderHeaderAuthWithWallet())
})()
