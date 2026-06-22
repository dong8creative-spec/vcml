const router = require('express').Router()
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const db = require('../db/schema')
const userPayload = require('../db/schema').userPayload
const { sendCouponIssuedMessage } = require('../utils/kakaoMessage')
const { authMiddleware } = require('../middleware/auth')
const { isAllowedAdmin } = require('../utils/adminAccess')

const verificationCodes = new Map()

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

function parseOAuthState(state) {
  try {
    const parsed = JSON.parse(Buffer.from(state, 'base64').toString())
    const next = parsed.next || '/'
    const intent = ['login', 'link'].includes(parsed.intent) ? parsed.intent : 'signup'
    return {
      nextUrl: next.startsWith('/') && !next.startsWith('//') ? next : '/',
      memberType: ['student', 'client'].includes(parsed.member_type) ? parsed.member_type : null,
      intent,
      linkToken: typeof parsed.link_token === 'string' ? parsed.link_token : null,
    }
  } catch {
    return { nextUrl: '/', memberType: null, intent: 'signup', linkToken: null }
  }
}

function parseOAuthNext(state) {
  return parseOAuthState(state).nextUrl
}

function encodeOAuthState(next, memberType, intent, linkToken) {
  const payload = { next: next || '/' }
  if (memberType && ['student', 'client'].includes(memberType)) {
    payload.member_type = memberType
  }
  if (intent === 'login' || intent === 'link') payload.intent = intent
  if (linkToken) payload.link_token = linkToken
  return Buffer.from(JSON.stringify(payload)).toString('base64')
}

// 로그인 상태에서 소셜 계정 연동용 단기 토큰 발급(5분)
router.get('/link-token', authMiddleware, (req, res) => {
  const linkToken = jwt.sign({ uid: req.user.id, purpose: 'social-link' }, process.env.JWT_SECRET, { expiresIn: '5m' })
  res.json({ link_token: linkToken })
})

// link_token 검증 → 연동 대상 userId 반환(실패 시 null)
function verifyLinkToken(linkToken) {
  if (!linkToken) return null
  try {
    const decoded = jwt.verify(linkToken, process.env.JWT_SECRET)
    return decoded.purpose === 'social-link' ? decoded.uid : null
  } catch {
    return null
  }
}

function clientUser(user) {
  return { ...userPayload(user), can_access_admin: isAllowedAdmin(user) }
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

function redirectOAuthLogin(res, { token, user, nextUrl, paramPrefix = 'oauth', welcome = false }) {
  const userJson = encodeURIComponent(JSON.stringify(clientUser(user)))
  const welcomeQ = welcome ? '&welcome=1' : ''
  res.redirect(`/login.html?${paramPrefix}_token=${token}&${paramPrefix}_user=${userJson}&next=${encodeURIComponent(nextUrl)}${welcomeQ}`)
}

const KAKAO_CLIENT_ID = process.env.KAKAO_CLIENT_ID
const KAKAO_REDIRECT_URI = process.env.KAKAO_REDIRECT_URI
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI

function isKakaoConfigured() {
  const id = KAKAO_CLIENT_ID || ''
  return !!(id && KAKAO_REDIRECT_URI && !/여기에|입력|your_/i.test(id))
}

function isKakaoLoginEnabled() {
  if (process.env.KAKAO_LOGIN_ENABLED === '0') return false
  if (process.env.KAKAO_LOGIN_ENABLED === '1') return isKakaoConfigured()
  if (process.env.AUTH_BETA_MODE !== '0') return false
  return isKakaoConfigured()
}

router.get('/providers', (req, res) => {
  const beta = process.env.AUTH_BETA_MODE !== '0'
  res.json({
    google: !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REDIRECT_URI),
    kakao: isKakaoLoginEnabled(),
    kakao_locked: beta || process.env.KAKAO_LOGIN_ENABLED === '0',
    beta_mode: beta,
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
  if (!isKakaoLoginEnabled()) {
    return res.redirect('/login.html?kakao_error=' + encodeURIComponent('카카오 로그인이 설정되지 않았습니다. 관리자에게 문의해주세요.'))
  }
  const intent = ['login', 'link'].includes(req.query.intent) ? req.query.intent : 'signup'
  const member_type = req.query.member_type
  if (intent === 'signup') {
    if (!member_type || !['student', 'client'].includes(member_type)) {
      const nextQ = req.query.next ? '&next=' + encodeURIComponent(req.query.next) : ''
      return res.redirect('/login.html?kakao_error=' + encodeURIComponent('가입 유형(수강생/의뢰인)을 선택해주세요.') + nextQ)
    }
  }
  const state = encodeOAuthState(req.query.next, member_type, intent, intent === 'link' ? req.query.link_token : null)
  const scope = ['profile_nickname', 'account_email', 'gender', 'age_range', 'birthyear', 'account_ci'].join(',')
  const url = `https://kauth.kakao.com/oauth/authorize?client_id=${KAKAO_CLIENT_ID}&redirect_uri=${encodeURIComponent(KAKAO_REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(scope)}&state=${state}`
  res.redirect(url)
})

router.get('/kakao/callback', async (req, res) => {
  const { code, state, error } = req.query
  if (error) return res.redirect('/login.html?kakao_error=' + encodeURIComponent('카카오 로그인을 취소했습니다.'))
  if (!code) {
    return res.redirect('/login.html?kakao_error=' + encodeURIComponent('카카오 인증 코드가 없습니다.'))
  }
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
    const account = kakaoUser.kakao_account || {}
    const kakaoEmail = (account.email || '').toLowerCase().trim() || null
    const kakaoName = account.profile?.nickname || kakaoUser.properties?.nickname || '카카오 사용자'
    const kakaoProfile = {
      gender: account.gender || null,
      age_range: account.age_range || null,
      birthyear: account.birthyear ? String(account.birthyear) : null,
      ci: account.ci || null,
    }

    const { nextUrl, memberType, intent, linkToken } = parseOAuthState(state)

    // 로그인 상태에서의 계정 연동
    if (intent === 'link') {
      const linkUid = verifyLinkToken(linkToken)
      if (!linkUid) {
        return res.redirect('/mypage.html?link_error=' + encodeURIComponent('연동 세션이 만료되었습니다. 다시 시도해주세요.'))
      }
      const existing = await db.findUserByKakaoId(kakaoId)
      if (existing && existing.id !== linkUid) {
        return res.redirect('/mypage.html?link_error=' + encodeURIComponent('이미 다른 계정에 연결된 카카오 계정입니다.'))
      }
      await db.linkKakaoId(linkUid, kakaoId)
      if (Object.values(kakaoProfile).some(Boolean)) await db.updateKakaoProfile(linkUid, kakaoProfile)
      return res.redirect('/mypage.html?link_success=kakao')
    }

    let isNew = false
    let user = await db.findUserByKakaoId(kakaoId)
    if (!user && kakaoEmail) {
      user = await db.findUserByEmail(kakaoEmail)
      if (user) {
        await db.linkKakaoId(user.id, kakaoId)
        user = await db.findUserById(user.id)
      }
    }
    if (!user) {
      if (intent === 'login' || !memberType) {
        return res.redirect('/login.html?kakao_error=' + encodeURIComponent('처음 이용하시는 경우 회원가입(가입 유형 선택)을 먼저 진행해주세요.') + (nextUrl !== '/' ? '&next=' + encodeURIComponent(nextUrl) : ''))
      }
      user = await db.createKakaoUser(kakaoId, kakaoEmail, kakaoName, memberType || 'student', kakaoProfile)
      isNew = true
    } else if (Object.values(kakaoProfile).some(Boolean)) {
      await db.updateKakaoProfile(user.id, kakaoProfile)
      user = await db.findUserById(user.id)
    } else if (memberType && !user.member_type) {
      user = await db.completeProfile(user.id, {
        name: user.name,
        email: user.email || kakaoEmail,
        member_type: memberType,
      })
    }

    if (isNew || !user.profile_complete) {
      const token = signUserToken(user, { profileComplete: false })
      const userJson = encodeURIComponent(JSON.stringify(userPayload(user)))
      return res.redirect(`/onboarding.html?kakao_token=${token}&kakao_user=${userJson}&next=${encodeURIComponent(nextUrl)}`)
    }

    const token = signUserToken(user, { profileComplete: true })
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
  const intent = ['login', 'link'].includes(req.query.intent) ? req.query.intent : 'signup'
  const member_type = req.query.member_type
  if (intent === 'signup') {
    if (!member_type || !['student', 'client'].includes(member_type)) {
      const nextQ = req.query.next ? '&next=' + encodeURIComponent(req.query.next) : ''
      return res.redirect('/login.html?google_error=' + encodeURIComponent('가입 유형(수강생/의뢰인)을 선택해주세요.') + nextQ)
    }
  }
  const state = encodeOAuthState(req.query.next, member_type, intent, intent === 'link' ? req.query.link_token : null)
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

    const { nextUrl, memberType, intent, linkToken } = parseOAuthState(state)

    // 로그인 상태에서의 계정 연동
    if (intent === 'link') {
      const linkUid = verifyLinkToken(linkToken)
      if (!linkUid) {
        return res.redirect('/mypage.html?link_error=' + encodeURIComponent('연동 세션이 만료되었습니다. 다시 시도해주세요.'))
      }
      const existing = await db.findUserByGoogleId(googleId)
      if (existing && existing.id !== linkUid) {
        return res.redirect('/mypage.html?link_error=' + encodeURIComponent('이미 다른 계정에 연결된 Google 계정입니다.'))
      }
      await db.linkGoogleId(linkUid, googleId)
      return res.redirect('/mypage.html?link_success=google')
    }

    let user = await db.findUserByGoogleId(googleId)
    if (!user && googleEmail) {
      user = await db.findUserByEmail(googleEmail)
      if (user) {
        await db.linkGoogleId(user.id, googleId)
        user = await db.findUserById(user.id)
      }
    }
    let isNew = false
    if (!user) {
      if (intent === 'login' || !memberType) {
        return res.redirect('/login.html?google_error=' + encodeURIComponent('처음 이용하시는 경우 회원가입(가입 유형 선택)을 먼저 진행해주세요.') + (nextUrl !== '/' ? '&next=' + encodeURIComponent(nextUrl) : ''))
      }
      user = await db.createGoogleUser(googleId, googleEmail, googleName, googlePicture, memberType || 'student')
      isNew = true
    } else {
      const profileUpdate = {}
      if (googlePicture && !user.profile_image) profileUpdate.profile_image = googlePicture
      if (googleName && (!user.name || user.name === 'Google 사용자')) profileUpdate.name = googleName
      if (Object.keys(profileUpdate).length) {
        user = await db.updateUserProfile(user.id, profileUpdate)
      }
      if (memberType && !user.member_type) {
        user = await db.completeProfile(user.id, {
          name: user.name,
          email: user.email || googleEmail,
          member_type: memberType,
        })
      }
    }

    if (isNew || !user.profile_complete) {
      const token = signUserToken(user, { profileComplete: false })
      const userJson = encodeURIComponent(JSON.stringify(userPayload(user)))
      return res.redirect(`/onboarding.html?google_token=${token}&google_user=${userJson}&next=${encodeURIComponent(nextUrl)}`)
    }

    const token = signUserToken(user, { profileComplete: true })
    redirectOAuthLogin(res, { token, user, nextUrl, paramPrefix: 'google', welcome: false })
  } catch (err) {
    console.error('Google 로그인 오류:', err)
    res.redirect('/login.html?google_error=' + encodeURIComponent('Google 로그인 중 오류가 발생했습니다.'))
  }
})

router.post('/complete-profile', authMiddleware, async (req, res) => {
  const { name, email, phone, address, marketing_agreed, member_type } = req.body
  if (!name || String(name).trim().length < 2) {
    return res.status(400).json({ error: '이름을 2자 이상 입력해주세요.' })
  }
  if (!email || !String(email).includes('@')) {
    return res.status(400).json({ error: '이메일을 입력해주세요.' })
  }
  const phoneDigits = String(phone || '').replace(/\D/g, '')
  if (!/^010\d{8}$/.test(phoneDigits)) {
    return res.status(400).json({ error: '휴대폰 번호는 010으로 시작하는 11자리로 입력해주세요.' })
  }
  const normalizedPhone = `${phoneDigits.slice(0, 3)}-${phoneDigits.slice(3, 7)}-${phoneDigits.slice(7)}`
  const normalizedAddress = String(address || '').trim()
  if (normalizedAddress.length < 5) {
    return res.status(400).json({ error: '주소를 5자 이상 입력해주세요.' })
  }
  const current = await db.findUserById(req.user.id)
  if (!current?.member_type && !member_type) {
    return res.status(400).json({ error: '가입 유형(수강생/의뢰인)을 선택해주세요.' })
  }
  if (member_type && !['student', 'client'].includes(member_type)) {
    return res.status(400).json({ error: '올바른 가입 유형을 선택해주세요.' })
  }
  const existing = await db.findUserByEmail(String(email).toLowerCase().trim())
  if (existing && existing.id !== req.user.id) return res.status(409).json({ error: '이미 사용 중인 이메일입니다.' })
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress
  const user = await db.completeProfile(req.user.id, {
    name: String(name).trim(),
    email: String(email).toLowerCase().trim(),
    phone: normalizedPhone,
    address: normalizedAddress,
    marketing_agreed: !!marketing_agreed,
    member_type,
    ip,
  })
  if (!user) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' })

  let coupon = null
  if (marketing_agreed) {
    coupon = await db.createCoupon(user.id, 5000, 'marketing_consent')
    if (phone) {
      try { await sendCouponIssuedMessage(phone, user.name, coupon.code) } catch (e) { console.error('알림톡 오류:', e.message) }
    }
  }

  const token = signUserToken(user, { profileComplete: true })
  res.json({ token, user: clientUser(user), coupon })
})

router.post('/register', async (req, res) => {
  const { email: rawEmail, password, name, member_type, phone, gender, birth_year } = req.body
  const email = (rawEmail || '').toLowerCase().trim()
  if (!email || !password || !name) return res.status(400).json({ error: '모든 항목을 입력해주세요.' })
  if (!member_type || !['student', 'client'].includes(member_type)) {
    return res.status(400).json({ error: '가입 유형(수강생/의뢰인)을 선택해주세요.' })
  }
  if (password.length < 8) return res.status(400).json({ error: '비밀번호는 8자 이상이어야 합니다.' })

  // 전화번호 (010-0000-0000 정규화)
  const phoneDigits = String(phone || '').replace(/\D/g, '')
  if (!/^010\d{8}$/.test(phoneDigits)) {
    return res.status(400).json({ error: '휴대폰 번호는 010으로 시작하는 11자리로 입력해주세요.' })
  }
  const normalizedPhone = `${phoneDigits.slice(0, 3)}-${phoneDigits.slice(3, 7)}-${phoneDigits.slice(7)}`

  // 성별
  if (!['male', 'female'].includes(gender)) {
    return res.status(400).json({ error: '성별을 선택해주세요.' })
  }

  // 출생연도 (4자리, 1900~현재)
  const yearNum = parseInt(birth_year, 10)
  const curYear = new Date().getFullYear()
  if (!yearNum || yearNum < 1900 || yearNum > curYear) {
    return res.status(400).json({ error: '출생연도를 올바르게 선택해주세요.' })
  }
  // 연령대 산출 (예: 1990 → '30~39')
  const ageBucket = Math.floor((curYear - yearNum) / 10) * 10
  const ageRange = `${ageBucket}~${ageBucket + 9}`

  const entry = verificationCodes.get(email)
  if (!entry || !entry.verified) return res.status(400).json({ error: '이메일 인증이 완료되지 않았습니다.' })
  if (await db.findUserByEmail(email)) return res.status(409).json({ error: '이미 가입된 이메일입니다.' })
  const hash = bcrypt.hashSync(password, 10)
  const user = await db.createUser(email, hash, name, member_type, {
    phone: normalizedPhone,
    gender,
    birth_year: String(yearNum),
    age_range: ageRange,
  })
  verificationCodes.delete(email)
  const token = jwt.sign({ id: user.id, email, name, role: 'student', member_type }, process.env.JWT_SECRET, { expiresIn: '7d' })
  res.json({ token, user: clientUser(user) })
})

router.get('/admin-access', authMiddleware, async (req, res) => {
  const user = await db.findUserById(req.user.id)
  res.json({ allowed: isAllowedAdmin(user) })
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
  res.json({ token, user: clientUser(user) })
})

module.exports = router
