/** Admin 섹션 라우터/레지스트리 */
;(function (global) {
  const titles = {
    dashboard: '대시보드 개요',
    courses: '강의 목록',
    programs: '수강생 프로그램',
    curriculum: '커리큘럼 편집',
    students: '수강생 목록',
    orders: '결제 내역',
    coupons: '쿠폰 관리',
    refunds: '환불 요청',
    instructors: '강사 소개',
    reviews: '수강 후기',
    notices: '공지사항',
    'editor-apps': '에디터즈 신청',
    'editor-program': '선발 프로그램 설계',
    projects: '클라이언츠 현황',
    submissions: '미션 제출 검수',
    tickets: '고객 문의',
    faqs: 'FAQ 관리',
    homepage: '홈페이지 관리',
    settings: '사이트 설정',
    institution: '열람실 관리',
  }

  const loaders = {}

  function registerSection(name, opts = {}) {
    if (opts.title) titles[name] = opts.title
    if (typeof opts.load === 'function') loaders[name] = opts.load
  }

  function registerLoaders(map = {}) {
    Object.keys(map).forEach((name) => {
      if (typeof map[name] === 'function') loaders[name] = map[name]
    })
  }

  function showSection(name) {
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'))
    document.querySelectorAll('.section').forEach(el => el.classList.remove('active'))

    const navEl = document.querySelector(`[data-section="${name}"]`)
    const secEl = document.getElementById(`sec-${name}`)
    if (navEl) navEl.classList.add('active')
    if (secEl) secEl.classList.add('active')
    const titleEl = document.getElementById('page-title')
    if (titleEl) titleEl.textContent = titles[name] || name

    if (name === 'homepage' && typeof global.ensureHomePreviewFrame === 'function') {
      global.ensureHomePreviewFrame()
    }
    if (loaders[name]) loaders[name]()
  }

  function bindNav() {
    document.querySelectorAll('.nav-item').forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault()
        showSection(el.dataset.section)
      })
    })
  }

  global.AdminRouter = {
    titles,
    loaders,
    registerSection,
    registerLoaders,
    showSection,
    bindNav,
  }
  global.showSection = showSection
})(window)
