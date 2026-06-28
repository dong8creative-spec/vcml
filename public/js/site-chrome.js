(function () {
  const SHOW_LOGIN_LINK = false // 임시: 「로그인」 텍스트 링크 숨김

  function guestChromeAuthHtml(next) {
    const nextQ = next && next !== encodeURIComponent('/') ? `?next=${next}` : ''
    return `<a href="/login.html${nextQ}" class="nav-btn nav-btn-primary">로그인 / 가입</a>`
  }
  const SUBPAGE_NAV = [
    { href: '/notices.html', key: 'notices', label: '공지사항' },
    { href: '/support.html', key: 'support', label: '고객지원' },
    { href: '/faq.html', key: 'faq', label: 'FAQ' },
    { href: '/inquiry.html', key: 'inquiry', label: '1:1 문의' },
    { href: '/privacy.html', key: 'privacy', label: '개인정보' },
    { href: '/terms.html', key: 'terms', label: '이용약관' },
    { href: '/refund.html', key: 'refund', label: '환불정책' },
    { href: '/youth.html', key: 'youth', label: '청소년보호' },
  ]

  const DEFAULT_FOOTER = {
    brand_name: '타닥클래스',
    tagline: '현업 전문가에게 배우는 실무 중심 영상 강의',
    columns: [
      { title: '강의', links: [
        { label: '전체 강의', href: '/#all' },
        { label: '캡컷 PRO', href: '/?cat=capcut#all' },
      ]},
      { title: '고객지원', links: [
        { label: '강의 기대평 남기기', href: '/#all' },
        { label: '1:1 문의하기', href: '/inquiry.html' },
        { label: '자주 묻는 질문', href: '/faq.html' },
        { label: '환불 및 취소 정책', href: '/refund.html' },
      ]},
    ],
    policy_links: [
      { label: '공지사항', href: '/notices.html' },
      { label: '이용약관', href: '/terms.html' },
      { label: '환불정책', href: '/refund.html' },
      { label: '개인정보처리방침', href: '/privacy.html', emphasis: true },
      { label: '청소년보호정책', href: '/youth.html' },
    ],
    biz_info: [
      '상호명 블루필드매뉴얼픽쳐스 · 대표자 이동헌 · 통신판매업신고 제 2025-부산진-0959 호',
      '사업자등록번호 640-50-00860 · 고객센터 010-4850-6946',
      '주소 부산광역시 부산진구 가야대로 707-2(당감동) · 이메일 dong8creative@gmail.com',
    ],
    copyright: '© 2025 타닥클래스. All rights reserved.',
  }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  function currentPageKey() {
    const fromBody = document.body.dataset.legalPage
    if (fromBody) return fromBody
    const path = location.pathname
    if (path.includes('notice')) return 'notices'
    if (path.includes('privacy')) return 'privacy'
    if (path.includes('terms')) return 'terms'
    if (path.includes('refund')) return 'refund'
    if (path.includes('youth')) return 'youth'
    if (path.includes('support')) return 'support'
    if (path.includes('faq')) return 'faq'
    if (path.includes('inquiry')) return 'inquiry'
    return ''
  }

  function getApi() {
    return window.API || (typeof API !== 'undefined' ? API : null)
  }

  function renderChromeAuth() {
    const hr = document.getElementById('chrome-header-right')
    const api = getApi()
    if (!hr || !api) return
    const next = encodeURIComponent(location.pathname + location.search)
    if (api.isLoggedIn()) {
      const user = api.user()
      const name = user?.name ? esc(user.name) : '마이페이지'
      hr.innerHTML = `<a href="/mypage.html" class="nav-btn">${name}</a><a href="/" class="nav-btn nav-btn-outline"><i class="ti ti-home"></i> 홈</a>`
    } else {
      const auth = guestChromeAuthHtml(next)
      const homeBtn = hr.id === 'chrome-header-right'
        ? `<a href="/" class="nav-btn nav-btn-outline"><i class="ti ti-home"></i> 홈</a>`
        : ''
      hr.innerHTML = auth + homeBtn
    }
  }

  function renderHeader(activeKey) {
    const nav = SUBPAGE_NAV.map(item => {
      const active = item.key === activeKey ? ' is-active' : ''
      return `<a href="${item.href}" data-legal-nav="${item.key}"${active}>${item.label}</a>`
    }).join('')

    return `<header class="header header--subpage">
  <div class="header-inner">
    <a href="/" class="logo">타닥클래스</a>
    <nav class="gnb gnb--legal" aria-label="정책 및 지원">${nav}</nav>
    <div class="header-right" id="chrome-header-right">
      ${guestChromeAuthHtml(encodeURIComponent('/'))}
      <a href="/" class="nav-btn nav-btn-outline"><i class="ti ti-home"></i> 홈</a>
    </div>
  </div>
</header>`
  }

  function renderFooter(cfg) {
    const c = cfg || DEFAULT_FOOTER
    const columns = (c.columns || []).map(col => `
      <div>
        <div class="footer-col-title">${esc(col.title)}</div>
        <ul>${(col.links || []).map(link => {
          const style = link.emphasis ? ' style="font-weight:700"' : ''
          return `<li><a href="${esc(link.href)}"${style}>${esc(link.label)}</a></li>`
        }).join('')}</ul>
      </div>`).join('')

    const policies = (c.policy_links || []).map(p =>
      `<a href="${esc(p.href)}">${esc(p.label)}</a>`
    ).join('')

    return `<footer class="footer">
  <div class="container">
    <div class="footer-grid">
      <div class="footer-brand">
        <a href="/" class="logo footer-logo">${esc(c.brand_name)}</a>
        <div class="footer-tagline footer-tagline--lead">${esc(c.tagline)}</div>
      </div>
      ${columns}
    </div>
    <div class="biz-info">
      <button type="button" class="biz-toggle" onclick="this.closest('.biz-info').classList.toggle('open')">
        사업자 정보 <i class="ti ti-chevron-down"></i>
      </button>
      <div class="biz-detail">${Array.isArray(c.biz_info) ? c.biz_info.map(line => `<p>${esc(line)}</p>`).join('') : `<p>${esc(c.biz_info)}</p>`}</div>
    </div>
    <div class="footer-bottom">
      <span>${esc(c.copyright)}</span>
      <div class="footer-policy">${policies}</div>
    </div>
  </div>
</footer>`
  }

  async function fetchFooterConfig() {
    try {
      const res = await fetch('/api/footer')
      if (res.ok) return await res.json()
    } catch (_) { /* fallback */ }
    return DEFAULT_FOOTER
  }

  async function mount() {
    const key = currentPageKey()
    const headerEl = document.querySelector('[data-chrome="header"]')
    if (headerEl) headerEl.outerHTML = renderHeader(key)
    const footerEl = document.querySelector('[data-chrome="footer"]')
    if (footerEl) {
      const cfg = await fetchFooterConfig()
      footerEl.outerHTML = renderFooter(cfg)
    }
    renderChromeAuth()
    document.dispatchEvent(new Event('site-header-ready'))
  }

  window.renderSiteFooter = renderFooter
  window.fetchSiteFooterConfig = fetchFooterConfig
  window.renderChromeAuth = renderChromeAuth

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount)
  } else {
    mount()
  }
  window.addEventListener('load', renderChromeAuth)
})()
