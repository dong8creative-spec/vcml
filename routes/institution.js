const router = require('express').Router()
const db = require('../db/schema')

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '로그인이 필요합니다.' })
  next()
}

// 기관강의 목록 (공개 — 슬라이드 없이 메타만)
router.get('/courses', async (req, res) => {
  try {
    const courses = await db.getInstitutionCourses()
    res.json(courses.map(c => ({
      id: c.id,
      title: c.title,
      description: c.description,
      cover_image: c.cover_image,
      slide_count: (c.slides || []).length,
      created_at: c.created_at,
    })))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 접근 코드 검증 + 열람 권한 부여
router.post('/redeem', requireAuth, async (req, res) => {
  try {
    const { code } = req.body
    if (!code) return res.status(400).json({ error: '코드를 입력하세요.' })
    const userId = req.user.id
    const result = await db.validateInstitutionCode(code, userId)
    if (!result.ok) {
      const msg = result.reason === 'limit_reached'
        ? '이 코드의 사용 횟수가 초과됐습니다.'
        : '올바르지 않은 코드입니다.'
      return res.status(400).json({ error: msg })
    }
    if (!result.already) {
      await db.redeemInstitutionCode(result.codeId, userId)
    }
    const course = await db.getInstitutionCourseById(result.courseId)
    res.json({ ok: true, course_id: result.courseId, course_title: course?.title })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 내가 열람 가능한 강의 목록
router.get('/my-courses', requireAuth, async (req, res) => {
  try {
    const access = await db.getUserInstitutionAccess(req.user.id)
    const courseIds = [...new Set(access.map(a => a.course_id))]
    if (!courseIds.length) return res.json([])
    const courses = await Promise.all(courseIds.map(id => db.getInstitutionCourseById(id)))
    res.json(courses.filter(Boolean).map(c => ({
      id: c.id,
      title: c.title,
      description: c.description,
      cover_image: c.cover_image,
      slide_count: (c.slides || []).length,
    })))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 슬라이드 열람 (열람 권한 확인 후 이미지 URL 반환)
router.get('/courses/:id/slides', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id
    const courseId = req.params.id
    const access = await db.getUserInstitutionAccess(userId)
    const hasAccess = access.some(a => a.course_id === courseId)
    if (!hasAccess) return res.status(403).json({ error: '열람 권한이 없습니다.' })
    const course = await db.getInstitutionCourseById(courseId)
    if (!course) return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })
    res.set('Cache-Control', 'no-store')
    res.json({ slides: course.slides || [], title: course.title })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 관리자 전용 ──────────────────────────────────────

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: '권한이 없습니다.' })
  next()
}

router.post('/courses', requireAdmin, async (req, res) => {
  try {
    const { title, description, cover_image, slides } = req.body
    if (!title) return res.status(400).json({ error: '제목을 입력하세요.' })
    const course = await db.createInstitutionCourse({ title, description: description || '', cover_image: cover_image || '', slides: slides || [] })
    res.json(course)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.put('/courses/:id', requireAdmin, async (req, res) => {
  try {
    const { title, description, cover_image, slides } = req.body
    await db.updateInstitutionCourse(req.params.id, { title, description, cover_image, slides })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.delete('/courses/:id', requireAdmin, async (req, res) => {
  try {
    await db.deleteInstitutionCourse(req.params.id)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 관리자용 강의 전체 조회 (슬라이드 포함)
router.get('/courses/:id', requireAdmin, async (req, res) => {
  try {
    const course = await db.getInstitutionCourseById(req.params.id)
    if (!course) return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })
    res.json(course)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/courses/:id/codes', requireAdmin, async (req, res) => {
  try {
    const { code, max_uses, note } = req.body
    if (!code || !max_uses) return res.status(400).json({ error: '코드와 최대 사용 횟수를 입력하세요.' })
    const result = await db.createInstitutionCode({
      course_id: req.params.id,
      code: code.toUpperCase(),
      max_uses: parseInt(max_uses),
      note: note || '',
    })
    res.json(result)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.get('/courses/:id/codes', requireAdmin, async (req, res) => {
  try {
    const codes = await db.getInstitutionCodesByCourse(req.params.id)
    res.json(codes)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
