const router = require('express').Router()
const db = require('../db/schema')
const { authMiddleware } = require('../middleware/auth')

router.post('/', authMiddleware, async (req, res) => {
  const { course_id, method, coupon_code } = req.body
  const course = await db.getCourseById(course_id)
  if (!course) return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })
  if (await db.isEnrolled(req.user.id, course_id)) return res.status(409).json({ error: '이미 수강 중인 강의입니다.' })

  let discount = 0
  let coupon = null
  if (coupon_code) {
    coupon = await db.getCouponByCode(coupon_code)
    if (!coupon) return res.status(400).json({ error: '유효하지 않은 쿠폰입니다.' })
    if (coupon.user_id !== req.user.id) return res.status(403).json({ error: '본인 쿠폰만 사용 가능합니다.' })
    if (coupon.status !== 'available') return res.status(400).json({ error: '이미 사용했거나 만료된 쿠폰입니다.' })
    discount = coupon.amount
  }

  const finalAmount = Math.max(0, course.sale_price - discount)
  let order
  try {
    order = await db.createOrder(req.user.id, course_id, finalAmount, method, discount)
    if (coupon) await db.useCoupon(coupon.id, order.id)
    await db.enroll(req.user.id, course_id)
    await db.updateCourse(course_id, { student_count: (course.student_count || 0) + 1 })
  } catch (e) {
    console.error('결제/수강 등록 오류:', e)
    if (order?.id) await db.cancelOrder(order.id).catch(() => {})
    return res.status(500).json({ error: '결제 처리 중 오류가 발생했습니다. 다시 시도해주세요.' })
  }
  res.json({ success: true, order_id: order.id, course_slug: course.slug, final_amount: finalAmount, discount })
})

router.get('/my', authMiddleware, async (req, res) => {
  const orders = await db.getOrdersByUser(req.user.id)
  const result = await Promise.all(orders.map(async o => {
    const c = await db.getCourseById(o.course_id)
    return { ...o, title: c?.title, slug: c?.slug, thumbnail_icon: c?.thumbnail_icon, thumb_style: c?.thumb_style, category: c?.category }
  }))
  res.json(result.reverse())
})

module.exports = router
