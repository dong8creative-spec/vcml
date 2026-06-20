const admin = require('firebase-admin')
const bcrypt = require('bcryptjs')

// ── Firebase Admin 초기화 ──
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    }),
  })
}

const fs = admin.firestore()

function now() { return new Date().toISOString() }

function nextId() {
  return fs.collection('_').doc().id
}

// ── 시드 데이터 (최초 1회) ──
async function seed() {
  const snap = await fs.collection('courses').limit(1).get()
  if (!snap.empty) return

  const pw = bcrypt.hashSync('admin1234', 10)
  await fs.collection('users').add({ email: 'admin@tadakclass.com', password: pw, name: '관리자', role: 'admin', profile_complete: true, marketing_agreed: 0, phone: null, created_at: now() })
  const demoPw = bcrypt.hashSync('demo1234', 10)
  const demoRef = await fs.collection('users').add({ email: 'demo@tadakclass.com', password: demoPw, name: '데모 수강생', role: 'student', profile_complete: true, marketing_agreed: 0, phone: null, created_at: now() })

  const courses = [
    { slug:'premiere-pro', title:'프리미어 프로 완전 정복 — 편집의 모든 것', category:'영상 편집', description:'타임라인 구성부터 색보정·오디오 믹싱까지, 현업 편집자의 실전 워크플로우를 그대로 배웁니다.', thumbnail_icon:'ti-cut', thumb_style:'dark', price:120000, sale_price:89000, badge:'BEST', rating:4.9, review_count:1240, student_count:1240, is_published:1, course_type:'recorded' },
    { slug:'after-effects', title:'After Effects 모션그래픽 실전 마스터', category:'모션그래픽', description:'키프레임부터 익스프레션, 3D 레이어까지 — 방송·광고 현장에서 쓰는 모션그래픽을 만듭니다.', thumbnail_icon:'ti-sparkles', thumb_style:'light', price:130000, sale_price:99000, badge:'BEST', rating:4.9, review_count:987, student_count:987, is_published:1, course_type:'recorded' },
    { slug:'davinci-color', title:'다빈치 리졸브 색보정 — 시네마틱 룩 완성', category:'색보정', description:'로그 영상 해석부터 커스텀 LUT 제작까지, 영화 같은 색감을 만드는 색보정 전 과정을 다룹니다.', thumbnail_icon:'ti-color-swatch', thumb_style:'dark', price:99000, sale_price:79000, badge:null, rating:4.8, review_count:763, student_count:763, is_published:1, course_type:'recorded' },
    { slug:'youtube-production', title:'유튜브 채널 영상 제작 A to Z', category:'유튜브·콘텐츠', description:'기획·촬영·편집·썸네일까지 구독자를 늘리는 유튜브 영상의 전 제작 과정을 익힙니다.', thumbnail_icon:'ti-brand-youtube', thumb_style:'light', price:89000, sale_price:69000, badge:'NEW', rating:4.8, review_count:521, student_count:521, is_published:1, course_type:'recorded' },
    { slug:'shortform', title:'숏폼 영상 제작 — 릴스·틱톡·쇼츠 완성', category:'유튜브·콘텐츠', description:'15~60초 안에 시선을 붙잡는 숏폼 편집 공식과 바이럴 전략을 배웁니다.', thumbnail_icon:'ti-device-mobile-vibration', thumb_style:'dark', price:79000, sale_price:59000, badge:'NEW', rating:4.7, review_count:412, student_count:412, is_published:1, course_type:'recorded' },
    { slug:'camera-lighting', title:'촬영 & 조명 기초 — 카메라를 제대로 다루는 법', category:'촬영·조명', description:'노출·화이트밸런스·심도부터 원포인트 조명 세팅까지 혼자서도 퀄리티 높은 영상을 찍는 법을 알려줍니다.', thumbnail_icon:'ti-camera', thumb_style:'light', price:99000, sale_price:79000, badge:null, rating:4.8, review_count:634, student_count:634, is_published:1, course_type:'recorded' },
    { slug:'commercial-video', title:'광고·상업 영상 제작 실전 클래스', category:'광고·상업', description:'브랜드 필름부터 제품 광고까지 — 클라이언트 납품 수준의 상업 영상을 처음부터 끝까지 만듭니다.', thumbnail_icon:'ti-movie', thumb_style:'dark', price:149000, sale_price:119000, badge:null, rating:4.9, review_count:389, student_count:389, is_published:1, course_type:'recorded' },
    { slug:'drone-video', title:'드론 영상 촬영·편집 완성', category:'드론·항공', description:'드론 조종 기초부터 항공 푸티지 편집, 시네마틱 드론 샷 연출법까지 한 번에 배웁니다.', thumbnail_icon:'ti-drone', thumb_style:'light', price:119000, sale_price:89000, badge:null, rating:4.7, review_count:298, student_count:298, is_published:1, course_type:'recorded' },
    { slug:'sound-design', title:'영상 사운드 디자인 — 음악·효과음·믹싱', category:'사운드', description:'BGM 선곡·편집부터 폴리 효과음 제작, 오디오 믹싱까지 영상의 완성도를 높이는 사운드 전 과정을 다룹니다.', thumbnail_icon:'ti-music', thumb_style:'dark', price:89000, sale_price:69000, badge:null, rating:4.8, review_count:276, student_count:276, is_published:1, course_type:'recorded' },
  ]

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

  for (const c of courses) {
    const ref = await fs.collection('courses').add({ ...c, created_at: now() })
    const chs = chapterDefs[c.slug] || [
      { t:'강의 소개', d:'10분', free:1 },
      { t:'핵심 내용 1강', d:'30분', free:0 },
      { t:'핵심 내용 2강', d:'35분', free:0 },
    ]
    for (let i = 0; i < chs.length; i++) {
      await fs.collection('chapters').add({ course_id: ref.id, order_num: i+1, title: chs[i].t, duration: chs[i].d, is_free: chs[i].free, video_url: null })
    }
    if (c.slug === 'premiere-pro') {
      await fs.collection('enrollments').add({ user_id: demoRef.id, course_id: ref.id, enrolled_at: now() })
      await fs.collection('orders').add({ user_id: demoRef.id, course_id: ref.id, amount: c.sale_price, discount: 0, method: '카카오페이', status: 'paid', paid_at: now() })
    }
  }
  console.log('✓ Firestore 시드 데이터 완료')
}

// ── 헬퍼 ──
function docToObj(doc) { return doc.exists ? { id: doc.id, ...doc.data() } : null }
function snapToArr(snap) { return snap.docs.map(d => ({ id: d.id, ...d.data() })) }

// ── DB API ──
const db = {
  // users
  async findUserByEmail(email) {
    const snap = await fs.collection('users').where('email', '==', email).limit(1).get()
    return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() }
  },
  async findUserById(id) {
    const doc = await fs.collection('users').doc(id).get()
    return docToObj(doc)
  },
  async findUserByKakaoId(kakaoId) {
    const snap = await fs.collection('users').where('kakao_id', '==', String(kakaoId)).limit(1).get()
    return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() }
  },
  async createUser(email, password, name) {
    const data = { email, password, name, role: 'student', profile_complete: true, marketing_agreed: 0, marketing_agreed_at: null, phone: null, created_at: now() }
    const ref = await fs.collection('users').add(data)
    return { id: ref.id, ...data }
  },
  async createKakaoUser(kakaoId, email, name) {
    const data = { kakao_id: String(kakaoId), email: email || null, password: null, name, role: 'student', profile_complete: false, marketing_agreed: 0, marketing_agreed_at: null, phone: null, created_at: now() }
    const ref = await fs.collection('users').add(data)
    return { id: ref.id, ...data }
  },
  async linkKakaoId(userId, kakaoId) {
    await fs.collection('users').doc(userId).update({ kakao_id: String(kakaoId) })
  },
  async completeProfile(userId, { name, email, phone, marketing_agreed, ip }) {
    const update = { profile_complete: true }
    if (name) update.name = name
    if (email) update.email = email
    if (phone) update.phone = phone
    if (marketing_agreed) {
      update.marketing_agreed = 1
      update.marketing_agreed_at = new Date().toISOString()
      await fs.collection('consent_logs').add({ user_id: userId, type: 'marketing_sms', agreed: 1, agreed_at: new Date().toISOString(), ip: ip || null })
    }
    await fs.collection('users').doc(userId).update(update)
    return db.findUserById(userId)
  },
  async revokeMarketing(userId, ip) {
    await fs.collection('users').doc(userId).update({ marketing_agreed: 0 })
    await fs.collection('consent_logs').add({ user_id: userId, type: 'marketing_sms', agreed: 0, agreed_at: new Date().toISOString(), ip: ip || null })
  },

  // courses
  async getCourses(publishedOnly = true) {
    let q = fs.collection('courses')
    if (publishedOnly) q = q.where('is_published', '==', 1)
    const snap = await q.get()
    return snapToArr(snap)
  },
  async getCourseBySlug(slug) {
    const snap = await fs.collection('courses').where('slug', '==', slug).limit(1).get()
    return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() }
  },
  async getCourseById(id) {
    const doc = await fs.collection('courses').doc(id).get()
    return docToObj(doc)
  },
  async updateCourse(id, data) {
    await fs.collection('courses').doc(id).update(data)
  },
  async createLiveCourse({ title, description, category, thumbnail_icon, live_schedule, meet_code }) {
    const slug = 'live-' + Date.now()
    const data = { slug, title, description: description || '', category, thumbnail_icon: thumbnail_icon || 'ti-broadcast', thumb_style: 'dark', price: 0, sale_price: 0, badge: 'LIVE', rating: 0, review_count: 0, student_count: 0, is_published: 1, course_type: 'live', live_schedule: live_schedule || null, meet_code: meet_code || null, live_status: 'upcoming', created_at: now() }
    const ref = await fs.collection('courses').add(data)
    return { id: ref.id, ...data }
  },

  // chapters
  async getChaptersByCourse(courseId) {
    const snap = await fs.collection('chapters').where('course_id', '==', courseId).orderBy('order_num').get()
    return snapToArr(snap)
  },
  async getChapterById(id) {
    const doc = await fs.collection('chapters').doc(id).get()
    return docToObj(doc)
  },

  // enrollments
  async isEnrolled(userId, courseId) {
    const snap = await fs.collection('enrollments').where('user_id', '==', userId).where('course_id', '==', courseId).limit(1).get()
    return !snap.empty
  },
  async enroll(userId, courseId) {
    const already = await db.isEnrolled(userId, courseId)
    if (already) return
    await fs.collection('enrollments').add({ user_id: userId, course_id: courseId, enrolled_at: now() })
  },
  async getEnrollmentsByUser(userId) {
    const snap = await fs.collection('enrollments').where('user_id', '==', userId).get()
    return snapToArr(snap)
  },
  async getEnrollmentsByCourse(courseId) {
    const snap = await fs.collection('enrollments').where('course_id', '==', courseId).get()
    return snapToArr(snap)
  },

  // orders
  async createOrder(userId, courseId, amount, method, discount = 0) {
    const data = { user_id: userId, course_id: courseId, amount, discount, method, status: 'paid', paid_at: now() }
    const ref = await fs.collection('orders').add(data)
    return { id: ref.id, ...data }
  },
  async getOrdersByUser(userId) {
    const snap = await fs.collection('orders').where('user_id', '==', userId).get()
    return snapToArr(snap)
  },
  async getAllOrders() {
    const snap = await fs.collection('orders').orderBy('paid_at', 'desc').get()
    return snapToArr(snap)
  },

  // progress
  async getProgress(userId, chapterId) {
    const snap = await fs.collection('progress').where('user_id', '==', userId).where('chapter_id', '==', chapterId).limit(1).get()
    return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() }
  },
  async getProgressByCourse(userId, courseId) {
    const chapters = await db.getChaptersByCourse(courseId)
    const chIds = chapters.map(c => c.id)
    const snap = await fs.collection('progress').where('user_id', '==', userId).get()
    return snapToArr(snap).filter(p => chIds.includes(p.chapter_id))
  },
  async upsertProgress(userId, chapterId, completed, watchedSec) {
    const existing = await db.getProgress(userId, chapterId)
    if (existing) {
      await fs.collection('progress').doc(existing.id).update({ completed: completed ? 1 : 0, watched_sec: watchedSec, updated_at: now() })
    } else {
      await fs.collection('progress').add({ user_id: userId, chapter_id: chapterId, completed: completed ? 1 : 0, watched_sec: watchedSec, updated_at: now() })
    }
  },

  // reviews
  async getReviews(courseId) {
    const snap = await fs.collection('reviews').where('course_id', '==', courseId).where('is_public', '==', 1).get()
    return snapToArr(snap)
  },
  async getAllReviews() {
    const snap = await fs.collection('reviews').orderBy('created_at', 'desc').get()
    return snapToArr(snap)
  },
  async upsertReview(userId, courseId, rating, content) {
    const snap = await fs.collection('reviews').where('user_id', '==', userId).where('course_id', '==', courseId).limit(1).get()
    if (!snap.empty) {
      await fs.collection('reviews').doc(snap.docs[0].id).update({ rating, content })
    } else {
      await fs.collection('reviews').add({ user_id: userId, course_id: courseId, rating, content, is_public: 1, created_at: now() })
    }
    const pub = await db.getReviews(courseId)
    const avg = pub.reduce((s, r) => s + r.rating, 0) / (pub.length || 1)
    await db.updateCourse(courseId, { rating: Math.round(avg * 10) / 10, review_count: pub.length })
  },
  async deleteReview(id) {
    await fs.collection('reviews').doc(id).delete()
  },
  async updateReviewPublic(id, isPublic) {
    await fs.collection('reviews').doc(id).update({ is_public: isPublic ? 1 : 0 })
  },

  // coupons
  async createCoupon(userId, amount, reason) {
    const code = 'TADAK' + String(Date.now()).slice(-7) + Math.random().toString(36).slice(2,5).toUpperCase()
    const data = { user_id: userId, code, amount, reason, status: 'available', created_at: now(), used_at: null }
    const ref = await fs.collection('coupons').add(data)
    return { id: ref.id, ...data }
  },
  async getCouponsByUser(userId) {
    const snap = await fs.collection('coupons').where('user_id', '==', userId).get()
    return snapToArr(snap)
  },
  async getCouponByCode(code) {
    const snap = await fs.collection('coupons').where('code', '==', code).limit(1).get()
    return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() }
  },
  async useCoupon(couponId, orderId) {
    const doc = await fs.collection('coupons').doc(couponId).get()
    if (!doc.exists || doc.data().status !== 'available') return false
    await fs.collection('coupons').doc(couponId).update({ status: 'used', used_at: now(), order_id: orderId })
    return true
  },

  // ── 의뢰(프로젝트) ──
  async createProject(clientId, { title, description, category, budget_min, budget_max, deadline, requirements }) {
    const data = { client_id: clientId, title, description, category, budget_min: budget_min||0, budget_max: budget_max||0, deadline: deadline||null, requirements: requirements||'', status: 'open', created_at: now() }
    const ref = await fs.collection('projects').add(data)
    return { id: ref.id, ...data }
  },
  async getProjects(status = null) {
    let q = fs.collection('projects').orderBy('created_at', 'desc')
    if (status) q = q.where('status', '==', status)
    const snap = await q.get()
    return snapToArr(snap)
  },
  async getProjectById(id) {
    const doc = await fs.collection('projects').doc(id).get()
    return docToObj(doc)
  },
  async getProjectsByClient(clientId) {
    const snap = await fs.collection('projects').where('client_id', '==', clientId).orderBy('created_at', 'desc').get()
    return snapToArr(snap)
  },
  async updateProject(id, data) {
    await fs.collection('projects').doc(id).update(data)
  },

  // ── 견적(Quote) ──
  async submitQuote(editorId, projectId, { amount, message }) {
    const existing = await fs.collection('quotes').where('editor_id', '==', editorId).where('project_id', '==', projectId).limit(1).get()
    if (!existing.empty) throw new Error('이미 견적을 제출했습니다.')
    const data = { editor_id: editorId, project_id: projectId, amount, message, status: 'pending', created_at: now() }
    const ref = await fs.collection('quotes').add(data)
    return { id: ref.id, ...data }
  },
  async getQuotesByProject(projectId) {
    const snap = await fs.collection('quotes').where('project_id', '==', projectId).orderBy('created_at', 'asc').get()
    return snapToArr(snap)
  },
  async getQuotesByEditor(editorId) {
    const snap = await fs.collection('quotes').where('editor_id', '==', editorId).orderBy('created_at', 'desc').get()
    return snapToArr(snap)
  },
  async acceptQuote(quoteId, projectId) {
    // 해당 견적 승인, 나머지 거절, 프로젝트 상태 변경
    await fs.collection('quotes').doc(quoteId).update({ status: 'accepted' })
    const others = await fs.collection('quotes').where('project_id', '==', projectId).get()
    for (const d of others.docs) {
      if (d.id !== quoteId) await d.ref.update({ status: 'rejected' })
    }
    await fs.collection('projects').doc(projectId).update({ status: 'matched', matched_quote_id: quoteId })
  },

  // ── 편집자 신청 ──
  async applyEditor(userId, { intro, skills, portfolio_url, experience_years, tools }) {
    const existing = await fs.collection('editor_applications').where('user_id', '==', userId).limit(1).get()
    if (!existing.empty) {
      const doc = existing.docs[0]
      await doc.ref.update({ intro, skills, portfolio_url, experience_years, tools, status: 'pending', applied_at: now() })
      return { id: doc.id, ...doc.data(), intro, skills, portfolio_url, experience_years, tools, status: 'pending' }
    }
    const data = { user_id: userId, intro, skills, portfolio_url: portfolio_url || null, experience_years: experience_years || 0, tools: tools || [], status: 'pending', applied_at: now(), reviewed_at: null, reject_reason: null }
    const ref = await fs.collection('editor_applications').add(data)
    return { id: ref.id, ...data }
  },
  async getEditorApplication(userId) {
    const snap = await fs.collection('editor_applications').where('user_id', '==', userId).limit(1).get()
    return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() }
  },
  async getAllEditorApplications(status = null) {
    let q = fs.collection('editor_applications')
    if (status) q = q.where('status', '==', status)
    const snap = await q.orderBy('applied_at', 'desc').get()
    return snapToArr(snap)
  },
  async reviewEditorApplication(appId, status, rejectReason = null) {
    const doc = await fs.collection('editor_applications').doc(appId).get()
    if (!doc.exists) return null
    await doc.ref.update({ status, reviewed_at: now(), reject_reason: rejectReason || null })
    if (status === 'approved') {
      await fs.collection('users').doc(doc.data().user_id).update({ role: 'editor' })
    } else if (status === 'rejected') {
      await fs.collection('users').doc(doc.data().user_id).update({ role: 'student' })
    }
    return { id: doc.id, ...doc.data(), status }
  },
  async getEditorProfile(userId) {
    const [user, app] = await Promise.all([
      db.findUserById(userId),
      fs.collection('editor_applications').where('user_id', '==', userId).where('status', '==', 'approved').limit(1).get(),
    ])
    if (!user || user.role !== 'editor' || app.empty) return null
    return { ...user, password: undefined, ...app.docs[0].data(), app_id: app.docs[0].id }
  },
  async getApprovedEditors() {
    const snap = await fs.collection('editor_applications').where('status', '==', 'approved').get()
    return Promise.all(snap.docs.map(async d => {
      const user = await db.findUserById(d.data().user_id)
      if (!user) return null
      return { ...d.data(), id: d.id, user_id: user.id, name: user.name, created_at: user.created_at }
    })).then(arr => arr.filter(Boolean))
  },

  // admin stats
  async getStats() {
    const [orders, enrollments, users] = await Promise.all([
      fs.collection('orders').where('status', '==', 'paid').get(),
      fs.collection('enrollments').get(),
      fs.collection('users').where('role', '==', 'student').get(),
    ])
    const revenue = orders.docs.reduce((s, d) => s + (d.data().amount || 0), 0)
    return {
      revenue,
      newStudents: enrollments.size,
      orderCount: orders.size,
      refundPending: 0,
      totalStudents: users.size,
    }
  },
  async getAllStudents() {
    const snap = await fs.collection('users').where('role', '==', 'student').get()
    return Promise.all(snap.docs.map(async d => {
      const u = { id: d.id, ...d.data() }
      const [enr, ord] = await Promise.all([
        fs.collection('enrollments').where('user_id', '==', u.id).get(),
        fs.collection('orders').where('user_id', '==', u.id).where('status', '==', 'paid').get(),
      ])
      return { ...u, course_count: enr.size, total_paid: ord.docs.reduce((s, o) => s + (o.data().amount || 0), 0) }
    }))
  },
  async getCourseStats() {
    const courses = await db.getCourses(false)
    return Promise.all(courses.map(async c => {
      const snap = await fs.collection('orders').where('course_id', '==', c.id).where('status', '==', 'paid').get()
      const revenue = snap.docs.reduce((s, d) => s + (d.data().amount || 0), 0)
      return { id: c.id, title: c.title, sale_price: c.sale_price, student_count: c.student_count || 0, revenue }
    }))
  },
}

seed().catch(console.error)

module.exports = db
