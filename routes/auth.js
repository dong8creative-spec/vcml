const router = require('express').Router()
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const db = require('../db/schema')
const userPayload = require('../db/schema').userPayload
const { sendCouponIssuedMessage } = require('../utils/kakaoMessage')
const { authMiddleware } = require('../middleware/auth')

const verificationCodes = new Map()

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

function parseOAuthNext(state) {
  try {
    const parsed = JSON.parse(Buffer.from(state, 'base64').toString()).next || '/'
    return parsed.startsWith('/') && !parsed.startsWith('//') ? parsed : '/'
  } catch {
    return '/'
  }
}

function encodeOAuthState(next) {
  return Buffer.from(JSON.stringify({ next: next || '/' })).toString('base64')
}

function signUserToken(user, { profileComplete } = {}) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      member_type: user.member_type || 'student',
      profileComplete: profileComplete !== undefined ? profileComplete : !!user.profile_complete,
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  )
}

function redirectOAuthLogin(res, { token, user, nextUrl, paramPrefix = 'oauth' }) {
  const userJson = encodeURIComponent(JSON.stringify(userPayload(user)))
  res.redirect(`/login.html?${paramPrefix}_token=${token}&${paramPrefix}_user=${userJson}&next=${encodeURIComponent(nextUrl)}`)
}

const KAKAO_CLIENT_ID = process.env.KAKAO_CLIENT_ID
const KAKAO_REDIRECT_URI = process.env.KAKAO_REDIRECT_URI
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI

router.get('/providers', (req, res) => {
  res.json({
    google: !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REDIRECT_URI),
    kakao: !!(KAKAO_CLIENT_ID && KAKAO_REDIRECT_URI),
    beta_mode: process.env.AUTH_BETA_MODE !== '0',
  })
})

router.post('/send-code', async (req, res) => {
  const { email: rawEmail } = req.body
  const email = (rawEmail || '').toLowerCase().trim()
  if (!email) return res.status(400).json({ error: '이메일을 입력해주세요.' })
  if (await db.findUserByEmail(email)) return res.status(409).json({ error: '이미 가입된 이메일입니다.' })
  const code = generateCode()
  verificationCodes.set(email, { code, expiresAt: Date.now() + 10 * 60 * 1000, verified: false })
  console.log(`[인증코드] ${email} → ${code}`)
  res.json({ success: true, dev_code: code })
})

router.post('/verify-code', (req, res) => {
  const { email: rawEmail, code } = req.body
  const email = (rawEmail || '').toLowerCase().trim()
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

router.get('/kakao', (req, res) => {
  if (!KAKAO_CLIENT_ID || !KAKAO_REDIRECT_URI) {
    return res.redirect('/login.html?kakao_error=' + encodeURIComponent('카카오 로그인이 설정되지 않았습니다.'))
  }
  const state = encodeOAuthState(req.query.next)
  const url = `https://kauth.kakao.com/oauth/authorize?client_id=${KAKAO_CLIENT_ID}&redirect_uri=${encodeURIComponent(KAKAO_REDIRECT_URI)}&response_type=code&state=${state}`
  res.redirect(url)
})

router.get('/kakao/callback', async (req, res) => {
  const { code, state, error } = req.query
  if (error) return res.redirect('/login.html?kakao_error=' + encodeURIComponent('카카오 로그인을 취소했습니다.'))
  try {
    const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: KAKAO_CLIENT_ID, redirect_uri: KAKAO_REDIRECT_URI, code }),
    })
    const tokenData = await tokenRes.json()
    if (tokenData.error) throw new Error(tokenData.error_description || '토큰 발급 실패')

    const userRes = await fetch('https://kapi.kakao.com/v2/user/me', {
      headers: { Authorization: 'Bearer ' + tokenData.access_token },
    })
    const kakaoUser = await userRes.json()
    const kakaoId = kakaoUser.id
    const kakaoEmail = kakaoUser.kakao_account?.email || null
    const kakaoName = kakaoUser.kakao_account?.profile?.nickname || kakaoUser.properties?.nickname || '카카오 사용자'

    let isNew = false
    let user = await db.findUserByKakaoId(kakaoId)
    if (!user && kakaoEmail) {
      user = await db.findUserByEmail(kakaoEmail)
      if (user) await db.linkKakaoId(user.id, kakaoId)
    }
    if (!user) {
      user = await db.createKakaoUser(kakaoId, kakaoEmail, kakaoName)
      isNew = true
    }

    const token = signUserToken(user)
    const nextUrl = parseOAuthNext(state)

    if (isNew || !user.profile_complete) {
      const userJson = encodeURIComponent(JSON.stringify(userPayload(user)))
      return res.redirect(`/onboarding.html?kakao_token=${token}&kakao_user=${userJson}&next=${encodeURIComponent(nextUrl)}`)
    }

    redirectOAuthLogin(res, { token, user, nextUrl, paramPrefix: 'kakao' })
  } catch (err) {
    console.error('카카오 로그인 오류:', err)
    res.redirect('/login.html?kakao_error=' + encodeURIComponent('카카오 로그인 중 오류가 발생했습니다.'))
  }
})

router.get('/google', (req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
    return res.redirect('/login.html?google_error=' + encodeURIComponent('Google 로그인이 설정되지 않았습니다. 관리자에게 문의해주세요.'))
  }
  const state = encodeOAuthState(req.query.next)
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  })
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
})

router.get('/google/callback', async (req, res) => {
  const { code, state, error } = req.query
  if (error) {
    const msg = error === 'access_denied' ? 'Google 로그인을 취소했습니다.' : 'Google 로그인 중 오류가 발생했습니다.'
    return res.redirect('/login.html?google_error=' + encodeURIComponent(msg))
  }
  if (!code) {
    return res.redirect('/login.html?google_error=' + encodeURIComponent('Google 인증 코드가 없습니다.'))
  }
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_REDIRECT_URI,
        code,
      }),
    })
    const tokenData = await tokenRes.json()
    if (tokenData.error) throw new Error(tokenData.error_description || tokenData.error || '토큰 발급 실패')

    const userRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: 'Bearer ' + tokenData.access_token },
    })
    const googleUser = await userRes.json()
    if (!googleUser.sub) throw new Error('Google 사용자 정보를 불러오지 못했습니다.')

    const googleId = googleUser.sub
    const googleEmail = (googleUser.email || '').toLowerCase().trim() || null
    const googleName = googleUser.name || googleUser.given_name || 'Google 사용자'
    const googlePicture = googleUser.picture || null

    let user = await db.findUserByGoogleId(googleId)
    if (!user && googleEmail) {
      user = await db.findUserByEmail(googleEmail)
      if (user) {
        await db.linkGoogleId(user.id, googleId)
        user = await db.findUserById(user.id)
      }
    }
    if (!user) {
      user = await db.createGoogleUser(googleId, googleEmail, googleName, googlePicture)
    } else {
      const profileUpdate = {}
      if (googlePicture && !user.profile_image) profileUpdate.profile_image = googlePicture
      if (googleName && (!user.name || user.name === 'Google 사용자')) profileUpdate.name = googleName
      if (Object.keys(profileUpdate).length) {
        user = await db.updateUserProfile(user.id, profileUpdate)
      }
    }

    // 베타: Google 로그인은 온보딩 없이 바로 이용 (Google OAuth 범위 내 정보만 사용)
    const token = signUserToken(user, { profileComplete: true })
    const nextUrl = parseOAuthNext(state)
    redirectOAuthLogin(res, { token, user, nextUrl, paramPrefix: 'google' })
  } catch (err) {
    console.error('Google 로그인 오류:', err)
    res.redirect('/login.html?google_error=' + encodeURIComponent('Google 로그인 중 오류가 발생했습니다.'))
  }
})

router.post('/complete-profile', authMiddleware, async (req, res) => {
  const { name, email, phone, marketing_agreed, member_type } = req.body
  if (!email) return res.status(400).json({ error: '이메일을 입력해주세요.' })
  const current = await db.findUserById(req.user.id)
  if (!current?.member_type && !member_type) {
    return res.status(400).json({ error: '가입 유형(수강생/의뢰인)을 선택해주세요.' })
  }
  if (member_type && !['student', 'client'].includes(member_type)) {
    return res.status(400).json({ error: '올바른 가입 유형을 선택해주세요.' })
  }
  const existing = await db.findUserByEmail(email)
  if (existing && existing.id !== req.user.id) return res.status(409).json({ error: '이미 사용 중인 이메일입니다.' })
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress
  const user = await db.completeProfile(req.user.id, { name, email, phone, marketing_agreed: !!marketing_agreed, member_type, ip })
  if (!user) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' })

  let coupon = null
  if (marketing_agreed) {
    coupon = await db.createCoupon(user.id, 5000, 'marketing_consent')
    if (phone) {
      try { await sendCouponIssuedMessage(phone, user.name, coupon.code) } catch (e) { console.error('알림톡 오류:', e.message) }
    }
  }

  const token = signUserToken(user, { profileComplete: true })
  res.json({ token, user: userPayload(user), coupon })
})

router.post('/register', async (req, res) => {
  const { email: rawEmail, password, name, member_type } = req.body
  const email = (rawEmail || '').toLowerCase().trim()
  if (!email || !password || !name) return res.status(400).json({ error: '모든 항목을 입력해주세요.' })
  if (!member_type || !['student', 'client'].includes(member_type)) {
    return res.status(400).json({ error: '가입 유형(수강생/의뢰인)을 선택해주세요.' })
  }
  if (password.length < 8) return res.status(400).json({ error: '비밀번호는 8자 이상이어야 합니다.' })
  const entry = verificationCodes.get(email)
  if (!entry || !entry.verified) return res.status(400).json({ error: '이메일 인증이 완료되지 않았습니다.' })
  if (await db.findUserByEmail(email)) return res.status(409).json({ error: '이미 가입된 이메일입니다.' })
  const hash = bcrypt.hashSync(password, 10)
  const user = await db.createUser(email, hash, name, member_type)
  verificationCodes.delete(email)
  const token = jwt.sign({ id: user.id, email, name, role: 'student', member_type }, process.env.JWT_SECRET, { expiresIn: '7d' })
  res.json({ token, user: userPayload(user) })
})

router.post('/login', async (req, res) => {
  const { email: rawEmail, password } = req.body
  const email = (rawEmail || '').toLowerCase().trim()
  if (!email || !password) return res.status(400).json({ error: '이메일과 비밀번호를 입력해주세요.' })
  const user = await db.findUserByEmail(email)
  if (!user || !user.password || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' })
  }
  const token = jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role, member_type: user.member_type || 'student' },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  )
  res.json({ token, user: userPayload(user) })
})

module.exports = router
