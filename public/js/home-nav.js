// 홈 강의 탐색 — 카테고리 필터 · 검색 · URL 동기화
// index.html 인라인 스크립트와 함께 동작

const CAT_MATCH = {
  capcut:   c => (c.category || '').includes('캡컷') || String(c.slug || '').startsWith('capcut'),
  premiere: c => (c.category || '').includes('프리미어') || String(c.slug || '').startsWith('premiere'),
  ai:       c => /ai/i.test(c.category || '') || String(c.slug || '').startsWith('ai'),
}

const CAT_LABELS = { capcut: '캡컷 PRO', premiere: '프리미어 PRO', ai: 'AI 콘텐츠 제작' }

let allPublishedCourses = []
let activeCategory = null
let activeSearch = ''
let activeFilter = null // 'free' | null

function orderCourses(courses) {
  return [...courses].sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999))
}

function gridRowLabel(count) {
  const rows = []
  for (let i = 0; i < count; i += 3) rows.push(Math.min(3, count - i))
  return rows.join(' / ')
}

// URL에 필터 상태를 반영 (pushState)
function syncUrl(cat, q, filter, push) {
  const p = new URLSearchParams()
  if (cat) p.set('cat', cat)
  if (q) p.set('q', q)
  if (filter) p.set('filter', filter)
  const qs = p.toString()
  const url = location.pathname + (qs ? '?' + qs : '') + '#all'
  if (push) history.pushState({ cat, q, filter }, '', url)
  else history.replaceState({ cat, q, filter }, '', url)
}

function filterCourses() {
  let list = allPublishedCourses
  if (activeFilter === 'free') {
    list = list.filter(c => Number(c.sale_price) === 0 && c.course_type !== 'live')
  }
  if (activeCategory) {
    list = list.filter(CAT_MATCH[activeCategory])
  }
  if (activeSearch) {
    const q = activeSearch.toLowerCase()
    list = list.filter(c => (c.title || '').toLowerCase().includes(q) || (c.category || '').toLowerCase().includes(q) || (c.description || '').toLowerCase().includes(q))
  }
  return list
}

function updateCourseGrid(courses) {
  const grid = document.getElementById('course-grid-332')
  if (!grid) return
  grid.innerHTML = renderCourseGrid332(courses)
  const sub = document.getElementById('course-grid-sub')
  if (sub) {
    let label = `총 ${courses.length}개`
    if (activeCategory) label += ' · ' + (CAT_LABELS[activeCategory] || activeCategory)
    if (activeFilter === 'free') label += ' · 무료'
    if (activeSearch) label += ` · "${activeSearch}" 검색`
    if (courses.length) label += ' · ' + gridRowLabel(courses.length)
    sub.textContent = label
  }
}

function updateTileHighlight() {
  document.querySelectorAll('.cat-tile').forEach(btn => {
    btn.classList.toggle('active', !!activeCategory && btn.dataset.cat === activeCategory)
  })
  document.querySelectorAll('[data-gnb-cat]').forEach(a => {
    a.classList.toggle('active', !!activeCategory && a.dataset.gnbCat === activeCategory)
  })
}

function applyFilter({ cat, q, filter } = {}, push = true) {
  if (cat !== undefined) activeCategory = cat || null
  if (q !== undefined) activeSearch = q || ''
  if (filter !== undefined) activeFilter = filter || null

  updateCourseGrid(filterCourses())
  updateTileHighlight()
  syncUrl(activeCategory, activeSearch, activeFilter, push)
}

// 카테고리 토글 (같은 카테고리 클릭 시 해제)
function toggleCategory(cat) {
  const next = activeCategory === cat ? null : cat
  applyFilter({ cat: next, filter: null })
  document.getElementById('all')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// 선반 "전부보기" 클릭 핸들러
function shelfShowAll(filter) {
  applyFilter({ cat: null, q: '', filter: filter || null }, true)
  document.getElementById('all')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// 검색
function handleSearch() {
  const input = document.getElementById('search-input')
  if (!input) return
  const q = input.value.trim()
  applyFilter({ q, cat: null, filter: null }, true)
  if (q) {
    document.getElementById('all')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

// URL 파라미터로 초기 상태 복원
function initFromUrl() {
  const p = new URLSearchParams(location.search)
  const cat = p.get('cat') || null
  const q = p.get('q') || ''
  const filter = p.get('filter') || null

  activeCategory = cat
  activeSearch = q
  activeFilter = filter

  const input = document.getElementById('search-input')
  if (input && q) input.value = q
}

// 브라우저 뒤로가기 지원
window.addEventListener('popstate', e => {
  const s = e.state || {}
  activeCategory = s.cat || null
  activeSearch = s.q || ''
  activeFilter = s.filter || null
  updateCourseGrid(filterCourses())
  updateTileHighlight()
  const input = document.getElementById('search-input')
  if (input) input.value = activeSearch
})

// 카테고리 타일 이벤트 바인딩
function initCategoryTiles() {
  document.querySelectorAll('.cat-tile').forEach(btn => {
    btn.addEventListener('click', () => toggleCategory(btn.dataset.cat))
  })
}

// 인라인 GNB 카테고리 링크 핸들링 (홈에서는 SPA 필터, 다른 페이지에서는 이동)
function initGnbCatLinks() {
  document.querySelectorAll('[data-gnb-cat]').forEach(a => {
    a.addEventListener('click', e => {
      if (location.pathname === '/' || location.pathname === '/index.html') {
        e.preventDefault()
        toggleCategory(a.dataset.gnbCat)
      }
      // 다른 페이지에서는 기본 href(/?cat=...) 그대로 이동
    })
  })
  // "전체강의" 링크
  document.querySelectorAll('[data-gnb-all]').forEach(a => {
    a.addEventListener('click', e => {
      if (location.pathname === '/' || location.pathname === '/index.html') {
        e.preventDefault()
        applyFilter({ cat: null, q: '', filter: null }, true)
        document.getElementById('all')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    })
  })
}

// 검색창 이벤트 바인딩
function initSearch() {
  const input = document.getElementById('search-input')
  if (!input) return
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSearch()
    }
  })
  // 아이콘 클릭도 검색
  const searchIcon = input.closest('.search-bar')?.querySelector('.ti-search')?.parentElement
  if (searchIcon && searchIcon.tagName === 'I') searchIcon.parentElement.addEventListener('click', handleSearch)
}
