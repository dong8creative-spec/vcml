/** 타닥클래스 강의 카탈로그 — sync 스크립트·시드·어드민 공통 */
const COURSES = [
  {
    slug: 'capcut-beginner-free',
    title: '캡컷 초보자반',
    category: '캡컷 PRO',
    description: '캡컷을 처음 시작하는 분을 위한 무료 입문 강의입니다.',
    thumbnail_icon: 'ti-device-mobile',
    thumb_style: 'light',
    price: 0,
    sale_price: 0,
    badge: 'FREE',
    sort_order: 1,
    rating: 0,
    review_count: 0,
    student_count: 0,
    is_published: 1,
    course_type: 'recorded',
    delivery_mode: 'live_first',
  },
  {
    slug: 'capcut-pro-basic',
    title: '캡컷 PRO 기초반',
    category: '캡컷 PRO',
    description: '캡컷 PRO의 핵심 기능과 기본 편집 워크플로를 익히는 기초 과정입니다.',
    thumbnail_icon: 'ti-device-mobile',
    thumb_style: 'dark',
    price: 55000,
    sale_price: 55000,
    badge: null,
    sort_order: 2,
    rating: 0,
    review_count: 0,
    student_count: 0,
    is_published: 1,
    course_type: 'recorded',
    delivery_mode: 'live_first',
  },
]

const TARGET_SLUGS = new Set(COURSES.map(c => c.slug))

function sortCourses(list) {
  return [...list].sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999))
}

function gridRowLabel(count) {
  const rows = []
  for (let i = 0; i < count; i += 3) rows.push(Math.min(3, count - i))
  return rows.join(' / ')
}

module.exports = { COURSES, TARGET_SLUGS, sortCourses, gridRowLabel }
