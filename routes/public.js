const router = require('express').Router()
const db = require('../db/schema')
const { optionalAuth, allowedReviewTypes } = require('../middleware/auth')

function publicCache(req, res, next) {
  if (req.method === 'GET') {
    res.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120')
  }
  next()
}

router.use(publicCache)

// 공지사항 공개 API
router.get('/notices', async (req, res) => {
  const notices = await db.getNotices({ publicOnly: true })
  res.json(notices)
})
router.get('/notices/:id', async (req, res) => {
  const notice = await db.getNoticeById(req.params.id)
  if (!notice || !notice.is_public) return res.status(404).json({ error: '공지를 찾을 수 없습니다.' })
  res.json(notice)
})

// FAQ 공개 API
router.get('/faqs', async (req, res) => {
  const faqs = await db.getFaqs({ publicOnly: true })
  res.json(faqs)
})

// 블로그 공개 API
router.get('/blog', async (req, res) => {
  const posts = await db.getBlogPosts({ publicOnly: true })
  res.json(posts)
})
router.get('/blog/:slug', async (req, res) => {
  const post = await db.getBlogPostBySlug(req.params.slug)
  if (!post || !post.is_published) return res.status(404).json({ error: '글을 찾을 수 없습니다.' })
  res.json(post)
})

// 1:1 문의 제출 API
router.post('/support/tickets', async (req, res) => {
  const { name, email, type, subject, content, user_id } = req.body
  if (!name || !email || !subject || !content) {
    return res.status(400).json({ error: '이름, 이메일, 제목, 내용은 필수입니다.' })
  }
  const ticket = await db.createTicket({ name, email, type, subject, content, user_id: user_id || null })
  res.json({ success: true, ticket_id: ticket.id })
})

router.get('/stats', async (req, res) => {
  try {
    res.json(await db.getPublicSiteStats())
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.get('/homepage-layout', async (req, res) => {
  try {
    res.json(await db.getHomepageLayout())
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.get('/footer', async (req, res) => {
  try {
    res.json(await db.getFooterConfig())
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 테스트룸 FAB는 수강생 노출 중단 — 하위 호환용 고정 응답
router.get('/test-room', async (_req, res) => {
  res.json({ enabled: false })
})

router.get('/hero', async (req, res) => {
  try {
    res.json(await db.getHeroConfig())
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.get('/instructors', async (req, res) => {
  try {
    const [intro, instructors] = await Promise.all([
      db.getInstructorsIntro(),
      db.getInstructors({ publicOnly: true }),
    ])
    res.json({ intro, instructors })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.get('/recent-orders', async (req, res) => {
  try {
    const orders = await db.getRecentPublicOrders(20)
    res.json({ orders })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 홈페이지 전체 데이터를 한 번에 반환 — API 요청 5개 → 1개로 줄임
router.get('/homepage', optionalAuth, async (req, res) => {
  try {
    res.set('Cache-Control', 'private, no-store')

    const cacheKey = `homepage:data:${req.user?.id || 'anon'}`
    const cached = db._cacheGet(cacheKey)
    if (cached) return res.json(cached)

    const types = allowedReviewTypes(req.user)
    const platformTypes = types.filter(t => t !== 'student')
    const settled = await Promise.allSettled([
      db.getHeroConfig(),
      db.getCourses(true),
      db.getHomepageLayout(),
      db.getRecentPublicOrders(20),
      platformTypes.length ? db.getPlatformReviewsByTypes(platformTypes) : Promise.resolve([]),
      db.getPublicStudentCount(),
      db.getAllReviews(),
    ])
    const value = (idx, fallback) => settled[idx].status === 'fulfilled' ? settled[idx].value : fallback
    const hero = value(0, null)
    const courses = value(1, [])
    const layout = value(2, null)
    const orders = value(3, [])
    const platformReviews = value(4, [])
    const studentCount = value(5, 0)
    const allReviews = value(6, [])

    const TYPE_LABEL = { student: '수강생 후기', client: '의뢰인 후기', editor: '에디터즈 후기' }

    // 수강생 후기 — 실제 reviews 컬렉션 (이름·강의명 조인)
    const studentReviews = types.includes('student')
      ? (allReviews || []).filter(r => db.isPublicReview(r) && r.content)
      : []
    const courseIds = [...new Set(studentReviews.map(r => r.course_id).filter(Boolean))]
    const userIds = [...new Set(studentReviews.map(r => r.user_id).filter(Boolean))]
    const [courseMap, userMap] = await Promise.all([
      courseIds.length ? db.batchGetCourses(courseIds) : {},
      userIds.length ? db.batchGetUsers(userIds) : {},
    ])
    const liveFromCourse = studentReviews.map(r => {
      const user = userMap[r.user_id]
      const name = user?.name || ''
      return {
        id: r.id,
        review_type: 'student',
        type_label: TYPE_LABEL.student,
        author_name: db.maskPublicName(name || '수강생'),
        author_initial: name.trim() ? name.trim()[0] : '수',
        content: r.content,
        rating: db.normalizeReviewRating(r.rating, 5),
        course_title: courseMap[r.course_id]?.title || '',
        created_at: r.created_at,
      }
    })

    // 의뢰인·에디터즈 후기 — platform_reviews 유지
    const liveFromPlatform = platformReviews
      .filter(r => platformTypes.includes(r.review_type))
      .map(r => ({
        id: r.id, review_type: r.review_type,
        type_label: TYPE_LABEL[r.review_type] || r.review_type,
        author_name: db.maskPublicName(r.author_name), author_initial: r.author_initial || (r.author_name ? r.author_name[0] : '?'),
        content: r.content, rating: db.normalizeReviewRating(r.rating, 5),
        course_title: r.context_label || '', created_at: r.created_at,
      }))

    const liveReviews = [...liveFromCourse, ...liveFromPlatform]
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    const publicRatings = (allReviews || [])
      .filter(r => db.isPublicReview(r))
      .map(r => db.normalizeReviewRating(r.rating, 0))
      .filter(n => Number.isFinite(n) && n > 0)
    const avgRating = publicRatings.length
      ? (publicRatings.reduce((s, n) => s + n, 0) / publicRatings.length).toFixed(1)
      : null
    const stats = { student_count: studentCount, review_count: publicRatings.length, avg_rating: avgRating }
    const visibleTypes = types.map(t => ({ type: t, label: TYPE_LABEL[t] }))
    const data = { hero, courses: courses.map(db.pickCourseCardFields), layout, orders: orders || [], liveReviews, visible_types: visibleTypes, stats }
    db._cacheSet(cacheKey, data, 30_000)
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
