const router = require('express').Router()
const db = require('../db/schema')
const { authMiddleware } = require('../middleware/auth')

/** @deprecated 강의별 기대평은 /api/courses/:slug/apply-with-anticipation 사용 */

router.get('/', async (_req, res) => {
  try {
    const reviews = await db.getPublicAnticipationReviews()
    res.json({
      deprecated: true,
      message: '강의별 기대평은 각 강의 상세 페이지에서 작성해주세요.',
      reviews: reviews.filter(r => r.course_id).map(r => ({
        id: r.id,
        course_id: r.course_id,
        author_id_display: r.author_id_display || r.author_display,
        author_display: r.author_display,
        content: r.content,
        created_at: r.created_at,
      })),
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.get('/mine', authMiddleware, async (req, res) => {
  res.json({
    deprecated: true,
    message: '강의별 기대평은 각 강의 상세 페이지에서 확인할 수 있습니다.',
    submitted: false,
    review: null,
  })
})

router.post('/', authMiddleware, async (_req, res) => {
  res.status(410).json({
    error: '오픈 베타 기대평은 종료되었습니다. 원하는 강의 상세 페이지에서 기대평을 작성해주세요.',
    code: 'deprecated',
  })
})

module.exports = router
