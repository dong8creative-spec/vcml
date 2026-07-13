(function () {
  const PAGE_LABELS = {
    privacy: '개인정보처리방침',
    terms: '이용약관',
    refund: '환불정책',
    youth: '청소년보호정책',
    support: '고객지원',
    faq: '자주 묻는 질문',
    inquiry: '1:1 문의',
    notices: '공지사항',
  }

  const FOOTER_LINKS = [
    { href: '/policy/privacy', key: 'privacy', label: '개인정보처리방침' },
    { href: '/policy/terms', key: 'terms', label: '이용약관' },
    { href: '/policy/refund', key: 'refund', label: '환불정책' },
    { href: '/youth.html', key: 'youth', label: '청소년보호정책' },
    { href: '/support.html', key: 'support', label: '고객지원' },
  ]

  function currentPageKey() {
    const fromBody = document.body.dataset.legalPage
    if (fromBody) return fromBody
    const path = location.pathname
    if (path.includes('privacy')) return 'privacy'
    if (path.includes('terms')) return 'terms'
    if (path.includes('refund')) return 'refund'
    if (path.includes('youth')) return 'youth'
    if (path.includes('support')) return 'support'
    if (path.includes('faq')) return 'faq'
    if (path.includes('inquiry')) return 'inquiry'
    if (path.includes('notice')) return 'notices'
    return ''
  }

  function slugify(text, index) {
    return 'section-' + (index + 1)
  }

  function buildToc(article, tocContainer) {
    if (!article || !tocContainer) return []
    const headings = [...article.querySelectorAll('h2')]
    tocContainer.innerHTML = ''

    if (!headings.length) {
      tocContainer.closest('.legal-aside')?.classList.add('is-empty')
      return []
    }

    const frag = document.createDocumentFragment()
    headings.forEach((h2, i) => {
      if (!h2.id) h2.id = slugify(h2.textContent, i)
      const a = document.createElement('a')
      a.href = '#' + h2.id
      a.textContent = h2.textContent.replace(/^제\d+조\s*(\([^)]*\))?\s*/u, '').replace(/^\d+\.\s*/, '').trim() || h2.textContent
      a.dataset.target = h2.id
      a.addEventListener('click', e => {
        e.preventDefault()
        document.getElementById(h2.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        history.replaceState(null, '', '#' + h2.id)
        setActiveToc(h2.id)
        closeMobileToc()
      })
      frag.appendChild(a)
    })
    tocContainer.appendChild(frag)
    return headings.map(h => h.id)
  }

  function setActiveToc(id) {
    document.querySelectorAll('.legal-toc a, .legal-toc-mobile-panel a').forEach(a => {
      a.classList.toggle('is-active', a.dataset.target === id)
    })
  }

  function initScrollSpy(ids) {
    if (!ids.length) return
    const observer = new IntersectionObserver(entries => {
      const visible = entries.filter(e => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)
      if (visible[0]) setActiveToc(visible[0].target.id)
    }, { rootMargin: '-20% 0px -60% 0px', threshold: [0, .25, .5] })

    ids.forEach(id => {
      const el = document.getElementById(id)
      if (el) observer.observe(el)
    })

    if (location.hash && ids.includes(location.hash.slice(1))) {
      setActiveToc(location.hash.slice(1))
    } else if (ids[0]) {
      setActiveToc(ids[0])
    }
  }

  function initMobileToc(ids) {
    const btn = document.getElementById('legal-toc-mobile-btn')
    const panel = document.getElementById('legal-toc-mobile-panel')
    if (!btn || !panel || !ids.length) return

    ids.forEach(id => {
      const h2 = document.getElementById(id)
      if (!h2) return
      const a = document.createElement('a')
      a.href = '#' + id
      a.dataset.target = id
      a.textContent = h2.textContent
      a.addEventListener('click', e => {
        e.preventDefault()
        h2.scrollIntoView({ behavior: 'smooth', block: 'start' })
        history.replaceState(null, '', '#' + id)
        setActiveToc(id)
        closeMobileToc()
      })
      panel.appendChild(a)
    })

    btn.addEventListener('click', () => {
      const open = panel.classList.toggle('is-open')
      btn.setAttribute('aria-expanded', open ? 'true' : 'false')
    })
  }

  function closeMobileToc() {
    document.getElementById('legal-toc-mobile-panel')?.classList.remove('is-open')
    document.getElementById('legal-toc-mobile-btn')?.setAttribute('aria-expanded', 'false')
  }

  function markNavActive(key) {
    document.querySelectorAll('[data-legal-nav]').forEach(el => {
      el.classList.toggle('is-active', el.dataset.legalNav === key)
      el.classList.toggle('is-current', el.dataset.legalNav === key)
    })
  }

  function openFaqFromHash() {
    if (!location.hash.startsWith('#faq')) return
    const el = document.querySelector(location.hash)
    if (el && el.tagName === 'DETAILS') el.open = true
  }

  document.addEventListener('DOMContentLoaded', () => {
    const key = currentPageKey()
    markNavActive(key)

    const article = document.getElementById('legal-article')
    const toc = document.getElementById('legal-toc')
    const ids = buildToc(article, toc)
    initScrollSpy(ids)
    initMobileToc(ids)
    openFaqFromHash()

    document.querySelectorAll('.faq-item').forEach((item, i) => {
      if (!item.id) item.id = 'faq-' + (i + 1)
    })
  })
})()
