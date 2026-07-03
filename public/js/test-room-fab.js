/** 테스트룸 — 우측 고정 커뮤니티 모듈 (심볼 3개) */
;(function () {
  const ROOT_ID = 'test-room-fab'
  const FAB_VERSION = 16
  const ENTER_MS = 540
  const LEAVE_MS = 300
  const REVIEWS_SECTION = '.review-ticker-section, [data-home-section="reviews"]'
  const REVIEWS_TRIGGER = '#home-reviews-title'
  const SHOW_RATIO = 0.44
  const HERO_HIDE_RATIO = 0.48

  const SYMBOLS = {
    room: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5" stroke="currentColor" stroke-width="1.75"/><path d="M3 9h18M8 5V3.5M16 5V3.5M9.5 13.5l2-2.5 2 2.5 2.5-3" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    instagram: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="5" stroke="currentColor" stroke-width="1.75"/><circle cx="12" cy="12" r="4.1" stroke="currentColor" stroke-width="1.75"/><circle cx="17.35" cy="6.65" r="1.15" fill="currentColor"/></svg>`,
    kakao: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 4C7.03 4 3 7.24 3 11.2c0 2.44 1.34 4.6 3.42 5.96L5 20l3.86-2.12c.94.17 1.92.26 3.14.26 4.97 0 9-3.24 9-7.2S16.97 4 12 4z" fill="currentColor"/></svg>`,
  }

  let scrollRevealCleanup = null
  let revealWasVisible = false

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  function skipWidget() {
    if (/\/admin\.html$/i.test(location.pathname)) return true
    if (window.self !== window.top) return true
    if (new URLSearchParams(location.search).get('preview') === '1') return true
    return false
  }

  function isHomePage() {
    const p = location.pathname
    return p === '/' || p.endsWith('/index.html')
  }

  function ensureStyles() {
    document.querySelectorAll('link[href*="test-room-fab.css"]').forEach(el => el.remove())
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = `/css/test-room-fab.css?v=${FAB_VERSION}`
    document.head.appendChild(link)
  }

  function teardownScrollReveal() {
    scrollRevealCleanup?.()
    scrollRevealCleanup = null
    revealWasVisible = false
  }

  function isSectionVisible(el) {
    if (!el) return false
    if (el.hidden) return false
    const st = getComputedStyle(el)
    return st.display !== 'none' && st.visibility !== 'hidden'
  }

  function getRevealTarget() {
    const reviews = document.querySelector(REVIEWS_SECTION)
    if (isSectionVisible(reviews)) return document.querySelector(REVIEWS_TRIGGER) || reviews
    return document.querySelector('.trust-bar')
  }

  function isHeroDominant() {
    const hero = document.querySelector('[data-home-section="hero"], .hero')
    if (!hero || !isSectionVisible(hero)) return false
    return hero.getBoundingClientRect().bottom > window.innerHeight * HERO_HIDE_RATIO
  }

  function shouldRevealOnHome(target) {
    if (!target) return false
    if (isHeroDominant()) return false
    if (revealWasVisible) return true
    return target.getBoundingClientRect().top <= window.innerHeight * SHOW_RATIO
  }

  function clearMotionTimers(root) {
    clearTimeout(root._enterFallback)
    clearTimeout(root._leaveFallback)
  }

  function bindPanelMotion(root) {
    const panel = root.querySelector('.test-room-fab__panel')
    if (!panel || panel.dataset.motionBound) return
    panel.dataset.motionBound = '1'
    panel.addEventListener('animationend', e => {
      if (e.target !== panel) return
      if (e.animationName === 'trf-panel-in' && root.classList.contains('is-entering')) {
        clearTimeout(root._enterFallback)
        root.classList.remove('is-entering')
      }
      if (e.animationName === 'trf-panel-out' && root.classList.contains('is-leaving')) {
        clearTimeout(root._leaveFallback)
        root.classList.remove('is-leaving', 'is-active')
      }
    })
  }

  function setFabRevealState(root, show, animateIn) {
    root.setAttribute('aria-hidden', show ? 'false' : 'true')
    clearMotionTimers(root)
    const panel = root.querySelector('.test-room-fab__panel')

    if (show) {
      if (root.classList.contains('is-entering')) return
      root.classList.remove('is-leaving')
      if (animateIn) {
        root.classList.remove('is-active', 'is-entering')
        if (panel) {
          panel.style.animation = 'none'
          void panel.offsetWidth
          panel.style.animation = ''
        }
        root.classList.add('is-active', 'is-entering')
        root._enterFallback = window.setTimeout(() => root.classList.remove('is-entering'), ENTER_MS)
      } else if (root.classList.contains('is-active')) {
        return
      } else {
        root.classList.remove('is-entering')
        root.classList.add('is-active')
      }
      return
    }

    if (!root.classList.contains('is-active')) return
    root.classList.remove('is-entering')
    root.classList.add('is-leaving')
    root._leaveFallback = window.setTimeout(() => {
      root.classList.remove('is-leaving', 'is-active')
    }, LEAVE_MS)
  }

  function evaluateReveal(root) {
    const show = shouldRevealOnHome(getRevealTarget())
    if (show && root.classList.contains('is-entering')) {
      revealWasVisible = true
      return
    }
    const wasActive = root.classList.contains('is-active') && !root.classList.contains('is-leaving')
    if (show && wasActive) {
      revealWasVisible = true
      return
    }
    const animateIn = show && isHomePage()
    setFabRevealState(root, show, animateIn)
    revealWasVisible = show
  }

  function initScrollReveal(root) {
    teardownScrollReveal()

    if (!isHomePage()) {
      setFabRevealState(root, true, false)
      return
    }

    setFabRevealState(root, false, false)

    let ticking = false
    const scheduleUpdate = () => {
      if (!ticking) {
        ticking = true
        requestAnimationFrame(() => {
          ticking = false
          evaluateReveal(root)
        })
      }
    }

    window.addEventListener('scroll', scheduleUpdate, { passive: true })
    window.addEventListener('resize', scheduleUpdate, { passive: true })
    scrollRevealCleanup = () => {
      window.removeEventListener('scroll', scheduleUpdate)
      window.removeEventListener('resize', scheduleUpdate)
    }

    scheduleUpdate()
    window.addEventListener('load', scheduleUpdate, { once: true })

    const origApply = window.applyHomepageLayout
    if (origApply && !origApply.__trfHooked) {
      window.applyHomepageLayout = async function (...args) {
        const result = await origApply.apply(this, args)
        scheduleUpdate()
        return result
      }
      window.applyHomepageLayout.__trfHooked = true
    }

    window.setTimeout(scheduleUpdate, 300)
    window.setTimeout(scheduleUpdate, 1200)
  }

  function removeWidget() {
    const root = document.getElementById(ROOT_ID)
    if (root) clearMotionTimers(root)
    teardownScrollReveal()
    root?.remove()
  }

  function isValidUrl(url) {
    if (!url) return false
    try {
      const u = new URL(url, location.origin)
      return u.protocol === 'http:' || u.protocol === 'https:'
    } catch {
      return false
    }
  }

  function resolveRoomUrl(cfg) {
    if (isValidUrl(cfg.room_url)) return cfg.room_url
    return '/editor-workbooks.html'
  }

  function buildButton(type, href, ariaLabel, symbol) {
    const external = /^https?:\/\//i.test(href)
    const targetAttr = external ? ' target="_blank" rel="noopener noreferrer"' : ''
    return `<a href="${esc(href)}" class="test-room-fab__btn test-room-fab__btn--${type}"${targetAttr} aria-label="${esc(ariaLabel)}">
      <span class="test-room-fab__symbol">${symbol}</span>
    </a>`
  }

  function mountWidget(cfg) {
    if (!cfg?.enabled) {
      removeWidget()
      return
    }

    const buttons = []
    const roomHref = resolveRoomUrl(cfg)
    const roomLabel = cfg.room_label || cfg.label || '테스트룸'
    buttons.push(buildButton('room', roomHref, roomLabel, SYMBOLS.room))

    if (isValidUrl(cfg.instagram_url)) {
      buttons.push(buildButton('instagram', cfg.instagram_url, cfg.instagram_label || '인스타그램', SYMBOLS.instagram))
    }
    if (isValidUrl(cfg.kakao_url)) {
      buttons.push(buildButton('kakao', cfg.kakao_url, cfg.kakao_label || '카카오 대기방', SYMBOLS.kakao))
    }

    if (buttons.length < 2) {
      removeWidget()
      return
    }

    ensureStyles()
    removeWidget()

    const root = document.createElement('aside')
    root.id = ROOT_ID
    root.className = 'test-room-fab'
    root.setAttribute('aria-label', cfg.label || '테스트룸')
    root.setAttribute('aria-hidden', 'true')
    root.innerHTML = `<div class="test-room-fab__panel"><div class="test-room-fab__list">${buttons.join('')}</div></div>`

    document.body.appendChild(root)
    bindPanelMotion(root)
    initScrollReveal(root)
  }

  async function fetchConfig() {
    const res = await fetch('/api/test-room', { cache: 'no-store' })
    if (!res.ok) throw new Error('config fetch failed')
    return res.json()
  }

  async function syncWidget() {
    if (skipWidget()) {
      removeWidget()
      return
    }
    try {
      mountWidget(await fetchConfig())
    } catch (err) {
      console.warn('[test-room-fab]', err)
      removeWidget()
    }
  }

  window.syncTestRoomFab = syncWidget

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { syncWidget().catch(() => {}) })
  } else {
    syncWidget().catch(() => {})
  }
})()
