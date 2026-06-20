const router = require('express').Router()
const db = require('../db/schema')
const jwt = require('jsonwebtoken')

router.get('/', (req, res) => res.json(db.getCourses()))

router.get('/:slug', (req, res) => {
  const course = db.getCourseBySlug(req.params.slug)
  if (!course || !course.is_published) return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })
  const chapters = db.getChaptersByCourse(course.id)
  let enrolled = false
  try {
    const h = req.headers.authorization
    if (h?.startsWith('Bearer ')) {
      const u = jwt.verify(h.slice(7), process.env.JWT_SECRET)
      enrolled = db.isEnrolled(u.id, course.id)
    }
  } catch {}
  res.json({ ...course, chapters, enrolled })
})

router.get('/:slug/chapters/:chapterId', require('../middleware/auth').authMiddleware, (req, res) => {
  const course = db.getCourseBySlug(req.params.slug)
  if (!course) return res.status(404).json({ error: '강의 없음' })
  const chapter = db.getChapterById(parseInt(req.params.chapterId))
  if (!chapter || chapter.course_id !== course.id) return res.status(404).json({ error: '챕터 없음' })
  if (!chapter.is_free && !db.isEnrolled(req.user.id, course.id)) return res.status(403).json({ error: '수강 신청이 필요합니다.' })

  const progress = db.getProgress(req.user.id, chapter.id)
  const allChs = db.getChaptersByCourse(course.id)
  const idx = allChs.findIndex(c => c.id === chapter.id)
  res.json({ ...chapter, progress: progress || null, prev_id: allChs[idx-1]?.id || null, next_id: allChs[idx+1]?.id || null })
})

// 라이브 무료 강의 수강 신청
router.post('/:slug/enroll-free', require('../middleware/auth').authMiddleware, (req, res) => {
  const course = db.getCourseBySlug(req.params.slug)
  if (!course || !course.is_published) return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })
  if (course.course_type !== 'live') return res.status(400).json({ error: '무료 신청은 라이브 강의만 가능합니다.' })
  if (db.isEnrolled(req.user.id, course.id)) return res.status(409).json({ error: '이미 신청한 강의입니다.' })
  db.enroll(req.user.id, course.id)
  db.createOrder(req.user.id, course.id, 0, '무료', 0)
  course.student_count = (course.student_count || 0) + 1
  db.save()
  res.json({ success: true })
})

module.exports = router
