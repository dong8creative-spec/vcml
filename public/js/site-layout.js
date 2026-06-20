/** 홈페이지 섹션·상단 메뉴 노출 설정 (어드민에서 관리) */
(function () {
  const DEFAULT = {
    sections: {
      categories: true,
      instructors: true,
      all_courses: true,
      free_courses: true,
      new_courses: true,
      reviews: true,
      purchase_ticker: true,
    },
    nav: {
      all: true,
      capcut: true,
      premiere: true,
      ai: true,
      anticipation: true,
      editors: true,
      projects: true,
    },
  }

  let layout = null

  async function fetchLayout() {
    try {
      layout = await API.get('/homepage-layout')
    } catch {
      layout = { ...DEFAULT, updated_at: null }
    }
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

  window.applyHomepageLayout = async function () {
    await fetchLayout()
    applyNav()
    applySections()
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
})()
