/** 홈페이지 layout 기본값 — server(schema)와 client(site-layout) 공통 소스 */
const HOMEPAGE_LAYOUT_DEFAULTS = {
  sections: {
    hero: true,
    categories: true,
    instructors: false,
    all_courses: true,
    free_courses: true,
    new_courses: false,
    reviews: true,
    purchase_ticker: true,
  },
  nav: {
    all: true,
    instructors: true,
    capcut: true,
    tadaksync: true,
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
  ],
  site: {
    brand_name: '타닥클래스',
  },
}

module.exports = HOMEPAGE_LAYOUT_DEFAULTS
