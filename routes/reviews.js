const router = require('express').Router()
const db = require('../db/schema')
const { optionalAuth, allowedReviewTypes } = require('../middleware/auth')

const TYPE_LABEL = { student: '수강생 후기', client: '의뢰인 후기', editor: '에디터즈 후기' }

function maskName(name) {
  if (!name || name.length < 2) return name || '수강생'
  return name[0] + '**'
}

router.get('/live', optionalAuth, async (req, res) => {
  try {
    const types = allowedReviewTypes(req.user)
    const results = []

    // 수강생 후기 — 실제 reviews 컬렉션에서 강의명·이름 조인
    if (types.includes('student')) {
      const all = await db.getAllReviews()
      const public_ = all.filter(r => r.is_public === 1 || r.is_public === true)
      if (public_.length) {
        const userIds = [...new Set(public_.map(r => r.user_id).filter(Boolean))]
        const courseIds = [...new Set(public_.map(r => r.course_id).filter(Boolean))]
        const [userMap, courseMap] = await Promise.all([
          db.batchGetUsers(userIds),
          db.batchGetCourses(courseIds),
        ])
        public_.forEach(r => {
          const name = userMap[r.user_id]?.name || ''
          results.push({
            id: r.id,
            review_type: 'student',
            type_label: TYPE_LABEL.student,
            author_name: maskName(name),
            author_initial: name ? name[0] : '수',
            content: r.content || '',
            rating: r.rating || 5,
            course_title: courseMap[r.course_id]?.title || '',
            created_at: r.created_at,
          })
        })
      }
    }

    // 의뢰인·에디터즈 후기 — 기존 platform_reviews 유지
    const otherTypes = types.filter(t => t !== 'student')
    if (otherTypes.length) {
      const platform = await db.getPlatformReviewsByTypes(otherTypes)
      platform.forEach(r => {
        results.push({
          id: r.id,
          review_type: r.review_type,
          type_label: TYPE_LABEL[r.review_type] || r.review_type,
          author_name: maskName(r.author_name),
          author_initial: r.author_initial || (r.author_name ? r.author_name[0] : '?'),
          content: r.content || '',
          rating: r.rating || 5,
          course_title: r.context_label || '',
          created_at: r.created_at,
        })
      })
    }

    results.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))

    res.json({
      reviews: results,
      visible_types: types.map(t => ({ type: t, label: TYPE_LABEL[t] })),
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
