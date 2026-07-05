const router = require('express').Router()
const db = require('../db/schema')
const { CLIENT_COURSE_REWARD_REASON } = require('../db/schema')
const { authMiddleware } = require('../middleware/auth')

router.post('/', authMiddleware, async (req, res) => {
  const { course_id, method, coupon_code } = req.body
  const course = await db.getCourseById(course_id)
  if (!course) return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })
  if (await db.isEnrolled(req.user.id, course_id)) return res.status(409).json({ error: '이미 수강 중인 강의입니다.' })
  if (await db.isCourseEnrollmentFullAsync(course)) {
    return res.status(409).json({ error: '모집 정원이 마감되었습니다.', code: 'enrollment_full' })
  }
  const checkout = db.getCheckoutWindowPublic(course)
  if (Number(course.sale_price) > 0 && course.course_type !== 'live' && !checkout.checkout_open) {
    return res.status(400).json({
      error: checkout.checkout_message || '현재 결제할 수 없습니다.',
      code: checkout.checkout_status,
    })
  }

  const isFirstPurchase = !(await db.hasPaidCourseOrder(req.user.id))
  const salePrice = Number(course.sale_price || 0)
  const applyCoupon = db.canApplyCourseCoupon(course, {
    skipCoupon: req.body.skip_coupon === true || req.body.skip_coupon === 1 || req.body.skip_coupon === '1',
  })

  let discount = 0
  let appliedCoupons = []

  if (applyCoupon) {
    const stack = await db.resolveStackableCourseDiscount(req.user.id, salePrice, isFirstPurchase)
    if (stack.totalDiscount > 0) {
      discount = stack.totalDiscount
      appliedCoupons = stack.applied
    } else if (coupon_code) {
      let coupon = await db.getCouponByCode(coupon_code)
      if (!coupon) return res.status(400).json({ error: '유효하지 않은 쿠폰입니다.' })
      if (coupon.user_id !== req.user.id) return res.status(403).json({ error: '본인 쿠폰만 사용 가능합니다.' })
      if (coupon.status !== 'available') return res.status(400).json({ error: '이미 사용했거나 만료된 쿠폰입니다.' })
      if (coupon.status === 'expired' || db.isCouponExpired(coupon)) {
        return res.status(400).json({ error: '만료된 쿠폰입니다.' })
      }
      if (coupon.reason === CLIENT_COURSE_REWARD_REASON) {
        return res.status(400).json({ error: '의뢰 할인 쿠폰은 클라이언츠 견적 수락 시 사용할 수 있습니다.' })
      }
      if (coupon.first_course_only && !isFirstPurchase) {
        return res.status(400).json({ error: '이 쿠폰은 최초 강의 결제에만 사용할 수 있습니다.' })
      }
      const singleDiscount = coupon.discount_percent
        ? Math.floor(salePrice * Number(coupon.discount_percent) / 100)
        : Number(coupon.amount || 0)
      if (singleDiscount > 0) {
        discount = singleDiscount
        appliedCoupons = [{ coupon, discount: singleDiscount }]
      }
    }
  }

  const finalAmount = Math.max(0, salePrice - discount)
  let order
  let rewardCoupon = null
  try {
    const enrollResult = await db.enrollAtomically(req.user.id, course_id, course)
    if (enrollResult.error === 'enrollment_full') {
      return res.status(409).json({ error: '모집 정원이 마감되었습니다.', code: 'enrollment_full' })
    }
    order = await db.createOrder(req.user.id, course_id, finalAmount, method, discount)
    for (const { coupon, discount: couponDiscount } of appliedCoupons) {
      await db.useCoupon(coupon.id, {
        order_id: order.id,
        course_id: course_id,
        used_context: 'course_order',
        used_target_type: 'course',
        used_target_id: course_id,
        used_target_title: course.title,
        used_discount: couponDiscount,
      })
    }
    rewardCoupon = await db.issueClientCourseRewardCoupons(req.user.id, course, order.id)
  } catch (e) {
    console.error('결제/수강 등록 오류:', e)
    if (order?.id) await db.cancelOrder(order.id).catch(() => {})
    await db.unenroll(req.user.id, course_id).catch(() => {})
    await db.syncCourseStudentCount(course_id).catch(() => {})
    return res.status(500).json({ error: '결제 처리 중 오류가 발생했습니다. 다시 시도해주세요.' })
  }
  res.json({
    success: true,
    order_id: order.id,
    course_slug: course.slug,
    final_amount: finalAmount,
    discount,
    coupons_applied: appliedCoupons.length,
    reward_coupon: rewardCoupon,
  })
})

router.get('/preview', authMiddleware, async (req, res) => {
  const { course_id } = req.query
  if (!course_id) return res.status(400).json({ error: 'course_id가 필요합니다.' })
  const course = await db.getCourseById(course_id)
  if (!course) return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })

  const checkout = db.getCheckoutWindowPublic(course)
  if (Number(course.sale_price) > 0 && course.course_type !== 'live' && !checkout.checkout_open) {
    return res.status(400).json({
      error: checkout.checkout_message || '현재 결제할 수 없습니다.',
      code: checkout.checkout_status,
    })
  }

  const isFirstPurchase = !(await db.hasPaidCourseOrder(req.user.id))
  const salePrice = Number(course.sale_price || 0)
  const applyCoupon = db.canApplyCourseCoupon(course, { skipCoupon: req.query.coupon === '0' })

  let discount = 0
  let coupon_code = null
  let is_stackable = false

  if (applyCoupon) {
    const stack = await db.resolveStackableCourseDiscount(req.user.id, salePrice, isFirstPurchase)
    if (stack.totalDiscount > 0) {
      discount = stack.totalDiscount
      is_stackable = true
    } else {
      const coupons = await db.getCouponsByUser(req.user.id)
      for (const raw of coupons) {
        const c = db.enrichCoupon(raw)
        if (c.status !== 'available') continue
        if (db.isCouponExpired(c)) continue
        if (c.reason === CLIENT_COURSE_REWARD_REASON) continue
        if (c.first_course_only && !isFirstPurchase) continue
        const d = c.discount_percent
          ? Math.floor(salePrice * Number(c.discount_percent) / 100)
          : Number(c.amount || 0)
        if (d > discount) {
          discount = d
          coupon_code = c.code
        }
      }
    }
  }

  res.json({
    sale_price: salePrice,
    discount,
    final_amount: Math.max(0, salePrice - discount),
    coupon_code,
    is_stackable,
    coupon_allowed: db.isCourseCouponAllowed(course),
    coupon_skipped: !applyCoupon,
  })
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
