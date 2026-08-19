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
    notices: true,
    institution: true,
    capcut: false,
    tadaksync: false,
    reviews: false,
    editors: false,
    projects: false,
  },
  copy: {
    all_courses: { title: '전체 강의' },
      free_courses: { title: '무료강의', subtitle: '공짜지만 기본은 확실히 챙겨드려요', more_label: '전부보기' },
      new_courses: { title: '새로 올라온 강의', subtitle: '최근에 새로 준비한 수업이에요', more_label: '전부보기' },
      reviews: { title: '먼저 배운 분들 이야기', subtitle: '저처럼 처음이었던 분들이 남겨주신 말들이에요' },
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
