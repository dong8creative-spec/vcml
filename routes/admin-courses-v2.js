const express = require('express')
const router = express.Router()
const { adminMiddleware } = require('../middleware/auth')
const coursesV2 = require('../db/courses-v2')

router.use(adminMiddleware)

router.get('/', async (req, res) => {
  try {
    const courses = await coursesV2.getCourses({ publishedOnly: false })
    res.json(courses)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.get('/:id', async (req, res) => {
  try {
    const course = await coursesV2.getCourseById(req.params.id)
    if (!course) return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })
    const chapters = await coursesV2.getChaptersByCourse(course.id)
    res.json({ course, chapters })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/', async (req, res) => {
  try {
    const result = await coursesV2.createCourse(req.body)
    if (result.error) return res.status(400).json({ error: result.error })
    res.json({ success: true, course: result })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.patch('/:id', async (req, res) => {
  try {
    const result = await coursesV2.updateCourse(req.params.id, req.body)
    if (result.error) {
      const status = result.error === 'not_found' ? 404 : 400
      return res.status(status).json({ error: result.error === 'not_found' ? '강의를 찾을 수 없습니다.' : result.error })
    }
    res.json({ success: true, course: result })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── 챕터 ──

router.get('/:id/chapters', async (req, res) => {
  try {
    const course = await coursesV2.getCourseById(req.params.id)
    if (!course) return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })
    const chapters = await coursesV2.getChaptersByCourse(course.id)
    res.json({ course, chapters })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/:id/chapters', async (req, res) => {
  try {
    const result = await coursesV2.createChapter(req.params.id, req.body)
    if (result.error === 'course_not_found') return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })
    if (result.error === 'title_required') return res.status(400).json({ error: '챕터 제목을 입력해주세요.' })
    res.json({ success: true, chapter: result })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.patch('/chapters/:chapterId', async (req, res) => {
  try {
    const result = await coursesV2.updateChapter(req.params.chapterId, req.body)
    if (result?.error === 'not_found') return res.status(404).json({ error: '챕터를 찾을 수 없습니다.' })
    if (result?.error === 'title_required') return res.status(400).json({ error: '챕터 제목을 입력해주세요.' })
    res.json({ success: true, chapter: result })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.delete('/chapters/:chapterId', async (req, res) => {
  try {
    const result = await coursesV2.deleteChapter(req.params.chapterId)
    if (result?.error === 'not_found') return res.status(404).json({ error: '챕터를 찾을 수 없습니다.' })
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/chapters/:chapterId/move', async (req, res) => {
  try {
    const direction = req.body?.direction === 'up' ? 'up' : 'down'
    const result = await coursesV2.moveChapter(req.params.chapterId, direction)
    if (result?.error === 'not_found') return res.status(404).json({ error: '챕터를 찾을 수 없습니다.' })
    if (result?.error === 'cannot_move') return res.status(400).json({ error: '더 이상 이동할 수 없습니다.' })
    res.json({ success: true, chapters: result })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
