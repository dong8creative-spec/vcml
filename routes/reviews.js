const router = require('express').Router()
const db = require('../db/schema')
const { optionalAuth, allowedReviewTypes } = require('../middleware/auth')

const TYPE_LABEL = { student: '수강생 후기', client: '의뢰인 후기', editor: '에디터즈 후기' }

router.get('/live', optionalAuth, async (req, res) => {
  try {
    const types = allowedReviewTypes(req.user)
    const reviews = await db.getPlatformReviewsByTypes(types)
    res.json({
      reviews: reviews.map(r => ({
        id: r.id,
        review_type: r.review_type,
        type_label: TYPE_LABEL[r.review_type] || r.review_type,
        author_name: r.author_name,
        author_initial: r.author_initial,
        content: r.content,
        rating: r.rating || 5,
        context_label: r.context_label,
        created_at: r.created_at,
      })),
      visible_types: types.map(t => ({ type: t, label: TYPE_LABEL[t] })),
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
