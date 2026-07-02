const router = require('express').Router()
const multer = require('multer')
const db = require('../db/schema')
const { uploadImageBuffer } = require('../utils/storage')
const { optionalAuth, adminMiddleware } = require('../middleware/auth')

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 슬라이드 이미지 최대 20MB
})

// 토큰이 있으면 req.user 파싱, 없어도 통과 (공개 엔드포인트 유지)
router.use(optionalAuth)

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

// 슬라이드 열람 (열람 권한 + 열람실 전용 후기 130자 조건 확인)
router.get('/courses/:id/slides', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id
    const courseId = req.params.id
    const access = await db.getUserInstitutionAccess(userId)
    const hasAccess = access.some(a => a.course_id === courseId)
    if (!hasAccess) return res.status(403).json({ error: '열람 권한이 없습니다.' })
    const review = await db.getInstitutionReview(userId, courseId)
    if (!review || (review.content || '').length < 130) {
      return res.status(403).json({ error: 'REVIEW_REQUIRED' })
    }
    const course = await db.getInstitutionCourseById(courseId)
    if (!course) return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })
    res.set('Cache-Control', 'no-store')
    res.json({ slides: course.slides || [], title: course.title })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 열람실 전용 후기 제출
router.post('/courses/:id/review', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id
    const courseId = req.params.id
    const content = (req.body.content || '').trim()
    if (content.length < 130) return res.status(400).json({ error: `후기를 ${130 - content.length}자 더 작성해주세요.` })
    const access = await db.getUserInstitutionAccess(userId)
    if (!access.some(a => a.course_id === courseId)) return res.status(403).json({ error: '열람 권한이 없습니다.' })
    await db.submitInstitutionReview(userId, courseId, content)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 관리자 전용 ──────────────────────────────────────

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: '권한이 없습니다.' })
  next()
}

// 이미지 업로드 (커버 or 슬라이드 단건) — multipart/form-data
router.post('/upload', adminMiddleware, upload.single('file'), async (req, res) => {
  try {
    if (!req.file?.buffer?.length) return res.status(400).json({ error: '파일을 선택해주세요.' })
    const ct = String(req.file.mimetype || '').toLowerCase()
    if (!['image/webp', 'image/jpeg', 'image/jpg', 'image/png'].includes(ct)) {
      return res.status(400).json({ error: 'WebP, JPEG, PNG 이미지만 업로드할 수 있습니다.' })
    }
    const kind = req.body?.kind === 'cover' ? 'cover' : 'slide'
    const url = await uploadImageBuffer(req.file.buffer, {
      folder: `institution/${kind}s`,
      contentType: ct === 'image/jpg' ? 'image/jpeg' : ct,
    })
    res.json({ url })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/courses', adminMiddleware, async (req, res) => {
  try {
    const { title, description, cover_image, slides } = req.body
    if (!title) return res.status(400).json({ error: '제목을 입력하세요.' })
    const course = await db.createInstitutionCourse({ title, description: description || '', cover_image: cover_image || '', slides: slides || [] })
    res.json(course)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.put('/courses/:id', adminMiddleware, async (req, res) => {
  try {
    const { title, description, cover_image, slides } = req.body
    await db.updateInstitutionCourse(req.params.id, { title, description, cover_image, slides })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.delete('/courses/:id', adminMiddleware, async (req, res) => {
  try {
    await db.deleteInstitutionCourse(req.params.id)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 관리자용 강의 전체 조회 (슬라이드 포함)
router.get('/courses/:id', adminMiddleware, async (req, res) => {
  try {
    const course = await db.getInstitutionCourseById(req.params.id)
    if (!course) return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })
    res.json(course)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/courses/:id/codes', adminMiddleware, async (req, res) => {
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

router.get('/courses/:id/codes', adminMiddleware, async (req, res) => {
  try {
    const codes = await db.getInstitutionCodesByCourse(req.params.id)
    res.json(codes)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
