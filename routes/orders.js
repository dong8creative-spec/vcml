const router = require('express').Router()
const db = require('../db/schema')
const { CLIENT_COURSE_REWARD_REASON } = require('../db/schema')
const { authMiddleware } = require('../middleware/auth')

async function resolveCheckoutPricing(userId, course, body = {}) {
  const isFirstPurchase = !(await db.hasPaidCourseOrder(userId))
  const salePrice = Number(course.sale_price || 0)
  const applyCoupon = db.canApplyCourseCoupon(course, {
    skipCoupon: body.skip_coupon === true || body.skip_coupon === 1 || body.skip_coupon === '1',
  })

  let discount = 0
  let appliedCoupons = []

  if (applyCoupon) {
    const stack = await db.resolveStackableCourseDiscount(userId, salePrice, isFirstPurchase)
    if (stack.totalDiscount > 0) {
      discount = stack.totalDiscount
      appliedCoupons = stack.applied
    } else if (body.coupon_code) {
      let coupon = await db.getCouponByCode(body.coupon_code)
      if (!coupon) {
        const err = new Error('유효하지 않은 쿠폰입니다.')
        err.status = 400
        throw err
      }
      if (coupon.user_id !== userId) {
        const err = new Error('본인 쿠폰만 사용 가능합니다.')
        err.status = 403
        throw err
      }
      if (coupon.status !== 'available') {
        const err = new Error('이미 사용했거나 만료된 쿠폰입니다.')
        err.status = 400
        throw err
      }
      if (db.isCouponExpired(coupon)) {
        const err = new Error('만료된 쿠폰입니다.')
        err.status = 400
        throw err
      }
      if (coupon.reason === CLIENT_COURSE_REWARD_REASON) {
        const err = new Error('의뢰 할인 쿠폰은 클라이언츠 견적 수락 시 사용할 수 있습니다.')
        err.status = 400
        throw err
      }
      if (coupon.first_course_only && !isFirstPurchase) {
        const err = new Error('이 쿠폰은 최초 강의 결제에만 사용할 수 있습니다.')
        err.status = 400
        throw err
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

  return {
    salePrice,
    discount,
    finalAmount: Math.max(0, salePrice - discount),
    appliedCoupons,
  }
}

/**
 * POST /api/orders/prepare
 * - 스마트스토어 강의: 거부 (스토어 플로우 사용)
 * - 유료(>0): 사이트 PG 없음 → 스마트스토어 안내
 * - 0원(쿠폰 전액): 즉시 수강 등록
 */
async function handlePrepare(req, res) {
  try {
    const { course_id, method } = req.body || {}
    const course = await db.getCourseById(course_id)
    if (!course) return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })
    if (db.usesSmartstoreCheckout(course)) {
      return res.status(400).json({
        error: '이 강의는 네이버 스마트스토어에서 결제합니다.',
        code: 'smartstore_checkout',
      })
    }
    if (await db.isEnrolled(req.user.id, course_id)) {
      return res.status(409).json({ error: '이미 수강 중인 강의입니다.' })
    }
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

    const pricing = await resolveCheckoutPricing(req.user.id, course, req.body)

    if (pricing.finalAmount > 0) {
      return res.status(400).json({
        error: '유료 강의는 네이버 스마트스토어에서 결제해 주세요. 결제 확인 후 수강이 등록됩니다.',
        code: 'smartstore_required',
        final_amount: pricing.finalAmount,
        discount: pricing.discount,
      })
    }

    const couponIds = pricing.appliedCoupons.map(a => a.coupon.id)
    const existingPending = await db.getPendingOrderForCourse(req.user.id, course_id)
    if (existingPending) {
      await db.failPendingOrder(existingPending.id, 'superseded')
    }

    const order = await db.createPendingOrder(
      req.user.id,
      course_id,
      0,
      method || '쿠폰전액',
      pricing.discount,
      {
        order_name: String(course.title || '타닥클래스 강의').slice(0, 100),
        coupon_ids: couponIds,
        provider: 'site',
      },
    )

    const held = await db.holdCouponsForOrder(couponIds, order.id)
    if (held.length) {
      await db.updateOrderFields(order.id, { coupon_holds: held })
    }

    const confirmed = await db.confirmPaidOrderAndEnroll(order.id, {
      method: '쿠폰전액',
      provider: 'site',
    })
    if (!confirmed.ok) {
      return res.status(confirmed.code === 'enrollment_full' ? 409 : 400).json(confirmed)
    }

    res.json({
      success: true,
      immediate: true,
      order_id: order.id,
      course_slug: course.slug,
      final_amount: 0,
      discount: pricing.discount,
      reward_coupon: confirmed.reward_coupon || null,
    })
  } catch (e) {
    console.error('orders prepare:', e)
    res.status(e.status || 500).json({ error: e.message || '수강 신청에 실패했습니다.' })
  }
}

router.post('/prepare', authMiddleware, handlePrepare)
router.post('/', authMiddleware, handlePrepare)

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

  try {
    const pricing = await resolveCheckoutPricing(req.user.id, course, {
      skip_coupon: req.query.coupon === '0',
      coupon_code: req.query.coupon_code,
    })
    res.json({
      sale_price: pricing.salePrice,
      discount: pricing.discount,
      final_amount: pricing.finalAmount,
      coupon_code: pricing.appliedCoupons[0]?.coupon?.code || null,
      is_stackable: pricing.appliedCoupons.length > 1,
      coupon_allowed: db.isCourseCouponAllowed(course),
      coupon_skipped: req.query.coupon === '0',
      smartstore_only: pricing.finalAmount > 0 && !db.usesSmartstoreCheckout(course),
    })
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message })
  }
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
