const router = require('express').Router()
const db = require('../db/schema')
const { CLIENT_COURSE_REWARD_REASON, ANTICIPATION_COUPON_REASON } = require('../db/schema')
const { authMiddleware } = require('../middleware/auth')

router.post('/', authMiddleware, async (req, res) => {
  const { course_id, method, coupon_code } = req.body
  const course = await db.getCourseById(course_id)
  if (!course) return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })
  if (await db.isEnrolled(req.user.id, course_id)) return res.status(409).json({ error: '이미 수강 중인 강의입니다.' })

  const anticipation = await db.getAnticipationReviewByUserAndCourse(req.user.id, course_id)
  if (!anticipation) {
    return res.status(400).json({ error: '기대평 작성 후 결제할 수 있습니다.', code: 'anticipation_required' })
  }

  let discount = 0
  let coupon = null
  if (coupon_code) {
    coupon = await db.getCouponByCode(coupon_code)
    if (!coupon) return res.status(400).json({ error: '유효하지 않은 쿠폰입니다.' })
    if (coupon.user_id !== req.user.id) return res.status(403).json({ error: '본인 쿠폰만 사용 가능합니다.' })
    if (coupon.status !== 'available') return res.status(400).json({ error: '이미 사용했거나 만료된 쿠폰입니다.' })
    if (coupon.status === 'expired' || db.isCouponExpired(coupon)) {
      return res.status(400).json({ error: '만료된 쿠폰입니다. 유효기간은 발급일로부터 1개월입니다.' })
    }
    if (coupon.reason === CLIENT_COURSE_REWARD_REASON) {
      return res.status(400).json({ error: '의뢰 할인 쿠폰은 클라이언츠 견적 수락 시 사용할 수 있습니다.' })
    }
    if (coupon.reason === ANTICIPATION_COUPON_REASON || coupon.first_course_only) {
      const priorOrders = await db.getOrdersByUser(req.user.id)
      if (priorOrders.length > 0) {
        return res.status(400).json({ error: '기대평 쿠폰은 최초 강의 결제에만 사용할 수 있습니다.' })
      }
    }
    if (coupon.discount_percent) {
      discount = Math.floor((course.sale_price || 0) * Number(coupon.discount_percent) / 100)
    } else {
      discount = coupon.amount || 0
    }
  }

  const finalAmount = Math.max(0, course.sale_price - discount)
  let order
  let rewardCoupon = null
  try {
    order = await db.createOrder(req.user.id, course_id, finalAmount, method, discount)
    if (coupon) {
      await db.useCoupon(coupon.id, {
        order_id: order.id,
        course_id: course_id,
        used_context: 'course_order',
        used_target_type: 'course',
        used_target_id: course_id,
        used_target_title: course.title,
        used_discount: discount,
      })
    }
    await db.enroll(req.user.id, course_id)
    await db.updateCourse(course_id, { student_count: (course.student_count || 0) + 1 })
    rewardCoupon = await db.issueClientCourseRewardCoupons(req.user.id, course, order.id)
  } catch (e) {
    console.error('결제/수강 등록 오류:', e)
    if (order?.id) await db.cancelOrder(order.id).catch(() => {})
    return res.status(500).json({ error: '결제 처리 중 오류가 발생했습니다. 다시 시도해주세요.' })
  }
  res.json({ success: true, order_id: order.id, course_slug: course.slug, final_amount: finalAmount, discount, reward_coupon: rewardCoupon })
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
