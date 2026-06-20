const path = require('path')
const fs = require('fs')
const bcrypt = require('bcryptjs')

const DB_PATH = path.join(__dirname, 'tadak.db.json')

// ── JSON 기반 in-memory DB ──
const tables = {
  users: [],
  courses: [],
  chapters: [],
  orders: [],
  enrollments: [],
  progress: [],
  reviews: [],
  coupons: [],
  consent_logs: [],
}
let _ids = {}

function load() {
  if (fs.existsSync(DB_PATH)) {
    const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'))
    Object.assign(tables, data.tables || {})
    Object.assign(_ids, data._ids || {})
  }
}
function save() {
  fs.writeFileSync(DB_PATH, JSON.stringify({ tables, _ids }, null, 2))
}

function nextId(table) {
  _ids[table] = (_ids[table] || 0) + 1
  return _ids[table]
}

load()

// ── 시드 데이터 ──
function seed() {
  if (tables.courses.length > 0) return

  const pw = bcrypt.hashSync('admin1234', 10)
  tables.users.push({ id: nextId('users'), email: 'admin@tadakclass.com', password: pw, name: '관리자', role: 'admin', created_at: now() })
  const demoPw = bcrypt.hashSync('demo1234', 10)
  tables.users.push({ id: nextId('users'), email: 'demo@tadakclass.com', password: demoPw, name: '데모 수강생', role: 'student', created_at: now() })

  const courses = [
    { slug:'premiere-pro', title:'프리미어 프로 완전 정복 — 편집의 모든 것', category:'영상 편집', description:'타임라인 구성부터 색보정·오디오 믹싱까지, 현업 편집자의 실전 워크플로우를 그대로 배웁니다.', thumbnail_icon:'ti-cut', thumb_style:'dark', price:120000, sale_price:89000, badge:'BEST', rating:4.9, review_count:1240, student_count:1240, is_published:1 },
    { slug:'after-effects', title:'After Effects 모션그래픽 실전 마스터', category:'모션그래픽', description:'키프레임부터 익스프레션, 3D 레이어까지 — 방송·광고 현장에서 쓰는 모션그래픽을 만듭니다.', thumbnail_icon:'ti-sparkles', thumb_style:'light', price:130000, sale_price:99000, badge:'BEST', rating:4.9, review_count:987, student_count:987, is_published:1 },
    { slug:'davinci-color', title:'다빈치 리졸브 색보정 — 시네마틱 룩 완성', category:'색보정', description:'로그 영상 해석부터 커스텀 LUT 제작까지, 영화 같은 색감을 만드는 색보정 전 과정을 다룹니다.', thumbnail_icon:'ti-color-swatch', thumb_style:'dark', price:99000, sale_price:79000, badge:null, rating:4.8, review_count:763, student_count:763, is_published:1 },
    { slug:'youtube-production', title:'유튜브 채널 영상 제작 A to Z', category:'유튜브·콘텐츠', description:'기획·촬영·편집·썸네일까지 구독자를 늘리는 유튜브 영상의 전 제작 과정을 익힙니다.', thumbnail_icon:'ti-brand-youtube', thumb_style:'light', price:89000, sale_price:69000, badge:'NEW', rating:4.8, review_count:521, student_count:521, is_published:1 },
    { slug:'shortform', title:'숏폼 영상 제작 — 릴스·틱톡·쇼츠 완성', category:'유튜브·콘텐츠', description:'15~60초 안에 시선을 붙잡는 숏폼 편집 공식과 바이럴 전략을 배웁니다.', thumbnail_icon:'ti-device-mobile-vibration', thumb_style:'dark', price:79000, sale_price:59000, badge:'NEW', rating:4.7, review_count:412, student_count:412, is_published:1 },
    { slug:'camera-lighting', title:'촬영 & 조명 기초 — 카메라를 제대로 다루는 법', category:'촬영·조명', description:'노출·화이트밸런스·심도부터 원포인트 조명 세팅까지 혼자서도 퀄리티 높은 영상을 찍는 법을 알려줍니다.', thumbnail_icon:'ti-camera', thumb_style:'light', price:99000, sale_price:79000, badge:null, rating:4.8, review_count:634, student_count:634, is_published:1 },
    { slug:'commercial-video', title:'광고·상업 영상 제작 실전 클래스', category:'광고·상업', description:'브랜드 필름부터 제품 광고까지 — 클라이언트 납품 수준의 상업 영상을 처음부터 끝까지 만듭니다.', thumbnail_icon:'ti-movie', thumb_style:'dark', price:149000, sale_price:119000, badge:null, rating:4.9, review_count:389, student_count:389, is_published:1 },
    { slug:'drone-video', title:'드론 영상 촬영·편집 완성', category:'드론·항공', description:'드론 조종 기초부터 항공 푸티지 편집, 시네마틱 드론 샷 연출법까지 한 번에 배웁니다.', thumbnail_icon:'ti-drone', thumb_style:'light', price:119000, sale_price:89000, badge:null, rating:4.7, review_count:298, student_count:298, is_published:1 },
    { slug:'sound-design', title:'영상 사운드 디자인 — 음악·효과음·믹싱', category:'사운드', description:'BGM 선곡·편집부터 폴리 효과음 제작, 오디오 믹싱까지 영상의 완성도를 높이는 사운드 전 과정을 다룹니다.', thumbnail_icon:'ti-music', thumb_style:'dark', price:89000, sale_price:69000, badge:null, rating:4.8, review_count:276, student_count:276, is_published:1 },
  ]
  for (const c of courses) tables.courses.push({ id: nextId('courses'), ...c, created_at: now() })

  const chapterDefs = {
    'premiere-pro': [
      { t:'강의 소개 및 프리미어 프로 환경 설정', d:'14분', free:1 },
      { t:'타임라인 구성과 기본 편집 — 컷·트림·리플', d:'32분', free:1 },
      { t:'트랜지션과 효과 — 영상 흐름 만들기', d:'28분', free:0 },
      { t:'색보정 기초 — Lumetri Color 완전 정복', d:'40분', free:0 },
      { t:'오디오 편집과 믹싱 — 배경음악·나레이션 처리', d:'35분', free:0 },
      { t:'자막과 모션 타이틀 제작', d:'30분', free:0 },
      { t:'최종 출력 설정과 유튜브·SNS 맞춤 렌더링', d:'22분', free:0 },
    ],
    'after-effects': [
      { t:'After Effects 인터페이스와 핵심 개념', d:'18분', free:1 },
      { t:'키프레임 애니메이션 — 위치·크기·불투명도', d:'35분', free:1 },
      { t:'텍스트 애니메이션과 타이포그래피 모션', d:'42분', free:0 },
      { t:'마스크·트랙 매트·블렌딩 모드 활용', d:'38분', free:0 },
      { t:'익스프레션 기초 — wiggle·loopOut 실전 사용', d:'45분', free:0 },
      { t:'3D 레이어와 카메라 연출', d:'50분', free:0 },
      { t:'실전 프로젝트 — 방송용 오프닝 타이틀 제작', d:'60분', free:0 },
    ],
    'youtube-production': [
      { t:'유튜브 채널 기획과 콘셉트 잡기', d:'20분', free:1 },
      { t:'스마트폰·보급형 카메라로 퀄리티 높이기', d:'28분', free:1 },
      { t:'유튜브 영상 편집 루틴 — 빠르고 일관성 있게', d:'38분', free:0 },
      { t:'썸네일 디자인 — 클릭을 부르는 공식', d:'30분', free:0 },
      { t:'자막·자동 캡션 활용과 SEO 최적화', d:'25분', free:0 },
      { t:'채널 성장을 위한 데이터 분석과 전략', d:'32분', free:0 },
    ],
  }

  for (const [slug, chs] of Object.entries(chapterDefs)) {
    const course = tables.courses.find(c => c.slug === slug)
    if (!course) continue
    chs.forEach((ch, i) => {
      tables.chapters.push({ id: nextId('chapters'), course_id: course.id, order_num: i+1, title: ch.t, duration: ch.d, is_free: ch.free, video_url: null })
    })
  }

  // 기본 챕터 없는 강의에 샘플 챕터 추가
  for (const course of tables.courses) {
    const existing = tables.chapters.filter(ch => ch.course_id === course.id)
    if (existing.length === 0) {
      tables.chapters.push({ id: nextId('chapters'), course_id: course.id, order_num: 1, title: '강의 소개', duration: '10분', is_free: 1, video_url: null })
      tables.chapters.push({ id: nextId('chapters'), course_id: course.id, order_num: 2, title: '핵심 내용 1강', duration: '30분', is_free: 0, video_url: null })
      tables.chapters.push({ id: nextId('chapters'), course_id: course.id, order_num: 3, title: '핵심 내용 2강', duration: '35분', is_free: 0, video_url: null })
    }
  }

  // 데모 수강생 등록
  const demo = tables.users.find(u => u.email === 'demo@tadakclass.com')
  const firstCourse = tables.courses.find(c => c.slug === 'premiere-pro')
  if (demo && firstCourse) {
    tables.enrollments.push({ id: nextId('enrollments'), user_id: demo.id, course_id: firstCourse.id, enrolled_at: now() })
    tables.orders.push({ id: nextId('orders'), user_id: demo.id, course_id: firstCourse.id, amount: firstCourse.sale_price, method: '카카오페이', status: 'paid', paid_at: now() })
  }

  save()
}

seed()

function now() { return new Date().toLocaleString('ko-KR') }

// ── DB API (better-sqlite3 호환 인터페이스) ──
const db = {
  tables, save,

  // users
  findUserByEmail(email) { return tables.users.find(u => u.email === email) },
  findUserById(id) { return tables.users.find(u => u.id === id) },
  findUserByKakaoId(kakaoId) { return tables.users.find(u => u.kakao_id === String(kakaoId)) },
  createUser(email, password, name) {
    const user = { id: nextId('users'), email, password, name, role: 'student', profile_complete: true, marketing_agreed: 0, marketing_agreed_at: null, phone: null, created_at: now() }
    tables.users.push(user); save(); return user
  },
  createKakaoUser(kakaoId, email, name) {
    const user = { id: nextId('users'), kakao_id: String(kakaoId), email: email || null, password: null, name, role: 'student', profile_complete: false, marketing_agreed: 0, marketing_agreed_at: null, phone: null, created_at: now() }
    tables.users.push(user); save(); return user
  },
  linkKakaoId(userId, kakaoId) {
    const u = tables.users.find(u => u.id === userId)
    if (u) { u.kakao_id = String(kakaoId); save() }
  },
  completeProfile(userId, { name, email, phone, marketing_agreed, ip }) {
    const u = tables.users.find(u => u.id === userId)
    if (!u) return null
    if (name) u.name = name
    if (email) u.email = email
    if (phone) u.phone = phone
    u.profile_complete = true
    if (marketing_agreed && !u.marketing_agreed) {
      u.marketing_agreed = 1
      u.marketing_agreed_at = new Date().toISOString()
      tables.consent_logs.push({
        id: nextId('consent_logs'), user_id: userId,
        type: 'marketing_sms', agreed: 1,
        agreed_at: new Date().toISOString(), ip: ip || null,
      })
    }
    save(); return u
  },
  revokeMarketing(userId, ip) {
    const u = tables.users.find(u => u.id === userId)
    if (!u) return
    u.marketing_agreed = 0
    tables.consent_logs.push({
      id: nextId('consent_logs'), user_id: userId,
      type: 'marketing_sms', agreed: 0,
      agreed_at: new Date().toISOString(), ip: ip || null,
    })
    save()
  },

  // coupons
  createCoupon(userId, amount, reason) {
    const code = 'TADAK' + String(Date.now()).slice(-7) + Math.random().toString(36).slice(2,5).toUpperCase()
    const coupon = { id: nextId('coupons'), user_id: userId, code, amount, reason, status: 'available', created_at: now(), used_at: null }
    tables.coupons.push(coupon); save(); return coupon
  },
  getCouponsByUser(userId) { return tables.coupons.filter(c => c.user_id === userId) },
  getCouponByCode(code) { return tables.coupons.find(c => c.code === code) },
  useCoupon(couponId, orderId) {
    const c = tables.coupons.find(c => c.id === couponId)
    if (!c || c.status !== 'available') return false
    c.status = 'used'; c.used_at = now(); c.order_id = orderId; save(); return true
  },

  // courses
  getCourses(publishedOnly = true) { return tables.courses.filter(c => !publishedOnly || c.is_published) },
  getCourseBySlug(slug) { return tables.courses.find(c => c.slug === slug) },
  getCourseById(id) { return tables.courses.find(c => c.id === id) },
  updateCourse(id, data) {
    const c = tables.courses.find(c => c.id === id); if (!c) return
    Object.assign(c, data); save()
  },
  createLiveCourse({ title, description, category, thumbnail_icon, live_schedule, meet_code }) {
    const course = {
      id: nextId('courses'),
      slug: 'live-' + Date.now(),
      title, description, category,
      thumbnail_icon: thumbnail_icon || 'ti-broadcast',
      thumb_style: 'dark',
      price: 0, sale_price: 0,
      badge: 'LIVE',
      rating: 0, review_count: 0, student_count: 0,
      is_published: 1,
      course_type: 'live',
      live_schedule: live_schedule || null,
      meet_code: meet_code || null,
      live_status: 'upcoming',
      created_at: now(),
    }
    tables.courses.push(course); save(); return course
  },
  getEnrollmentsByCourse(courseId) { return tables.enrollments.filter(e => e.course_id === courseId) },

  // chapters
  getChaptersByCourse(courseId) { return tables.chapters.filter(ch => ch.course_id === courseId).sort((a,b) => a.order_num - b.order_num) },
  getChapterById(id) { return tables.chapters.find(ch => ch.id === id) },

  // enrollments
  isEnrolled(userId, courseId) { return !!tables.enrollments.find(e => e.user_id === userId && e.course_id === courseId) },
  enroll(userId, courseId) {
    if (db.isEnrolled(userId, courseId)) return
    tables.enrollments.push({ id: nextId('enrollments'), user_id: userId, course_id: courseId, enrolled_at: now() }); save()
  },
  getEnrollmentsByUser(userId) { return tables.enrollments.filter(e => e.user_id === userId) },

  // orders
  createOrder(userId, courseId, amount, method, discount = 0) {
    const order = { id: nextId('orders'), user_id: userId, course_id: courseId, amount, discount, method, status: 'paid', paid_at: now() }
    tables.orders.push(order); save(); return order
  },
  getOrdersByUser(userId) { return tables.orders.filter(o => o.user_id === userId) },
  getAllOrders() { return [...tables.orders].reverse() },

  // progress
  getProgress(userId, chapterId) { return tables.progress.find(p => p.user_id === userId && p.chapter_id === chapterId) },
  getProgressByCourse(userId, courseId) {
    const chIds = tables.chapters.filter(ch => ch.course_id === courseId).map(ch => ch.id)
    return tables.progress.filter(p => p.user_id === userId && chIds.includes(p.chapter_id))
  },
  upsertProgress(userId, chapterId, completed, watchedSec) {
    const existing = db.getProgress(userId, chapterId)
    if (existing) { existing.completed = completed ? 1 : 0; existing.watched_sec = watchedSec; existing.updated_at = now() }
    else tables.progress.push({ id: nextId('progress'), user_id: userId, chapter_id: chapterId, completed: completed?1:0, watched_sec: watchedSec, updated_at: now() })
    save()
  },

  // reviews
  getReviews(courseId) { return tables.reviews.filter(r => r.course_id === courseId && r.is_public) },
  getAllReviews() { return [...tables.reviews].reverse() },
  upsertReview(userId, courseId, rating, content) {
    const existing = tables.reviews.find(r => r.user_id === userId && r.course_id === courseId)
    if (existing) { existing.rating = rating; existing.content = content }
    else tables.reviews.push({ id: nextId('reviews'), user_id: userId, course_id: courseId, rating, content, is_public: 1, created_at: now() })
    const pub = tables.reviews.filter(r => r.course_id === courseId && r.is_public)
    const avg = pub.reduce((s,r) => s+r.rating, 0) / (pub.length||1)
    const course = db.getCourseById(courseId)
    if (course) { course.rating = Math.round(avg*10)/10; course.review_count = pub.length }
    save()
  },
  deleteReview(id) { const i = tables.reviews.findIndex(r => r.id === id); if (i>=0) { tables.reviews.splice(i,1); save() } },
  updateReviewPublic(id, isPublic) { const r = tables.reviews.find(r => r.id === id); if (r) { r.is_public = isPublic?1:0; save() } },

  // admin stats
  getStats() {
    const now = new Date(); const m = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0')
    const monthOrders = tables.orders.filter(o => o.status === 'paid' && o.paid_at && o.paid_at.startsWith(m.replace('-','년 ')+'월'))
    const revenue = tables.orders.filter(o=>o.status==='paid').reduce((s,o)=>s+o.amount, 0)
    return {
      revenue,
      newStudents: tables.enrollments.length,
      orderCount: tables.orders.filter(o=>o.status==='paid').length,
      refundPending: tables.orders.filter(o=>o.status==='refund_pending').length,
      totalStudents: tables.users.filter(u=>u.role==='student').length,
    }
  },
  getAllStudents() {
    return tables.users.filter(u=>u.role==='student').map(u => ({
      ...u,
      course_count: tables.enrollments.filter(e=>e.user_id===u.id).length,
      total_paid: tables.orders.filter(o=>o.user_id===u.id&&o.status==='paid').reduce((s,o)=>s+o.amount,0),
    }))
  },
}

module.exports = db
