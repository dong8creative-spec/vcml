const router = require('express').Router()
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const db = require('../db/schema')
const { sendCouponIssuedMessage } = require('../utils/kakaoMessage')
const { authMiddleware } = require('../middleware/auth')

// 이메일 인증 코드 임시 저장소 (실서비스에서는 Redis 등 사용)
const verificationCodes = new Map() // email → { code, expiresAt, verified }

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

// 인증 코드 발송
router.post('/send-code', (req, res) => {
  const { email } = req.body
  if (!email) return res.status(400).json({ error: '이메일을 입력해주세요.' })
  if (db.findUserByEmail(email)) return res.status(409).json({ error: '이미 가입된 이메일입니다.' })

  const code = generateCode()
  verificationCodes.set(email, { code, expiresAt: Date.now() + 10 * 60 * 1000, verified: false })

  // 실서비스: 이메일 발송 (nodemailer 등)
  // 개발 환경: 콘솔 출력 + 응답에 포함
  console.log(`[인증코드] ${email} → ${code}`)

  res.json({ success: true, dev_code: code }) // 운영 시 dev_code 제거
})

// 인증 코드 검증
router.post('/verify-code', (req, res) => {
  const { email, code } = req.body
  const entry = verificationCodes.get(email)
  if (!entry) return res.status(400).json({ error: '인증 코드를 먼저 요청해주세요.' })
  if (Date.now() > entry.expiresAt) {
    verificationCodes.delete(email)
    return res.status(400).json({ error: '인증 코드가 만료됐습니다. 다시 요청해주세요.' })
  }
  if (entry.code !== String(code)) return res.status(400).json({ error: '인증 코드가 일치하지 않습니다.' })
  entry.verified = true
  res.json({ success: true })
})

const KAKAO_CLIENT_ID = process.env.KAKAO_CLIENT_ID
const KAKAO_REDIRECT_URI = process.env.KAKAO_REDIRECT_URI

// ── 카카오 로그인 진입 ──
router.get('/kakao', (req, res) => {
  const next = req.query.next || '/'
  const state = Buffer.from(JSON.stringify({ next })).toString('base64')
  const url = `https://kauth.kakao.com/oauth/authorize?client_id=${KAKAO_CLIENT_ID}&redirect_uri=${encodeURIComponent(KAKAO_REDIRECT_URI)}&response_type=code&state=${state}`
  res.redirect(url)
})

// ── 카카오 콜백 ──
router.get('/kakao/callback', async (req, res) => {
  const { code, state, error } = req.query

  if (error) {
    return res.redirect('/login.html?kakao_error=' + encodeURIComponent('카카오 로그인을 취소했습니다.'))
  }

  try {
    // 1. 인가 코드 → access token
    const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: KAKAO_CLIENT_ID,
        redirect_uri: KAKAO_REDIRECT_URI,
        code,
      }),
    })
    const tokenData = await tokenRes.json()
    if (tokenData.error) throw new Error(tokenData.error_description || '토큰 발급 실패')

    // 2. access token → 사용자 정보
    const userRes = await fetch('https://kapi.kakao.com/v2/user/me', {
      headers: { Authorization: 'Bearer ' + tokenData.access_token },
    })
    const kakaoUser = await userRes.json()

    const kakaoId = kakaoUser.id
    const kakaoEmail = kakaoUser.kakao_account?.email || null
    const kakaoName = kakaoUser.kakao_account?.profile?.nickname || kakaoUser.properties?.nickname || '카카오 사용자'

    // 3. 기존 유저 찾기 (kakao_id 우선, 이메일 fallback)
    let isNew = false
    let user = db.findUserByKakaoId(kakaoId)
    if (!user && kakaoEmail) {
      user = db.findUserByEmail(kakaoEmail)
      if (user) db.linkKakaoId(user.id, kakaoId)
    }
    if (!user) {
      user = db.createKakaoUser(kakaoId, kakaoEmail, kakaoName)
      isNew = true
    }

    // 4. JWT 발급
    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, role: user.role, profileComplete: !!user.profile_complete },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    )

    // 5. next URL 파싱 후 리디렉트
    let nextUrl = '/'
    try { nextUrl = JSON.parse(Buffer.from(state, 'base64').toString()).next || '/' } catch {}

    // 신규 카카오 유저 → 온보딩 페이지로
    if (isNew || !user.profile_complete) {
      const userJson = encodeURIComponent(JSON.stringify({ id: user.id, email: user.email, name: user.name, role: user.role }))
      return res.redirect(`/onboarding.html?kakao_token=${token}&kakao_user=${userJson}&next=${encodeURIComponent(nextUrl)}`)
    }

    const userJson = encodeURIComponent(JSON.stringify({ id: user.id, email: user.email, name: user.name, role: user.role }))
    res.redirect(`/login.html?kakao_token=${token}&kakao_user=${userJson}&next=${encodeURIComponent(nextUrl)}`)
  } catch (err) {
    console.error('카카오 로그인 오류:', err)
    res.redirect('/login.html?kakao_error=' + encodeURIComponent('카카오 로그인 중 오류가 발생했습니다.'))
  }
})

// 카카오 온보딩 — 프로필 완성
router.post('/complete-profile', authMiddleware, async (req, res) => {
  const { name, email, phone, marketing_agreed } = req.body
  if (!email) return res.status(400).json({ error: '이메일을 입력해주세요.' })

  // 이메일 중복 확인 (다른 사용자가 이미 사용 중인 경우)
  const existing = db.findUserByEmail(email)
  if (existing && existing.id !== req.user.id) return res.status(409).json({ error: '이미 사용 중인 이메일입니다.' })

  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress
  const user = db.completeProfile(req.user.id, { name, email, phone, marketing_agreed: !!marketing_agreed, ip })
  if (!user) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' })

  let coupon = null
  if (marketing_agreed) {
    coupon = db.createCoupon(user.id, 5000, 'marketing_consent')
    // 전화번호가 있을 때만 SMS 발송
    try {
      await sendCouponIssuedMessage(phone, user.name, coupon.code)
    } catch (e) {
      console.error('알림톡 발송 오류:', e.message)
    }
  }

  const token = jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role, profileComplete: true },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  )
  res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role }, coupon })
})

router.post('/register', (req, res) => {
  const { email, password, name } = req.body
  if (!email || !password || !name) return res.status(400).json({ error: '모든 항목을 입력해주세요.' })
  if (password.length < 8) return res.status(400).json({ error: '비밀번호는 8자 이상이어야 합니다.' })

  const entry = verificationCodes.get(email)
  if (!entry || !entry.verified) return res.status(400).json({ error: '이메일 인증이 완료되지 않았습니다.' })

  if (db.findUserByEmail(email)) return res.status(409).json({ error: '이미 가입된 이메일입니다.' })

  const hash = bcrypt.hashSync(password, 10)
  const user = db.createUser(email, hash, name)
  verificationCodes.delete(email)

  const token = jwt.sign({ id: user.id, email, name, role: 'student' }, process.env.JWT_SECRET, { expiresIn: '7d' })
  res.json({ token, user: { id: user.id, email, name, role: 'student' } })
})

router.post('/login', (req, res) => {
  const { email, password } = req.body
  if (!email || !password) return res.status(400).json({ error: '이메일과 비밀번호를 입력해주세요.' })
  const user = db.findUserByEmail(email)
  if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' })
  const token = jwt.sign({ id: user.id, email: user.email, name: user.name, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' })
  res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } })
})

module.exports = router
