const router = require('express').Router()
const multer = require('multer')
const db = require('../db/schema')
const { getTotalMailCountFromConfig } = require('../db/schema')
const { adminMiddleware } = require('../middleware/auth')
const { sendLiveInviteMessage } = require('../utils/kakaoMessage')
const { uploadCourseImage } = require('../utils/storage')

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
})

router.use(adminMiddleware)

router.get('/ad-library/ping', (_req, res) => {
  res.json({ ok: true, feature: 'ad-library', status: 'draft' })
})

router.post('/uploads', upload.single('file'), async (req, res) => {
  try {
    const kind = String(req.body?.kind || '').trim()
    const courseId = String(req.body?.course_id || '').trim()
    if (!['detail-intro', 'thumbnail'].includes(kind)) {
      return res.status(400).json({ error: '유효하지 않은 업로드 종류입니다.' })
    }
    if (!req.file?.buffer?.length) {
      return res.status(400).json({ error: '파일을 선택해주세요.' })
    }
    const ct = String(req.file.mimetype || '').toLowerCase()
    if (kind === 'detail-intro') {
      if (ct !== 'image/webp') {
        return res.status(400).json({ error: '상세 소개 이미지는 WebP만 업로드할 수 있습니다.' })
      }
    } else if (!['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(ct)) {
      return res.status(400).json({ error: 'JPEG, PNG, WebP만 업로드할 수 있습니다.' })
    }
    if (kind === 'thumbnail' && req.file.size > 2 * 1024 * 1024) {
      return res.status(400).json({ error: '2MB 이하 이미지만 업로드할 수 있습니다.' })
    }
    const url = await uploadCourseImage(req.file.buffer, {
      kind,
      courseId: courseId || 'draft',
      contentType: ct === 'image/jpg' ? 'image/jpeg' : ct,
    })
    res.json({ success: true, url })
  } catch (e) {
    console.error('[admin/uploads]', e)
    res.status(500).json({ error: e.message || '업로드에 실패했습니다.' })
  }
})

router.get('/dashboard', async (req, res) => {
  const [stats, allOrders, courseStats, allReviews] = await Promise.all([
    db.getStats(),
    db.getAllOrders(),
    db.getCourseStats(),
    db.getAllReviews(),
  ])
  const orderSlice = allOrders.slice(0, 5)
  const reviewSlice = allReviews.slice(0, 5)
  const adminUserIds = await db.getAdminUserIdSet()
  const userIds = [...new Set([
    ...orderSlice.map(o => o.user_id),
    ...reviewSlice.map(r => r.user_id),
  ].filter(Boolean))]
  const courseIds = [...new Set([
    ...orderSlice.map(o => o.course_id),
    ...reviewSlice.map(r => r.course_id),
  ].filter(Boolean))]
  const [userMap, courseMap] = await Promise.all([
    db.batchGetUsers(userIds),
    db.batchGetCourses(courseIds),
  ])
  res.json({
    stats,
    orders: orderSlice.map(o => ({
      ...o,
      amount: db.orderRevenueAmount(o, adminUserIds),
      exclude_from_revenue: db.isOrderRevenueExcluded(o, adminUserIds),
      user_name: userMap[o.user_id]?.name,
      email: userMap[o.user_id]?.email,
      course_title: courseMap[o.course_id]?.title,
    })),
    courseStats,
    reviews: reviewSlice.map(r => ({
      ...r,
      user_name: userMap[r.user_id]?.name,
      course_title: courseMap[r.course_id]?.title,
    })),
  })
})

router.get('/stats', async (req, res) => {
  res.json(await db.getStats())
})

router.get('/coupons', async (req, res) => {
  res.json(await db.getAdminCouponReport())
})

router.get('/coupon-issuance', async (req, res) => {
  res.json(await db.getCouponIssuanceConfig())
})

router.patch('/coupon-issuance', async (req, res) => {
  const config = await db.updateCouponIssuanceConfig(req.body)
  res.json({ success: true, config })
})

router.get('/orders', async (req, res) => {
  const [orders, adminUserIds] = await Promise.all([
    db.getAllOrders(),
    db.getAdminUserIdSet(),
  ])
  const userIds = [...new Set(orders.map(o => o.user_id).filter(Boolean))]
  const courseIds = [...new Set(orders.map(o => o.course_id).filter(Boolean))]
  const [userMap, courseMap] = await Promise.all([
    db.batchGetUsers(userIds),
    db.batchGetCourses(courseIds),
  ])
  res.json(orders.map(o => ({
    ...o,
    amount: db.orderRevenueAmount(o, adminUserIds),
    exclude_from_revenue: db.isOrderRevenueExcluded(o, adminUserIds),
    user_name: userMap[o.user_id]?.name,
    email: userMap[o.user_id]?.email,
    course_title: courseMap[o.course_id]?.title,
  })))
})

router.get('/students', async (req, res) => {
  res.json(await db.getAllStudents())
})

router.get('/students/:id', async (req, res) => {
  try {
    const user = await db.findUserById(req.params.id)
    if (!user) return res.status(404).json({ error: '회원을 찾을 수 없습니다.' })
    const [orders, enrollments] = await Promise.all([
      db.getOrdersByUser(user.id),
      db.getEnrollmentsByUser(user.id),
    ])
    const courseIds = [...new Set([...orders.map(o => o.course_id), ...enrollments.map(e => e.course_id)].filter(Boolean))]
    const courseMap = await db.batchGetCourses(courseIds)
    const enrollmentsWithProgress = await Promise.all(enrollments.map(async e => {
      const progress = await db.getCourseProgressSummary(user.id, e.course_id)
      return {
        course_id: e.course_id,
        course_title: courseMap[e.course_id]?.title || '-',
        enrolled_at: e.enrolled_at || null,
        last_watched_at: e.last_watched_at || progress.last_watched_at || null,
        ...progress,
        certificate_issued_at: e.certificate_issued_at || null,
      }
    }))
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone || null,
      gender: user.gender || null,
      birth_year: user.birth_year || null,
      created_at: user.created_at || null,
      login_type: user.google_id ? 'google' : user.kakao_id ? 'kakao' : 'email',
      orders: orders.map(o => ({
        id: o.id,
        course_title: courseMap[o.course_id]?.title || '-',
        amount: o.amount,
        discount: o.discount || 0,
        refund_amount: o.refund_amount || 0,
        method: o.method,
        status: o.status,
        paid_at: o.paid_at,
        refunded_at: o.refunded_at || null,
        external_order_id: o.external_order_id || null,
      })),
      enrollments: enrollmentsWithProgress,
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.get('/reviews', async (req, res) => {
  const reviews = await db.getAllReviews()
  const userIds = [...new Set(reviews.map(r => r.user_id).filter(Boolean))]
  const courseIds = [...new Set(reviews.map(r => r.course_id).filter(Boolean))]
  const [userMap, courseMap] = await Promise.all([
    db.batchGetUsers(userIds),
    db.batchGetCourses(courseIds),
  ])
  res.json(reviews.map(r => ({
    ...r,
    user_name: userMap[r.user_id]?.name,
    course_title: courseMap[r.course_id]?.title,
  })))
})

router.patch('/reviews/:id', async (req, res) => {
  await db.updateReviewPublic(req.params.id, req.body.is_public)
  res.json({ success: true })
})

router.delete('/reviews/:id', async (req, res) => {
  try {
    await db.deleteReview(req.params.id, { bypassRewardLock: true })
    res.json({ success: true })
  } catch (e) {
    res.status(400).json({ error: e.message || '후기를 삭제하지 못했습니다.' })
  }
})

router.get('/smartstore-reviews', async (req, res) => {
  try {
    const status = String(req.query.status || 'pending')
    res.json(await db.listSmartstoreReviewClaims(status))
  } catch (e) {
    console.error('admin smartstore reviews list:', e)
    res.status(500).json({ error: '스마트스토어 후기 신고 목록을 불러오지 못했습니다.' })
  }
})

router.post('/smartstore-reviews/:userId/approve', async (req, res) => {
  try {
    const result = await db.approveSmartstoreReview(req.params.userId, req.user?.id || null)
    if (!result.ok) {
      return res.status(result.code === 'not_found' ? 404 : 400).json(result)
    }
    res.json(result)
  } catch (e) {
    console.error('admin smartstore reviews approve:', e)
    res.status(500).json({ error: '스마트스토어 후기 보상 지급에 실패했습니다.' })
  }
})

router.post('/smartstore-reviews/:userId/reject', async (req, res) => {
  try {
    const result = await db.rejectSmartstoreReview(
      req.params.userId,
      req.user?.id || null,
      req.body?.reason || '',
    )
    if (!result.ok) {
      return res.status(result.code === 'not_found' ? 404 : 400).json(result)
    }
    res.json(result)
  } catch (e) {
    console.error('admin smartstore reviews reject:', e)
    res.status(500).json({ error: '스마트스토어 후기 거절 처리에 실패했습니다.' })
  }
})

router.get('/subtitle-coin-wallets', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim()
    const limit = parseInt(req.query.limit, 10) || 80
    res.json(await db.listSubtitleCoinWalletsForAdmin({ q, limit }))
  } catch (e) {
    console.error('admin subtitle coin wallets:', e)
    res.status(500).json({ error: '타닥싱크 코인 지갑 목록을 불러오지 못했습니다.' })
  }
})

router.get('/subtitle-coin-wallets/:userId/ledger', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 40
    res.json(await db.listSubtitleCoinLedgerForAdmin(req.params.userId, limit))
  } catch (e) {
    console.error('admin subtitle coin ledger:', e)
    res.status(500).json({ error: '코인 내역을 불러오지 못했습니다.' })
  }
})

router.post('/subtitle-coin-wallets/:userId/adjust', async (req, res) => {
  try {
    const delta = parseInt(req.body?.delta, 10)
    const note = String(req.body?.note || '').trim()
    const result = await db.adjustSubtitleWalletByAdmin(
      req.params.userId,
      delta,
      req.user?.id || null,
      note,
    )
    if (!result.ok) {
      return res.status(result.code === 'not_found' ? 404 : 400).json(result)
    }
    res.json(result)
  } catch (e) {
    console.error('admin subtitle coin adjust:', e)
    res.status(500).json({ error: '코인 조정에 실패했습니다.' })
  }
})

router.patch('/users/:userId/subtitle-channel-admin', async (req, res) => {
  try {
    const enabled = req.body?.enabled
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled(boolean) 값이 필요합니다.' })
    }
    const result = await db.updateUserSubtitleChannelAdmin(req.params.userId, enabled)
    if (!result.ok) {
      return res.status(result.code === 'not_found' ? 404 : 400).json(result)
    }
    res.json(result)
  } catch (e) {
    console.error('admin subtitle channel admin:', e)
    res.status(500).json({ error: '채널 관리자 설정에 실패했습니다.' })
  }
})

router.get('/courses', async (req, res) => {
  const { TARGET_SLUGS } = require('../db/course-catalog')
  const courses = await db.getCourses(false)
  const enriched = await Promise.all(courses.map(async c => {
    const row = {
      ...(await db.enrichCourseEnrollment(c, { liveCount: true })),
      is_catalog: TARGET_SLUGS.has(c.slug),
    }
    if (Number(c.student_count || 0) !== Number(row.student_count || 0)) {
      await db.updateCourse(c.id, { student_count: row.student_count })
    }
    return row
  }))
  res.json(enriched)
})

router.get('/users/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim()
    if (!q) return res.json([])
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20))
    const users = await db.findUsersForAdminSearch(q, limit)
    res.json(users)
  } catch (e) {
    console.error('admin users search:', e)
    res.status(500).json({ error: '회원 검색에 실패했습니다.' })
  }
})

router.get('/courses/:id/enrollments', async (req, res) => {
  try {
    const course = await db.getCourseById(req.params.id)
    if (!course) return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })
    const [enrollmentsRaw, pending] = await Promise.all([
      db.getActiveEnrolleesByCourse(course.id),
      db.listPendingEnrollments(course.id),
    ])
    const enrollments = await db.attachProgressToEnrollees(course.id, enrollmentsRaw)
    await db.syncCourseStudentCount(course.id)
    res.json({
      course: { id: course.id, title: course.title, sale_price: course.sale_price, course_type: course.course_type },
      count: enrollments.length,
      enrollments,
      pending,
      pending_count: pending.length,
    })
  } catch (e) {
    console.error('admin course enrollments:', e)
    res.status(500).json({ error: '수강생 목록을 불러오지 못했습니다.' })
  }
})

router.get('/courses/:id/progress-export', async (req, res) => {
  try {
    const course = await db.getCourseById(req.params.id)
    if (!course) return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })
    const enrollmentsRaw = await db.getActiveEnrolleesByCourse(course.id)
    const enrollments = await db.attachProgressToEnrollees(course.id, enrollmentsRaw)
    const escCsv = (v) => {
      const s = String(v ?? '')
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
      return s
    }
    const header = ['이름', '이메일', '연락처', '진도%', '완료챕터', '전체챕터', '시청초', '최종수강일', '신청일']
    const lines = [header.join(',')]
    for (const row of enrollments) {
      lines.push([
        escCsv(row.name),
        escCsv(row.email),
        escCsv(row.phone || ''),
        escCsv(row.progress_pct ?? 0),
        escCsv(row.completed_chapters ?? 0),
        escCsv(row.total_chapters ?? 0),
        escCsv(row.watched_sec ?? 0),
        escCsv(row.last_watched_at || ''),
        escCsv(row.enrolled_at || row.paid_at || ''),
      ].join(','))
    }
    const filename = `progress-${(course.slug || course.id)}.csv`
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.send('\uFEFF' + lines.join('\n'))
  } catch (e) {
    console.error('admin progress export:', e)
    res.status(500).json({ error: '진도 CSV를 만들지 못했습니다.' })
  }
})

router.post('/courses/:id/enrollments', async (req, res) => {
  try {
    const course = await db.getCourseById(req.params.id)
    if (!course) return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })
    const body = req.body || {}
    if (!body.user_id && !body.email && !body.phone) {
      return res.status(400).json({ error: '회원 선택 또는 이메일/휴대폰이 필요합니다.' })
    }
    const result = await db.adminRegisterEnrollment(course.id, {
      user_id: body.user_id,
      email: body.email,
      phone: body.phone,
      name: body.name,
      amount: body.amount,
      method: body.method,
      discount: body.discount,
      note: body.note,
      paid_at: body.paid_at,
      external_order_id: body.external_order_id,
      source: 'manual',
    }, req.user.id)
    if (!result.ok) {
      const status = result.code === 'enrollment_full' ? 409
        : result.code === 'contact_required' || result.code === 'course_not_found' ? 400
        : 400
      return res.status(status).json(result)
    }
    res.json(result)
  } catch (e) {
    console.error('admin enroll:', e)
    res.status(500).json({ error: '수강 등록에 실패했습니다.' })
  }
})

function mapCsvHeader(header) {
  const h = String(header || '').trim().toLowerCase().replace(/\s+/g, '')
  if (['email', '이메일', '구매자이메일', '주문자이메일', '메일', 'e-mail'].includes(h) || h.includes('email') || h.includes('이메일') || h.includes('메일')) {
    if (h.includes('전화') || h.includes('phone')) return 'phone'
    return 'email'
  }
  if (['phone', '휴대폰', '연락처', '전화번호', '핸드폰', '휴대폰번호', '휴대전화'].includes(h)
    || h.includes('phone') || h.includes('휴대폰') || h.includes('연락처') || h.includes('전화')) {
    return 'phone'
  }
  if (['name', '이름', '구매자명', '주문자명', '구매자'].includes(h) || h.includes('이름') || h === 'name' || h.includes('구매자')) {
    if (h.includes('email') || h.includes('메일') || h.includes('전화') || h.includes('phone')) return null
    return 'name'
  }
  if (['amount', '금액', '결제금액', '판매가'].includes(h) || h.includes('금액')) return 'amount'
  if (['external_order_id', '주문번호', '상품주문번호', '스토어주문번호', 'orderid', 'order_id'].includes(h)
    || (h.includes('주문번호') && !h.includes('메모'))) return 'external_order_id'
  if (['note', '메모', '비고'].includes(h) || h.includes('메모') || h.includes('비고')) return 'note'
  return null
}

function parseCsvText(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '')
  const lines = raw.split(/\r?\n/).filter(line => line.trim())
  if (!lines.length) return { error: 'CSV 내용이 비어 있습니다.' }

  function splitLine(line) {
    const cells = []
    let cur = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; continue }
        inQuotes = !inQuotes
        continue
      }
      if ((ch === ',' || ch === '\t') && !inQuotes) {
        cells.push(cur.trim())
        cur = ''
        continue
      }
      cur += ch
    }
    cells.push(cur.trim())
    return cells
  }

  const headerCells = splitLine(lines[0])
  const map = headerCells.map(mapCsvHeader)
  const hasMapped = map.some(Boolean)
  const rows = []

  if (hasMapped) {
    for (let i = 1; i < lines.length; i++) {
      const cells = splitLine(lines[i])
      if (!cells.some(c => c)) continue
      const row = { line: i + 1 }
      map.forEach((key, idx) => {
        if (key) row[key] = cells[idx] || ''
      })
      rows.push(row)
    }
  } else {
    // 헤더 없이 email,phone,name 순으로 가정
    for (let i = 0; i < lines.length; i++) {
      const cells = splitLine(lines[i])
      if (!cells.some(c => c)) continue
      // 첫 줄이 헤더처럼 보이면 스킵
      if (i === 0 && /email|이메일|이름|name/i.test(cells.join(','))) continue
      rows.push({
        line: i + 1,
        email: cells[0] || '',
        phone: cells[1] || '',
        name: cells[2] || '',
        amount: cells[3] || '',
        note: cells[4] || '',
      })
    }
  }
  return { rows }
}

router.post('/courses/:id/enrollments/import', async (req, res) => {
  try {
    const course = await db.getCourseById(req.params.id)
    if (!course) return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })

    let rows = Array.isArray(req.body?.rows) ? req.body.rows : null
    if (!rows) {
      const csvText = req.body?.csv || req.body?.text || ''
      const parsed = parseCsvText(csvText)
      if (parsed.error) return res.status(400).json({ error: parsed.error })
      rows = parsed.rows
    }
    if (!rows.length) return res.status(400).json({ error: '등록할 행이 없습니다.' })

    const results = { enrolled: 0, pending: 0, already: 0, failed: 0, details: [] }
    for (const row of rows) {
      const email = row.email || row.이메일 || ''
      const phone = row.phone || row.휴대폰 || row.연락처 || ''
      const name = row.name || row.이름 || ''
      const amount = row.amount !== '' && row.amount != null ? Number(String(row.amount).replace(/[^\d.]/g, '')) : undefined
      const note = row.note || row.메모 || ''
      const line = row.line || null

      if (!email && !phone) {
        results.failed++
        results.details.push({ line, email, phone, name, status: 'failed', error: '이메일·휴대폰이 모두 없습니다.' })
        continue
      }

      const result = await db.adminRegisterEnrollment(course.id, {
        email,
        phone,
        name,
        amount: Number.isFinite(amount) ? amount : undefined,
        note: note || undefined,
        external_order_id: row.external_order_id || row.주문번호 || undefined,
        method: req.body?.method || '스마트스토어',
        source: 'csv',
      }, req.user.id)

      if (!result.ok) {
        results.failed++
        results.details.push({
          line, email, phone, name,
          status: 'failed',
          error: result.error || '등록 실패',
          code: result.code,
        })
        continue
      }
      if (result.status === 'pending') {
        if (result.already) results.already++
        else results.pending++
        results.details.push({
          line, email, phone, name,
          status: 'pending',
          already: !!result.already,
          pending_id: result.pending?.id,
        })
      } else {
        if (result.already) results.already++
        else results.enrolled++
        results.details.push({
          line, email, phone, name,
          status: 'enrolled',
          already: !!result.already,
          user_id: result.user_id,
          matched_by: result.matched_by,
        })
      }
    }

    res.json({
      ok: true,
      course_id: course.id,
      ...results,
    })
  } catch (e) {
    console.error('admin enroll import:', e)
    res.status(500).json({ error: 'CSV 가져오기에 실패했습니다.' })
  }
})

router.delete('/courses/:id/pending-enrollments/:pendingId', async (req, res) => {
  try {
    const course = await db.getCourseById(req.params.id)
    if (!course) return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })
    const pending = await db.getPendingEnrollment(req.params.pendingId)
    if (!pending) return res.status(404).json({ error: '대기 등록을 찾을 수 없습니다.' })
    if (pending.course_id !== course.id) {
      return res.status(400).json({ error: '해당 강의의 대기 등록이 아닙니다.' })
    }
    const result = await db.cancelPendingEnrollment(req.params.pendingId)
    if (!result.ok) return res.status(400).json(result)
    res.json({ success: true })
  } catch (e) {
    console.error('admin cancel pending:', e)
    res.status(500).json({ error: '대기 등록 취소에 실패했습니다.' })
  }
})

router.get('/courses/:id/chapters', async (req, res) => {
  const course = await db.getCourseById(req.params.id)
  if (!course) return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })
  const chapters = await db.getChaptersByCourse(course.id)
  res.json({
    course: {
      id: course.id,
      title: course.title,
      slug: course.slug,
      course_type: course.course_type,
      live_curriculum_text: course.live_curriculum_text || null,
      live_curriculum_image: course.live_curriculum_image || null,
      detail_intro_text: course.detail_intro_text || null,
      detail_intro_images: normalizeDetailIntroImages(course),
      detail_intro_image: course.detail_intro_image || null,
    },
    chapters,
  })
})

router.post('/courses/:id/chapters', async (req, res) => {
  const course = await db.getCourseById(req.params.id)
  if (!course) return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })
  const result = await db.createChapter(course.id, req.body)
  if (result.error === 'title_required') {
    return res.status(400).json({ error: '챕터 제목을 입력해주세요.' })
  }
  res.json({ success: true, chapter: result })
})

router.patch('/chapters/:id', async (req, res) => {
  const result = await db.updateChapter(req.params.id, req.body)
  if (result?.error === 'not_found') return res.status(404).json({ error: '챕터를 찾을 수 없습니다.' })
  if (result?.error === 'title_required') return res.status(400).json({ error: '챕터 제목을 입력해주세요.' })
  res.json({ success: true, chapter: result })
})

router.delete('/chapters/:id', async (req, res) => {
  const result = await db.deleteChapter(req.params.id)
  if (result?.error === 'not_found') return res.status(404).json({ error: '챕터를 찾을 수 없습니다.' })
  res.json({ success: true })
})

router.post('/chapters/:id/move', async (req, res) => {
  const direction = req.body?.direction === 'up' ? 'up' : 'down'
  const result = await db.moveChapter(req.params.id, direction)
  if (result?.error === 'not_found') return res.status(404).json({ error: '챕터를 찾을 수 없습니다.' })
  if (result?.error === 'cannot_move') return res.status(400).json({ error: '더 이상 이동할 수 없습니다.' })
  res.json({ success: true, chapters: result })
})

router.post('/courses/sync-catalog', async (req, res) => {
  const result = await db.syncCoursesFromCatalog()
  res.json({ success: true, ...result })
})

router.post('/courses/delete-legacy', async (req, res) => {
  const includeLive = !!req.body?.include_live
  const result = await db.deleteLegacyCourses({ includeLive })
  res.json({ success: true, ...result })
})

router.patch('/courses/:id', async (req, res) => {
  const allowed = [
    'title', 'description', 'category', 'price', 'sale_price', 'is_published',
    'course_type', 'delivery_mode', 'live_schedule', 'live_starts_at', 'live_ends_at', 'meet_code', 'live_status',
    'live_curriculum_text', 'live_curriculum_image', 'detail_intro_text', 'detail_intro_image', 'detail_intro_images', 'live_chat_url',
    'live_replay_url', 'live_material_url', 'program_id',
    'badge', 'thumbnail_icon', 'thumb_style', 'thumbnail_url', 'hero_gallery', 'sort_order', 'is_offline', 'enrollment_limit', 'coupon_allowed',
    'checkout_provider', 'store_checkout_urls', 'checkout_starts_at', 'checkout_ends_at',
    'learning_outcomes', 'target_audience', 'instructor_name', 'instructor_role', 'instructor_bio', 'instructor_avatar',
  ]
  const update = {}
  for (const key of allowed) {
    if (req.body[key] !== undefined) update[key] = req.body[key]
  }
  if (update.thumbnail_url !== undefined && update.thumbnail_url !== null && update.thumbnail_url !== '' && !isValidImage(update.thumbnail_url)) {
    return res.status(400).json({ error: '썸네일은 URL 또는 JPG/PNG/WebP(base64)만 사용할 수 있습니다.' })
  }
  if (update.hero_gallery !== undefined) {
    if (update.hero_gallery === null || update.hero_gallery === '') {
      update.hero_gallery = null
    } else if (!Array.isArray(update.hero_gallery)) {
      return res.status(400).json({ error: '히어로 갤러리는 배열 형식이어야 합니다.' })
    } else {
      const cleaned = []
      for (const item of update.hero_gallery.slice(0, 9)) {
        const url = String(item || '').trim()
        if (!url) continue
        if (!isValidImage(url)) {
          return res.status(400).json({ error: '히어로 갤러리 이미지는 URL 또는 JPG/PNG/WebP(base64)만 사용할 수 있습니다.' })
        }
        cleaned.push(url)
      }
      update.hero_gallery = cleaned.length ? cleaned : null
    }
  }
  for (const key of ['live_chat_url', 'live_replay_url', 'live_material_url']) {
    if (update[key] === undefined) continue
    if (update[key] === null || update[key] === '') {
      update[key] = null
      continue
    }
    const url = String(update[key]).trim()
    if (!/^https?:\/\/.+/i.test(url)) {
      const label = key === 'live_chat_url' ? '단톡방' : key === 'live_replay_url' ? '다시보기' : '자료 다운로드'
      return res.status(400).json({ error: `${label} 링크는 http:// 또는 https:// 로 시작해야 합니다.` })
    }
    update[key] = url.slice(0, 500)
  }
  if (update.detail_intro_images !== undefined) {
    if (update.detail_intro_images === null || update.detail_intro_images === '') {
      update.detail_intro_images = null
      update.detail_intro_image = null
    } else if (!Array.isArray(update.detail_intro_images)) {
      return res.status(400).json({ error: '상세 소개 이미지는 배열 형식이어야 합니다.' })
    } else {
      const cleaned = []
      for (const item of update.detail_intro_images.slice(0, 10)) {
        const url = String(item || '').trim()
        if (!url) continue
        if (url.startsWith('data:') && url.length > MAX_DETAIL_INTRO_IMAGE_LEN) {
          return res.status(400).json({ error: '상세 소개 이미지 용량이 너무 큽니다. WebP 파일을 줄여서 다시 업로드해주세요.' })
        }
        if (!isValidWebpImage(url)) {
          return res.status(400).json({ error: '상세 소개 이미지는 WebP(URL 또는 base64)만 사용할 수 있습니다.' })
        }
        cleaned.push(url)
      }
      update.detail_intro_images = cleaned.length ? cleaned : null
      update.detail_intro_image = null
    }
  }
  if (update.detail_intro_image !== undefined && update.detail_intro_image !== null && update.detail_intro_image !== '') {
    if (typeof update.detail_intro_image === 'string' && update.detail_intro_image.length > MAX_DETAIL_INTRO_IMAGE_LEN) {
      return res.status(400).json({ error: '상세 소개 이미지 용량이 너무 큽니다. 더 작은 이미지를 업로드해주세요.' })
    }
    if (!isValidWebpImage(update.detail_intro_image)) {
      return res.status(400).json({ error: '상세 소개 이미지는 WebP(URL 또는 base64)만 사용할 수 있습니다.' })
    }
  }
  if (update.detail_intro_text !== undefined) {
    update.detail_intro_text = String(update.detail_intro_text || '').trim() || null
  }
  for (const key of ['learning_outcomes', 'target_audience']) {
    if (update[key] === undefined) continue
    if (!Array.isArray(update[key])) {
      update[key] = null
    } else {
      const cleaned = update[key].map(s => String(s || '').trim()).filter(Boolean).slice(0, 10)
      update[key] = cleaned.length ? cleaned : null
    }
  }
  for (const key of ['instructor_name', 'instructor_role', 'instructor_bio']) {
    if (update[key] !== undefined) update[key] = String(update[key] || '').trim() || null
  }
  if (update.instructor_avatar !== undefined) {
    if (!update.instructor_avatar || update.instructor_avatar === '') update.instructor_avatar = null
    else if (!isValidImage(update.instructor_avatar)) return res.status(400).json({ error: '강사 사진은 URL 또는 JPG/PNG/WebP(base64)만 사용할 수 있습니다.' })
  }
  if (update.detail_intro_image !== undefined && (update.detail_intro_image === null || update.detail_intro_image === '')) {
    update.detail_intro_image = null
  }
  if (Object.keys(update).length === 0) return res.status(400).json({ error: '변경할 항목이 없습니다.' })
  if (update.enrollment_limit !== undefined) {
    update.enrollment_limit = Math.max(0, parseInt(update.enrollment_limit, 10) || 0)
  }
  if (update.coupon_allowed !== undefined) {
    update.coupon_allowed = update.coupon_allowed === true || update.coupon_allowed === 1 || update.coupon_allowed === '1' ? 1 : 0
  }
  if (update.checkout_provider !== undefined) {
    update.checkout_provider = update.checkout_provider === 'smartstore' ? 'smartstore' : 'site'
  }
  if (update.store_checkout_urls !== undefined) {
    const urls = db.normalizeStoreCheckoutUrls(update.store_checkout_urls)
    for (const key of ['none', 'discount_10', 'discount_20']) {
      const url = urls[key]
      if (url && !/^https?:\/\/.+/i.test(url)) {
        const label = key === 'none' ? '정가' : key === 'discount_10' ? '10% 할인' : '20% 할인'
        return res.status(400).json({ error: `${label} 스마트스토어 링크는 http:// 또는 https:// 로 시작해야 합니다.` })
      }
    }
    update.store_checkout_urls = urls
    if (update.checkout_provider === 'smartstore' && !urls.none) {
      return res.status(400).json({ error: '스마트스토어 결제 시 정가(쿠폰 없음) 링크는 필수입니다.' })
    }
  }
  if (update.checkout_provider === 'smartstore') {
    const urls = update.store_checkout_urls || db.normalizeStoreCheckoutUrls((await db.getCourseById(req.params.id))?.store_checkout_urls)
    if (!urls?.none) {
      return res.status(400).json({ error: '스마트스토어 결제 시 정가(쿠폰 없음) 링크는 필수입니다.' })
    }
  }
  if (update.checkout_starts_at !== undefined || update.checkout_ends_at !== undefined) {
    const normalized = db.normalizeCheckoutWindowInput(
      update.checkout_starts_at === '' ? null : update.checkout_starts_at,
      update.checkout_ends_at === '' ? null : update.checkout_ends_at,
    )
    if (normalized.error === 'invalid_starts') {
      return res.status(400).json({ error: '결제 시작일 형식이 올바르지 않습니다.' })
    }
    if (normalized.error === 'invalid_ends') {
      return res.status(400).json({ error: '결제 마감일 형식이 올바르지 않습니다.' })
    }
    if (normalized.error === 'invalid_range') {
      return res.status(400).json({ error: '결제 마감일은 시작일보다 뒤여야 합니다.' })
    }
    update.checkout_starts_at = normalized.checkout_starts_at
    update.checkout_ends_at = normalized.checkout_ends_at
  }
  if (update.live_starts_at !== undefined || update.live_ends_at !== undefined) {
    const liveWindow = db.normalizeLiveWindowInput(
      update.live_starts_at === '' ? null : update.live_starts_at,
      update.live_ends_at === '' ? null : update.live_ends_at,
    )
    if (liveWindow.error === 'invalid_live_starts') {
      return res.status(400).json({ error: '강의 시작일 형식이 올바르지 않습니다.' })
    }
    if (liveWindow.error === 'invalid_live_ends') {
      return res.status(400).json({ error: '강의 종료일 형식이 올바르지 않습니다.' })
    }
    if (liveWindow.error === 'invalid_live_range') {
      return res.status(400).json({ error: '강의 종료일은 시작일보다 뒤여야 합니다.' })
    }
    if (update.live_starts_at !== undefined) update.live_starts_at = liveWindow.live_starts_at
    if (update.live_ends_at !== undefined) update.live_ends_at = liveWindow.live_ends_at
  }
  if (update.program_id === '') update.program_id = null
  if (update.delivery_mode && !['live_first', 'vod_only'].includes(update.delivery_mode)) {
    return res.status(400).json({ error: 'delivery_mode가 올바르지 않습니다.' })
  }
  update.updated_at = new Date().toISOString()
  await db.updateCourse(req.params.id, update)
  const course = await db.enrichCourseEnrollment(await db.getCourseById(req.params.id), { liveCount: true })
  res.json({ success: true, course })
})

router.post('/courses', async (req, res) => {
  const {
    title, description, category, price, sale_price, thumbnail_icon, thumb_style,
    badge, sort_order, is_published, checkout_provider, store_checkout_urls, coupon_allowed,
    checkout_starts_at, checkout_ends_at,
    live_starts_at, live_ends_at, live_schedule, meet_code,
    live_replay_url, live_material_url, live_chat_url, program_id, course_type,
    delivery_mode,
  } = req.body
  if (!title || !String(title).trim()) return res.status(400).json({ error: '제목을 입력하세요.' })
  if (!category || !String(category).trim()) return res.status(400).json({ error: '카테고리를 입력하세요.' })
  const sale = Number(sale_price != null ? sale_price : price) || 0
  const published = is_published === true || is_published === 1 || is_published === '1'
  const mode = delivery_mode === 'vod_only' ? 'vod_only' : 'live_first'
  const provider = checkout_provider === 'site'
    ? 'site'
    : (checkout_provider === 'smartstore' || (!checkout_provider && sale > 0) ? 'smartstore' : 'site')
  if (provider === 'smartstore') {
    const urls = db.normalizeStoreCheckoutUrls(store_checkout_urls || {})
    if (!urls.none && published) {
      return res.status(400).json({ error: '스마트스토어 결제 시 정가(쿠폰 없음) 링크는 필수입니다.' })
    }
    for (const [key, url] of Object.entries(urls)) {
      if (url && !/^https?:\/\/.+/i.test(url)) {
        const label = key === 'none' ? '정가' : key === 'discount_10' ? '10% 할인' : '20% 할인'
        return res.status(400).json({ error: `${label} 스마트스토어 링크는 http:// 또는 https:// 로 시작해야 합니다.` })
      }
    }
  }
  if (mode === 'live_first' && !live_starts_at) {
    return res.status(400).json({ error: '라이브 강의 시작 일시를 입력하세요.' })
  }
  try {
    const course = await db.createRecordedCourse({
      title: String(title).trim(),
      description,
      category: String(category).trim(),
      price,
      sale_price,
      thumbnail_icon,
      thumb_style,
      badge,
      sort_order,
      is_published: published,
      checkout_provider: provider,
      store_checkout_urls,
      coupon_allowed,
      checkout_starts_at,
      checkout_ends_at,
      live_starts_at: mode === 'live_first' ? live_starts_at : null,
      live_ends_at: mode === 'live_first' ? live_ends_at : null,
      live_schedule: mode === 'live_first' ? live_schedule : null,
      meet_code: mode === 'live_first' ? meet_code : null,
      live_replay_url: mode === 'live_first' ? live_replay_url : null,
      live_material_url: mode === 'live_first' ? live_material_url : null,
      live_chat_url: mode === 'live_first' ? live_chat_url : null,
      program_id,
      delivery_mode: mode,
      course_type: mode === 'vod_only'
        ? 'recorded'
        : (course_type === 'live' || sale === 0 ? 'live' : 'recorded'),
    })
    if (course?.error === 'invalid_starts') {
      return res.status(400).json({ error: '결제 시작일 형식이 올바르지 않습니다.' })
    }
    if (course?.error === 'invalid_ends') {
      return res.status(400).json({ error: '결제 마감일 형식이 올바르지 않습니다.' })
    }
    if (course?.error === 'invalid_range') {
      return res.status(400).json({ error: '결제 마감일은 시작일보다 뒤여야 합니다.' })
    }
    if (course?.error === 'live_starts_required') {
      return res.status(400).json({ error: '라이브 강의 시작 일시를 입력하세요.' })
    }
    if (course?.error === 'invalid_live_starts') {
      return res.status(400).json({ error: '강의 시작일 형식이 올바르지 않습니다.' })
    }
    if (course?.error === 'invalid_live_ends') {
      return res.status(400).json({ error: '강의 종료일 형식이 올바르지 않습니다.' })
    }
    if (course?.error === 'invalid_live_range') {
      return res.status(400).json({ error: '강의 종료일은 시작일보다 뒤여야 합니다.' })
    }
    res.json({ success: true, course })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/live-courses', async (req, res) => {
  const { title, description, category, thumbnail_icon, live_schedule, live_starts_at, meet_code } = req.body
  if (!title || !category) return res.status(400).json({ error: '제목과 카테고리는 필수입니다.' })
  const course = await db.createLiveCourse({ title, description, category, thumbnail_icon, live_schedule, live_starts_at, meet_code })
  res.json({ success: true, course })
})

router.post('/courses/:id/send-live-invite', async (req, res) => {
  const course = await db.getCourseById(req.params.id)
  if (!course) return res.status(404).json({ error: '강의를 찾을 수 없습니다.' })
  if (course.course_type !== 'live' && !db.courseSupportsLiveReplay(course)) {
    return res.status(400).json({ error: '라이브 강의가 아닙니다.' })
  }
  if (!course.meet_code) return res.status(400).json({ error: 'Google Meet 코드를 먼저 입력해주세요.' })
  if (!course.live_schedule) return res.status(400).json({ error: '라이브 일정을 먼저 입력해주세요.' })

  const enrollments = await db.getEnrollmentsByCourse(course.id)
  const results = { sent: 0, skipped: 0, failed: 0, skipped_users: [] }

  for (const e of enrollments) {
    const user = await db.findUserById(e.user_id)
    if (!user) continue
    if (!user.phone) {
      results.skipped++
      results.skipped_users.push(user.name)
      continue
    }
    try {
      await sendLiveInviteMessage(user.phone, user.name, course.title, course.live_schedule, course.meet_code)
      results.sent++
    } catch (err) {
      results.failed++
    }
  }

  res.json({ success: true, ...results })
})

router.get('/course-stats', async (req, res) => {
  res.json(await db.getCourseStats())
})

// ── 편집자 신청 관리 ──
router.get('/editor-applications', async (req, res) => {
  const { status } = req.query
  const apps = await db.getAllEditorApplications(status || null)
  const userIds = [...new Set(apps.map(a => a.user_id).filter(Boolean))]
  const userMap = await db.batchGetUsers(userIds)
  res.json(apps.map(a => ({ ...a, user_name: userMap[a.user_id]?.name, email: userMap[a.user_id]?.email })))
})

router.patch('/editor-applications/:id', async (req, res) => {
  const { status, reject_reason } = req.body
  if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: '유효하지 않은 상태입니다.' })
  const result = await db.reviewEditorApplication(req.params.id, status, reject_reason)
  if (!result) return res.status(404).json({ error: '신청을 찾을 수 없습니다.' })
  res.json({ success: true })
})

const MAX_IMAGE_LEN = 480000
const MAX_DETAIL_INTRO_IMAGE_LEN = 950000

function normalizeDetailIntroImages(course) {
  if (!course) return []
  if (Array.isArray(course.detail_intro_images) && course.detail_intro_images.length) {
    return course.detail_intro_images.filter(Boolean).slice(0, 10)
  }
  if (course.detail_intro_image) return [course.detail_intro_image]
  return []
}

function isStorageImageUrl(value) {
  return typeof value === 'string'
    && /^https:\/\/(storage\.googleapis\.com|firebasestorage\.googleapis\.com)\/.+/i.test(value)
}

function isValidWebpImage(value) {
  if (!value) return true
  if (typeof value !== 'string') return false
  if (/^data:image\/webp;base64,/.test(value)) {
    return value.length <= MAX_DETAIL_INTRO_IMAGE_LEN
  }
  if (isStorageImageUrl(value)) return true
  if (/^https?:\/\/.+/i.test(value)) return /\.webp(\?|#|$)/i.test(value)
  return false
}

function isValidImage(value) {
  if (!value) return true
  if (typeof value !== 'string') return false
  if (isStorageImageUrl(value)) return true
  if (/^data:image\//.test(value)) return value.length <= MAX_IMAGE_LEN
  if (/^https?:\/\/.+/i.test(value)) return true
  return false
}

router.get('/site-settings/editor-apply', async (req, res) => {
  res.json(await db.getSiteSettings('editor_apply'))
})

router.patch('/site-settings/editor-apply', async (req, res) => {
  const { pending_review_image } = req.body
  if (pending_review_image !== null && pending_review_image !== undefined && pending_review_image !== '') {
    if (!isValidImage(pending_review_image)) {
      return res.status(400).json({ error: '이미지 URL 또는 JPG/PNG/WebP(base64)만 사용할 수 있습니다.' })
    }
  }
  const settings = await db.updateSiteSettings('editor_apply', {
    pending_review_image: pending_review_image || null,
  })
  res.json({ success: true, ...settings })
})

router.get('/homepage-layout', async (req, res) => {
  res.json(await db.getHomepageLayout())
})

router.patch('/homepage-layout', async (req, res) => {
  const { sections, nav, copy, categories, site } = req.body
  if (sections !== undefined && (typeof sections !== 'object' || Array.isArray(sections))) {
    return res.status(400).json({ error: 'sections 형식이 올바르지 않습니다.' })
  }
  if (nav !== undefined && (typeof nav !== 'object' || Array.isArray(nav))) {
    return res.status(400).json({ error: 'nav 형식이 올바르지 않습니다.' })
  }
  if (copy !== undefined && (typeof copy !== 'object' || Array.isArray(copy))) {
    return res.status(400).json({ error: 'copy 형식이 올바르지 않습니다.' })
  }
  if (categories !== undefined) {
    if (!Array.isArray(categories)) return res.status(400).json({ error: 'categories는 배열이어야 합니다.' })
    for (const cat of categories) {
      if (cat?.image && !isValidImage(cat.image)) {
        return res.status(400).json({ error: '카테고리 이미지는 URL 또는 JPG/PNG/WebP(base64)만 사용할 수 있습니다.' })
      }
    }
  }
  if (site !== undefined && (typeof site !== 'object' || Array.isArray(site))) {
    return res.status(400).json({ error: 'site 형식이 올바르지 않습니다.' })
  }
  const layout = await db.updateHomepageLayout({ sections, nav, copy, categories, site })
  res.json({ success: true, ...layout })
})

router.get('/platform-reviews', async (req, res) => {
  res.json(await db.getAllPlatformReviews())
})

router.post('/platform-reviews', async (req, res) => {
  try {
    const review = await db.createPlatformReview(req.body)
    res.json({ success: true, review })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

router.patch('/platform-reviews/:id', async (req, res) => {
  try {
    const review = await db.updatePlatformReview(req.params.id, req.body)
    if (!review) return res.status(404).json({ error: '후기를 찾을 수 없습니다.' })
    res.json({ success: true, review })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

router.delete('/platform-reviews/:id', async (req, res) => {
  await db.deletePlatformReview(req.params.id)
  res.json({ success: true })
})

router.get('/footer', async (req, res) => {
  res.json(await db.getFooterConfig())
})

router.patch('/footer', async (req, res) => {
  const footer = await db.updateFooterConfig(req.body)
  res.json({ success: true, ...footer })
})

function isValidExternalUrl(value) {
  if (!value) return true
  if (typeof value !== 'string') return false
  try {
    const u = new URL(value.trim())
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

router.get('/test-room', async (req, res) => {
  res.json(await db.getTestRoomConfig())
})

router.patch('/test-room', async (req, res) => {
  const { enabled, label, hint, room_url, room_label, instagram_url, instagram_label, kakao_url, kakao_label, tadaksync_url, tadaksync_label } = req.body
  if (instagram_url && !isValidExternalUrl(instagram_url)) {
    return res.status(400).json({ error: '인스타그램 URL 형식이 올바르지 않습니다.' })
  }
  if (kakao_url && !isValidExternalUrl(kakao_url)) {
    return res.status(400).json({ error: '카카오 오픈채팅 URL 형식이 올바르지 않습니다.' })
  }
  const settings = await db.updateTestRoomConfig({
    enabled,
    label,
    hint,
    room_url: room_url || '',
    room_label,
    instagram_url: instagram_url || '',
    instagram_label,
    kakao_url: kakao_url || '',
    kakao_label,
    tadaksync_url: tadaksync_url || '/subtitle-tool.html',
    tadaksync_label,
  })
  res.json({ success: true, ...settings })
})

router.get('/hero', async (req, res) => {
  res.json(await db.getHeroConfig())
})

router.patch('/hero', async (req, res) => {
  const { image } = req.body
  if (image !== null && image !== undefined && image !== '' && !isValidImage(image)) {
    return res.status(400).json({ error: '히어로 이미지는 URL 또는 JPG/PNG/WebP(base64)만 사용할 수 있습니다.' })
  }
  const hero = await db.updateHeroConfig(req.body)
  res.json({ success: true, ...hero })
})

router.get('/instructors-intro', async (req, res) => {
  res.json(await db.getInstructorsIntro())
})

router.patch('/instructors-intro', async (req, res) => {
  try {
    const intro = await db.updateInstructorsIntro(req.body)
    res.json({ success: true, ...intro })
  } catch (e) {
    res.status(400).json({ error: e.message || '저장에 실패했습니다.' })
  }
})

router.get('/instructor-portfolio-quote', async (req, res) => {
  res.json(await db.getInstructorPortfolioQuote())
})

router.patch('/instructor-portfolio-quote', async (req, res) => {
  try {
    const quote = await db.updateInstructorPortfolioQuote(req.body)
    res.json({ success: true, ...quote })
  } catch (e) {
    res.status(400).json({ error: e.message || '저장에 실패했습니다.' })
  }
})

router.get('/instructor-portfolio-works', async (req, res) => {
  res.json(await db.getInstructorPortfolioWorks())
})

router.patch('/instructor-portfolio-works', async (req, res) => {
  try {
    const works = await db.updateInstructorPortfolioWorks(req.body)
    res.json({ success: true, ...works })
  } catch (e) {
    res.status(400).json({ error: e.message || '저장에 실패했습니다.' })
  }
})

router.post('/instructor-portfolio-works/refresh-youtube-stats', async (req, res) => {
  try {
    const works = await db.refreshInstructorPortfolioYoutubeStats()
    res.json({ success: true, ...works })
  } catch (e) {
    res.status(400).json({ error: e.message || '조회수 갱신에 실패했습니다.' })
  }
})

router.post('/instructor-portfolio-works/refresh-youtube-visuals', async (req, res) => {
  try {
    const works = await db.refreshInstructorPortfolioVisuals({ youtube: true })
    res.json({ success: true, ...works })
  } catch (e) {
    res.status(400).json({ error: e.message || '유튜브 배너 갱신에 실패했습니다.' })
  }
})

router.post('/instructor-portfolio-works/refresh-instagram-avatars', async (req, res) => {
  try {
    const works = await db.refreshInstructorPortfolioVisuals({ instagram: true })
    res.json({ success: true, ...works })
  } catch (e) {
    res.status(400).json({ error: e.message || '인스타그램 아바타 갱신에 실패했습니다.' })
  }
})

router.post('/instructor-portfolio-works/refresh-rednote-thumbnails', async (req, res) => {
  try {
    const works = await db.refreshInstructorPortfolioVisuals({ rednote: true })
    res.json({ success: true, ...works })
  } catch (e) {
    res.status(400).json({ error: e.message || '샤오홍슈 썸네일 추출에 실패했습니다.' })
  }
})

router.get('/instructors', async (req, res) => {
  res.json(await db.getInstructors({ publicOnly: false }))
})

router.post('/instructors', async (req, res) => {
  try {
    const instructor = await db.createInstructor(req.body)
    res.json({ success: true, instructor })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

router.patch('/instructors/:id', async (req, res) => {
  const instructor = await db.updateInstructor(req.params.id, req.body)
  if (!instructor) return res.status(404).json({ error: '강사를 찾을 수 없습니다.' })
  res.json({ success: true, instructor })
})

router.delete('/instructors/:id', async (req, res) => {
  await db.deleteInstructor(req.params.id)
  res.json({ success: true })
})

// ── 에디터즈 선발 프로그램 설계 ──
router.get('/editor-program/config', async (req, res) => {
  const config = await db.getEditorProgramConfig()
  const workbooks = await db.getEditorWorkbooks()
  res.json({
    ...config,
    total_mails: getTotalMailCountFromConfig(config),
    workbooks: workbooks.map(w => ({
      id: w.id,
      order_num: w.order_num,
      stage_num: w.stage_num,
      position_in_stage: w.position_in_stage,
      from_name: w.from_name,
      from_company: w.from_company,
      subject: w.subject,
      mission_title: w.mission_title,
    })),
  })
})

router.patch('/editor-program/config', async (req, res) => {
  const { stages, guide_cards, terms_version } = req.body
  if (stages !== undefined && (!Array.isArray(stages) || !stages.length)) {
    return res.status(400).json({ error: '단계 설정이 올바르지 않습니다.' })
  }
  const config = await db.updateEditorProgramConfig({ stages, guide_cards, terms_version })
  res.json({
    success: true,
    ...config,
    total_mails: getTotalMailCountFromConfig(config),
  })
})

router.patch('/editor-program/workbooks/:id', async (req, res) => {
  const workbook = await db.updateEditorWorkbook(req.params.id, req.body)
  if (!workbook) return res.status(404).json({ error: '메일을 찾을 수 없습니다.' })
  res.json({ success: true, workbook })
})

router.get('/editor-program/workbooks/:id', async (req, res) => {
  const workbook = await db.getEditorWorkbookById(req.params.id)
  if (!workbook) return res.status(404).json({ error: '메일을 찾을 수 없습니다.' })
  res.json(workbook)
})

router.post('/editor-program/sync', async (req, res) => {
  const result = await db.syncWorkbookSlotsFromConfig()
  res.json({ success: true, ...result })
})

// ── 미션 제출 검수 ──
router.get('/workbook-submissions', async (req, res) => {
  const { user_id, workbook_id } = req.query
  const subs = await db.getWorkbookSubmissions({ userId: user_id, workbookId: workbook_id })
  const userIds = [...new Set(subs.map(s => s.user_id).filter(Boolean))]
  const workbookIds = [...new Set(subs.map(s => s.workbook_id).filter(Boolean))]
  const [userMap, workbooks] = await Promise.all([
    db.batchGetUsers(userIds),
    Promise.all(workbookIds.map(id => db.getEditorWorkbookById(id))),
  ])
  const wbMap = Object.fromEntries(workbookIds.map((id, i) => [id, workbooks[i]]))
  res.json(subs.map(s => {
    const wb = wbMap[s.workbook_id]
    const u = userMap[s.user_id]
    return {
      ...s,
      user_name: u?.name || '-',
      user_email: u?.email || '-',
      workbook_subject: wb?.subject || '-',
      workbook_order: wb?.order_num || '-',
      stage_num: wb?.stage_num || '-',
    }
  }))
})

router.post('/workbook-submissions/:id/review', async (req, res) => {
  const { verdict, feedback } = req.body
  if (!['passed', 'failed'].includes(verdict)) return res.status(400).json({ error: 'verdict must be passed or failed' })
  const result = await db.adminReviewSubmission(req.params.id, { verdict, feedback })
  res.json({ success: true, submission: result })
})

// ── 공지사항 ──
router.get('/notices', async (req, res) => {
  res.json(await db.getNotices())
})
router.post('/notices', async (req, res) => {
  const { title, content, is_public, is_pinned } = req.body
  if (!title || !content) return res.status(400).json({ error: '제목과 내용은 필수입니다.' })
  res.json(await db.createNotice({ title, content, is_public: !!is_public, is_pinned: !!is_pinned }))
})
router.patch('/notices/:id', async (req, res) => {
  const notice = await db.updateNotice(req.params.id, req.body)
  if (!notice) return res.status(404).json({ error: '공지를 찾을 수 없습니다.' })
  res.json({ success: true, notice })
})
router.delete('/notices/:id', async (req, res) => {
  await db.deleteNotice(req.params.id)
  res.json({ success: true })
})

// ── 블로그 ──
router.get('/blog', async (req, res) => {
  res.json(await db.getBlogPosts())
})
router.post('/blog', async (req, res) => {
  const { title, excerpt, content, cover_image, is_published } = req.body
  if (!title || !String(title).trim()) return res.status(400).json({ error: '제목을 입력하세요.' })
  const post = await db.createBlogPost({ title, excerpt, content, cover_image, is_published: !!is_published })
  if (post?.error) return res.status(400).json({ error: post.error })
  res.json(post)
})
router.patch('/blog/:id', async (req, res) => {
  const post = await db.updateBlogPost(req.params.id, req.body)
  if (!post || post.error) return res.status(404).json({ error: '글을 찾을 수 없습니다.' })
  res.json({ success: true, post })
})
router.delete('/blog/:id', async (req, res) => {
  await db.deleteBlogPost(req.params.id)
  res.json({ success: true })
})

// ── 고객지원 문의 ──
router.get('/tickets', async (req, res) => {
  res.json(await db.getTickets({ status: req.query.status }))
})
router.get('/tickets/:id', async (req, res) => {
  const t = await db.getTicketById(req.params.id)
  if (!t) return res.status(404).json({ error: '문의를 찾을 수 없습니다.' })
  res.json(t)
})
router.post('/tickets/:id/answer', async (req, res) => {
  const { answer } = req.body
  if (!answer) return res.status(400).json({ error: '답변 내용이 필요합니다.' })
  const t = await db.answerTicket(req.params.id, { answer })
  res.json({ success: true, ticket: t })
})
router.patch('/tickets/:id/status', async (req, res) => {
  const { status } = req.body
  if (!['open', 'answered', 'closed'].includes(status)) return res.status(400).json({ error: '유효하지 않은 상태입니다.' })
  const t = await db.updateTicketStatus(req.params.id, status)
  res.json({ success: true, ticket: t })
})
router.delete('/tickets/:id', async (req, res) => {
  await db.deleteTicket(req.params.id)
  res.json({ success: true })
})

// ── FAQ ──
router.get('/faqs', async (req, res) => {
  res.json(await db.getFaqs())
})
router.post('/faqs', async (req, res) => {
  const { question, answer, category, is_public, sort_order } = req.body
  if (!question || !answer) return res.status(400).json({ error: '질문과 답변은 필수입니다.' })
  res.json(await db.createFaq({ question, answer, category, is_public: is_public !== false, sort_order }))
})
router.patch('/faqs/:id', async (req, res) => {
  const faq = await db.updateFaq(req.params.id, req.body)
  if (!faq) return res.status(404).json({ error: 'FAQ를 찾을 수 없습니다.' })
  res.json({ success: true, faq })
})
router.delete('/faqs/:id', async (req, res) => {
  await db.deleteFaq(req.params.id)
  res.json({ success: true })
})

// ── 수강생 프로그램 (타닥싱크 등) ──
router.get('/programs', async (req, res) => {
  try {
    res.json(await db.listCoursePrograms())
  } catch (e) {
    console.error('admin programs list:', e)
    res.status(500).json({ error: '프로그램 목록을 불러오지 못했습니다.' })
  }
})

router.post('/programs', async (req, res) => {
  try {
    const result = await db.createCourseProgram(req.body || {})
    if (result.error === 'name_required') return res.status(400).json({ error: '프로그램 이름을 입력하세요.' })
    if (result.error === 'slug_required') return res.status(400).json({ error: '프로그램 식별자를 입력하세요.' })
    if (result.error === 'slug_exists') return res.status(409).json({ error: '이미 존재하는 프로그램 식별자입니다.' })
    res.json({ success: true, program: result })
  } catch (e) {
    console.error('admin programs create:', e)
    res.status(500).json({ error: '프로그램을 만들지 못했습니다.' })
  }
})

router.patch('/programs/:id', async (req, res) => {
  try {
    const result = await db.updateCourseProgram(req.params.id, req.body || {})
    if (result.error === 'not_found') return res.status(404).json({ error: '프로그램을 찾을 수 없습니다.' })
    if (result.error === 'slug_exists') return res.status(409).json({ error: '이미 존재하는 프로그램 식별자입니다.' })
    res.json({ success: true, program: result })
  } catch (e) {
    console.error('admin programs update:', e)
    res.status(500).json({ error: '프로그램을 수정하지 못했습니다.' })
  }
})

router.delete('/programs/:id', async (req, res) => {
  try {
    const result = await db.deleteCourseProgram(req.params.id)
    if (result.error === 'not_found') return res.status(404).json({ error: '프로그램을 찾을 수 없습니다.' })
    if (result.error === 'in_use') return res.status(409).json({ error: '강의에 연결된 프로그램은 삭제할 수 없습니다.' })
    res.json({ success: true })
  } catch (e) {
    console.error('admin programs delete:', e)
    res.status(500).json({ error: '프로그램을 삭제하지 못했습니다.' })
  }
})

router.post('/programs/ensure-subtitle', async (req, res) => {
  try {
    const [subtitle, views] = await Promise.all([
      db.ensureDefaultSubtitleProgram(),
      db.ensureDefaultViewsEditingProgram(),
    ])
    const linked = await db.linkDefaultProgramIdsForKnownCourses()
    res.json({ success: true, program: subtitle, programs: [subtitle, views], linked })
  } catch (e) {
    console.error('admin ensure subtitle program:', e)
    res.status(500).json({ error: '기본 프로그램을 준비하지 못했습니다.' })
  }
})

router.get('/login-logs', async (req, res) => {
  try {
    const successRaw = req.query.success
    let success = null
    if (successRaw === '1' || successRaw === 'true') success = true
    if (successRaw === '0' || successRaw === 'false') success = false
    const logs = await db.listLoginLogs({
      limit: Number(req.query.limit) || 150,
      from: req.query.from || null,
      to: req.query.to || null,
      method: req.query.method || null,
      success,
      email: req.query.email || null,
      userId: req.query.user_id || null,
    })
    res.json(logs)
  } catch (e) {
    console.error('admin login-logs:', e)
    res.status(500).json({ error: e.message || '로그인 기록을 불러오지 못했습니다.' })
  }
})

router.get('/login-logs/sheets-status', async (req, res) => {
  try {
    const { isSheetsConfigured, sheetsConfig } = require('../utils/googleSheetsLoginSync')
    const { kstDateKey } = require('../utils/kstDate')
    const cfg = sheetsConfig()
    const today = kstDateKey()
    const [recentSync, pendingToday] = await Promise.all([
      db.listLoginLogsSheetsSyncStates(14),
      db.getLoginLogsForKstDate(today, { unsyncedOnly: true }),
    ])
    res.json({
      configured: isSheetsConfigured(),
      spreadsheet_id: cfg.spreadsheetId || null,
      tab: cfg.tab || null,
      recent_sync: recentSync,
      pending_today_count: pendingToday.length,
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/login-logs/sync-sheets', async (req, res) => {
  try {
    const { syncLoginLogsForKstDate, isSheetsConfigured } = require('../utils/googleSheetsLoginSync')
    const { kstDateKey } = require('../utils/kstDate')
    if (!isSheetsConfigured()) {
      return res.status(400).json({ error: 'Google Sheets env가 설정되지 않았습니다.' })
    }
    const dateKey = String(req.body?.date || kstDateKey()).trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
      return res.status(400).json({ error: 'date는 YYYY-MM-DD 형식이어야 합니다.' })
    }
    const result = await syncLoginLogsForKstDate(dateKey, db)
    res.json({ ok: true, ...result })
  } catch (e) {
    console.error('admin login-logs sync-sheets:', e)
    res.status(500).json({ error: e.message || '스프레드시트 동기화에 실패했습니다.' })
  }
})

module.exports = router
