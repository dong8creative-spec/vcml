/** 홈페이지 섹션·상단 메뉴·문구·카테고리 노출 설정 (어드민에서 관리)
 *  기본값은 lib/homepage-layout-defaults.js 와 동기화 */
(function () {
  const DEFAULT = {
    sections: {
      hero: true,
      categories: true,
      instructors: false,
      all_courses: true,
      free_courses: true,
      new_courses: false,
      reviews: false,
      purchase_ticker: true,
    },
    nav: {
      all: true,
      instructors: true,
      capcut: true,
      premiere: false,
      ai: false,
      editors: false,
      projects: false,
    },
    copy: {
      all_courses: { title: '전체 강의' },
      free_courses: { title: '무료강의', subtitle: '무료지만 기본기를 탄탄하게!', more_label: '전부보기' },
      new_courses: { title: '최신 강의', subtitle: '새롭게 업데이트된 강의', more_label: '전부보기' },
      reviews: { title: '실시간 후기', subtitle: '실제 회원 후기를 실시간으로 확인하세요' },
      purchase_ticker: { label: '⚡ 구매현황', live_text: 'LIVE' },
    },
    categories: [
      { key: 'capcut', label: '캡컷 PRO', style: 'capcut', image: null },
      { key: 'premiere', label: '프리미어 프로', style: 'premiere', image: null },
      { key: 'ai', label: 'AI 콘텐츠 제작', style: 'ai', image: null },
    ],
    site: { brand_name: '타닥클래스' },
  }

  let layout = null
  const CACHE_KEY = 'tc_homepage_layout_cache'
  const CACHE_TTL = 5 * 60 * 1000

  function readCachedLayout() {
    try {
      const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null')
      if (!cached || Date.now() - cached.saved_at > CACHE_TTL) return null
      return cached.layout || null
    } catch {
      return null
    }
  }

  function writeCachedLayout(value) {
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ saved_at: Date.now(), layout: value }))
    } catch {}
  }

  async function fetchLayout() {
    try {
      // 통합 엔드포인트에서 미리 받은 데이터가 있으면 재사용
      if (window._homepageData?.layout) {
        layout = window._homepageData.layout
      } else {
        layout = readCachedLayout()
        if (!layout) {
          layout = await API.get('/homepage-layout')
          writeCachedLayout(layout)
        }
      }
    } catch {
      layout = { ...DEFAULT, updated_at: null }
    }
    window.__homepageLayout = layout
    return layout
  }

  function applyNav() {
    const nav = layout?.nav || DEFAULT.nav
    document.querySelectorAll('[data-nav-key]').forEach(el => {
      const visible = nav[el.dataset.navKey] !== false
      el.style.display = visible ? '' : 'none'
    })
  }

  function applySections() {
    const sections = layout?.sections || DEFAULT.sections
    document.querySelectorAll('[data-home-section]').forEach(el => {
      const visible = sections[el.dataset.homeSection] !== false
      el.style.display = visible ? '' : 'none'
    })
  }

  function applyCopy() {
    const copy = layout?.copy || DEFAULT.copy
    const setText = (id, value) => {
      const el = document.getElementById(id)
      if (el && value != null && value !== '') el.textContent = value
    }
    setText('home-all-title', copy.all_courses?.title)
    setText('home-free-title', copy.free_courses?.title)
    setText('home-free-sub', copy.free_courses?.subtitle)
    setText('home-free-more', copy.free_courses?.more_label)
    setText('home-new-title', copy.new_courses?.title)
    setText('home-new-sub', copy.new_courses?.subtitle)
    setText('home-new-more', copy.new_courses?.more_label)
    setText('home-reviews-title', copy.reviews?.title)
    setText('review-sub', copy.reviews?.subtitle)
    const tickerLabel = document.getElementById('ticker-label-text')
    const tickerLive = document.getElementById('ticker-live-text')
    if (tickerLabel && copy.purchase_ticker?.label != null) tickerLabel.textContent = copy.purchase_ticker.label
    if (tickerLive && copy.purchase_ticker?.live_text != null) tickerLive.textContent = copy.purchase_ticker.live_text
  }

  function applyCategories() {
    const categories = layout?.categories || DEFAULT.categories
    if (typeof window.setHomepageCategoryLabels === 'function') {
      window.setHomepageCategoryLabels(categories)
    }
    categories.forEach(cat => {
      const btn = document.querySelector(`.cat-tile[data-cat="${cat.key}"]`)
      if (!btn) return
      const labelEl = btn.querySelector('.cat-tile-label')
      if (labelEl && cat.label) labelEl.textContent = cat.label
      btn.className = `cat-tile cat-tile--${cat.style || cat.key}`
      if (cat.image) {
        btn.style.backgroundImage = `url("${String(cat.image).replace(/"/g, '%22')}")`
      } else {
        btn.style.backgroundImage = ''
      }
    })
  }

  function applyNavLabels() {
    const categories = layout?.categories || DEFAULT.categories
    const catLabels = Object.fromEntries(categories.map(c => [c.key, c.label]))
    document.querySelectorAll('[data-gnb-cat]').forEach(el => {
      const label = catLabels[el.dataset.gnbCat]
      if (label) el.textContent = label
    })
  }

  function applySiteBrand() {
    const brand = layout?.site?.brand_name || DEFAULT.site.brand_name
    document.querySelectorAll('.logo').forEach(el => {
      if (brand) el.textContent = brand
    })
    document.querySelectorAll('[data-site-brand]').forEach(el => {
      if (brand) el.textContent = brand
    })
  }

  window.applyHomepageLayout = async function () {
    await fetchLayout()
    applyNav()
    applyNavLabels()
    applySections()
    applyCopy()
    applyCategories()
    applySiteBrand()
    return layout
  }

  window.isHomeSectionEnabled = function (key) {
    const sections = layout?.sections || DEFAULT.sections
    return sections[key] !== false
  }

  window.isNavItemEnabled = function (key) {
    const nav = layout?.nav || DEFAULT.nav
    return nav[key] !== false
  }

  window.getHomepageLayout = function () {
    return layout || DEFAULT
  }
})()
