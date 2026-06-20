const router = require('express').Router()
const db = require('../db/schema')
const { authMiddleware } = require('../middleware/auth')

router.post('/', authMiddleware, (req, res) => {
  const { course_id, method, coupon_code } = req.body
  const course = db.getCourseById(course_id)
  if (!course) return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })
  if (db.isEnrolled(req.user.id, course_id)) return res.status(409).json({ error: '이미 수강 중인 강의입니다.' })

  let discount = 0
  let coupon = null
  if (coupon_code) {
    coupon = db.getCouponByCode(coupon_code)
    if (!coupon) return res.status(400).json({ error: '유효하지 않은 쿠폰입니다.' })
    if (coupon.user_id !== req.user.id) return res.status(403).json({ error: '본인 쿠폰만 사용 가능합니다.' })
    if (coupon.status !== 'available') return res.status(400).json({ error: '이미 사용했거나 만료된 쿠폰입니다.' })
    discount = coupon.amount
  }

  const finalAmount = Math.max(0, course.sale_price - discount)
  const order = db.createOrder(req.user.id, course_id, finalAmount, method, discount)
  if (coupon) db.useCoupon(coupon.id, order.id)
  db.enroll(req.user.id, course_id)
  course.student_count = (course.student_count || 0) + 1
  db.save()
  res.json({ success: true, order_id: order.id, course_slug: course.slug, final_amount: finalAmount, discount })
})

router.get('/my', authMiddleware, (req, res) => {
  const orders = db.getOrdersByUser(req.user.id).map(o => {
    const c = db.getCourseById(o.course_id)
    return { ...o, title: c?.title, slug: c?.slug, thumbnail_icon: c?.thumbnail_icon, thumb_style: c?.thumb_style, category: c?.category }
  })
  res.json(orders.reverse())
})

module.exports = router
