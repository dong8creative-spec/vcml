const admin = require('firebase-admin')
const bcrypt = require('bcryptjs')

// ── Firebase Admin 초기화 ──
if (!admin.apps.length) {
  const serviceAccountPath = require('path').join(__dirname, '../firebase-service-account.json')
  const fs2 = require('fs')
  if (fs2.existsSync(serviceAccountPath)) {
    admin.initializeApp({ credential: admin.credential.cert(require(serviceAccountPath)) })
  } else {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey:  (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      }),
    })
  }
}

const fs = admin.firestore()
fs.settings({ databaseId: process.env.FIREBASE_DATABASE_ID || 'vcmlmembers' })

// ── 인메모리 TTL 캐시 ──
// Vercel 서버리스: 인스턴스가 살아있는 동안 캐시 유지. 콜드 스타트 후엔 자동 갱신.
const _cache = new Map()
function cacheGet(key) {
  const entry = _cache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) { _cache.delete(key); return null }
  return entry.value
}
function cacheSet(key, value, ttlMs) {
  _cache.set(key, { value, expiresAt: Date.now() + ttlMs })
}
function cacheInvalidate(...keys) {
  keys.forEach(k => {
    if (String(k).endsWith('*')) {
      const prefix = String(k).slice(0, -1)
      for (const key of _cache.keys()) {
        if (key.startsWith(prefix)) _cache.delete(key)
      }
      return
    }
    _cache.delete(k)
  })
}
const TTL = {
  COURSES: 30_000,       // 강의 목록 30초
  COURSE_SLUG: 60_000,   // 강의 상세 1분
  HERO: 5 * 60_000,      // 히어로 5분
  FOOTER: 5 * 60_000,    // 푸터 5분
  TEST_ROOM: 5 * 60_000, // 테스트룸 플로팅 버튼 5분
  HOMEPAGE: 5 * 60_000,  // 홈페이지 레이아웃 5분
  DASHBOARD: 60_000,     // 관리자 대시보드 1분
  STATS: 60_000,         // 통계 1분
  INSTRUCTORS: 5 * 60_000,
  FAQS: 10 * 60_000,
}

const CLIENT_COURSE_REWARD_AMOUNT = 10000
const CLIENT_COURSE_REWARD_COUNT = 10
const CLIENT_COURSE_REWARD_MIN_COURSE_PRICE = 200000
const CLIENT_PROJECT_COUPON_MIN_AMOUNT = 30000
const CLIENT_COURSE_REWARD_REASON = 'client_course_reward'
const CLIENT_COURSE_REWARD_EXPIRY_MONTHS = 3
const ANTICIPATION_COUPON_REASON = 'anticipation_review'
const ANTICIPATION_DISCOUNT_PERCENT = 10
const ANTICIPATION_MIN_LENGTH = 20
const ANTICIPATION_MAX_LENGTH = 150
const COURSE_REVIEW_FIVE_STAR_REASON = 'course_review_five_star'
const COURSE_REVIEW_FIVE_STAR_DISCOUNT_PERCENT = 10
const STACKABLE_COURSE_COUPON_REASONS = [ANTICIPATION_COUPON_REASON, COURSE_REVIEW_FIVE_STAR_REASON]
const TIMED_PERCENT_COUPON_REASONS = new Set(STACKABLE_COURSE_COUPON_REASONS)

function addOneMonthFrom(iso) {
  return addMonthsFrom(iso, 1)
}

function addMonthsFrom(iso, months) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  d.setMonth(d.getMonth() + months)
  return d.toISOString()
}

function getClientCourseRewardExpiresAt(coupon) {
  if (!coupon || coupon.reason !== CLIENT_COURSE_REWARD_REASON) return null
  return coupon.expires_at || (coupon.created_at ? addMonthsFrom(coupon.created_at, CLIENT_COURSE_REWARD_EXPIRY_MONTHS) : null)
}

function isClientCourseRewardCouponExpired(coupon, atMs = Date.now()) {
  const exp = getClientCourseRewardExpiresAt(coupon)
  if (!exp) return false
  return atMs > new Date(exp).getTime()
}

function getTimedPercentCouponExpiresAt(coupon) {
  if (!coupon || !TIMED_PERCENT_COUPON_REASONS.has(coupon.reason)) return null
  return coupon.expires_at || (coupon.created_at ? addOneMonthFrom(coupon.created_at) : null)
}

function isTimedPercentCouponExpired(coupon, atMs = Date.now()) {
  const exp = getTimedPercentCouponExpiresAt(coupon)
  if (!exp) return false
  return atMs > new Date(exp).getTime()
}
const EDITOR_FEATURED_REASON = 'editor_featured'
const EDITOR_FEATURED_DAYS = 7
const COUPON_USED_CONTEXT = {
  COURSE_ORDER: 'course_order',
  CLIENT_PROJECT: 'client_project',
  EDITOR_FEATURED: 'editor_featured',
}
const COUPON_USED_CONTEXT_LABELS = {
  course_order: '강의 결제',
  client_project: '클라이언츠 견적',
  editor_featured: '에디터 상위노출',
  unknown: '기타',
}
const COUPON_REASON_LABELS = {
  anticipation_review: '강의 기대평',
  course_review_five_star: '수강 후기 5점',
  marketing_consent: '마케팅 동의',
  client_course_reward: '의뢰인 수강 혜택',
  editor_featured: '에디터 승인 혜택',
  editor_apply_featured: '에디터 승격 혜택',
}
const DEFAULT_COUPON_ISSUANCE_CONFIG = {
  anticipation_review: {
    source_label: '강의 기대평 작성',
    route_label: '강의 상세 > 기대평 작성',
    benefit_label: '최초 강의 결제 10% 할인',
  },
  course_review_five_star: {
    source_label: '수강 후기 5점 작성',
    route_label: '마이페이지 > 내 강의 > 후기 작성',
    benefit_label: '기대평 쿠폰과 중첩 10% 할인',
  },
  marketing_consent: {
    source_label: '마케팅 수신 동의',
    route_label: '회원가입 > 프로필 완료',
    benefit_label: '5,000원 할인',
  },
  client_course_reward: {
    source_label: '의뢰인 수강 혜택',
    route_label: '강의 결제 완료',
    benefit_label: '3만원 이상 의뢰 시 1만원 할인 · 발급 후 3개월',
  },
  editor_featured: {
    source_label: '에디터 승인 혜택',
    route_label: '관리자 승인',
    benefit_label: '상위노출 7일',
  },
  editor_apply_featured: {
    source_label: '에디터 승격 혜택',
    route_label: '에디터즈 프로그램 승격',
    benefit_label: '상위노출 7일',
  },
}
const EDITOR_APPLY_FEATURED_REASON = 'editor_apply_featured'
const EDITOR_APPLY_FEATURED_AMOUNT = 20000
const EDITOR_APPLY_FEATURED_COUNT = 5
const EDITOR_WORKBOOK_FAIL_COOLDOWN_DAYS = 5
const EDITOR_WORKBOOK_STAGE_MINUTES = 40
const EDITOR_PROGRAM_TERMS_VERSION = '2'
const EDITOR_WORK_TYPES = ['remote', 'hybrid', 'onsite', 'project', 'fulltime']

const DEFAULT_EDITOR_PROGRAM_STAGES = [
  { order: 1, title: '오리엔테이션', mail_count: 1, minutes: 40 },
  { order: 2, title: '기초 실전', mail_count: 3, minutes: 40 },
  { order: 3, title: '심화 챌린지', mail_count: 9, minutes: 40 },
  { order: 4, title: '색보정·톤', mail_count: 1, minutes: 40 },
  { order: 5, title: '오디오·납품', mail_count: 1, minutes: 40 },
  { order: 6, title: 'AI·브랜드', mail_count: 1, minutes: 40 },
  { order: 7, title: '실무 납품', mail_count: 1, minutes: 40 },
  { order: 8, title: '브랜드필름', mail_count: 1, minutes: 40 },
  { order: 9, title: '포트폴리오 준비', mail_count: 1, minutes: 40 },
  { order: 10, title: '최종 심사', mail_count: 1, minutes: 40 },
]

const DEFAULT_EDITOR_GUIDE_CARDS = [
  {
    icon: '🎬',
    title: '프로그램이란?',
    body: '타닥클래스 <strong>에디터즈 선발 프로그램</strong>은 실전 클라이언트 의뢰 메일을 순서대로 완료하는 과정입니다.\n\n모든 단계를 통과하면 <strong>에디터즈 신청 자격</strong>이 부여됩니다.',
  },
  {
    icon: '📬',
    title: '진행 방식',
    body: '• 안내 카드를 모두 확인하고 <strong>동의</strong>하면 의뢰 메일함이 열립니다.\n• 메일은 <strong>한 통씩</strong> 순서대로만 공개됩니다.\n• 메일을 열면 해당 단계의 제한 시간이 시작됩니다.\n• 단계마다 메일 개수가 다를 수 있습니다 (예: 1개 → 3개 → 9개).\n• <strong>10단계</strong>를 모두 완료하면 최종 신청서를 작성할 수 있습니다.',
  },
  {
    icon: '⏱️',
    title: '시간 제한 · 탈락 정책',
    body: '각 메일을 연 순간부터 제한 시간이 시작됩니다. 브라우저를 닫아도 서버 시간 기준으로 계속 흐릅니다.\n\n<strong>⚠️ 시간 초과 시 자동 탈락</strong>\n제한 시간 내 업로드·통과에 실패하면 <strong>모든 진행 기록이 초기화</strong>됩니다. 처음부터 다시 안내 확인 · 동의 후 시작해야 합니다.',
  },
  {
    icon: '📤',
    title: '납품 규칙',
    body: '• 과제 결과물은 <strong>유튜브</strong> 링크만 제출 가능합니다.\n• 공개 설정은 반드시 <strong>일부공개</strong>여야 합니다.\n• 작업 설명에 「일부공개」 적용 사실을 명시해주세요.\n• 미션 요구사항(길이·비율·키워드 등)을 작업 설명에 반영해야 통과됩니다.',
  },
  {
    icon: '✅',
    title: '유의 사항 · 최종 동의',
    body: '• 허위 제출·타인 작업물 제출 시 선발에서 제외될 수 있습니다.\n• 통과한 메일마다 <strong>금장 배지</strong>가 부여됩니다.\n• 아직 열리지 않은 메일은 제목·발신자가 표시되지 않습니다.',
  },
]

const DEFAULT_EDITOR_PROGRAM_CONFIG = {
  terms_version: EDITOR_PROGRAM_TERMS_VERSION,
  stage_count: 10,
  stages: DEFAULT_EDITOR_PROGRAM_STAGES,
  guide_cards: DEFAULT_EDITOR_GUIDE_CARDS,
}

function normalizeCouponIssuanceConfig(data = {}) {
  const base = JSON.parse(JSON.stringify(DEFAULT_COUPON_ISSUANCE_CONFIG))
  for (const key of Object.keys(base)) {
    const row = data[key]
    if (!row || typeof row !== 'object') continue
    if (row.source_label != null) base[key].source_label = String(row.source_label).trim().slice(0, 80) || base[key].source_label
    if (row.route_label != null) base[key].route_label = String(row.route_label).trim().slice(0, 120) || base[key].route_label
    if (row.benefit_label != null) base[key].benefit_label = String(row.benefit_label).trim().slice(0, 120) || base[key].benefit_label
  }
  return base
}

function normalizeEditorProgramConfig(raw) {
  const stages = (raw?.stages?.length ? raw.stages : DEFAULT_EDITOR_PROGRAM_STAGES)
    .slice(0, 10)
    .map((s, i) => ({
      order: i + 1,
      title: String(s.title || `${i + 1}단계`).trim(),
      mail_count: Math.max(1, Math.min(20, parseInt(s.mail_count, 10) || 1)),
      minutes: Math.max(5, Math.min(180, parseInt(s.minutes, 10) || EDITOR_WORKBOOK_STAGE_MINUTES)),
    }))
  while (stages.length < 10) {
    stages.push({
      order: stages.length + 1,
      title: `${stages.length + 1}단계`,
      mail_count: 1,
      minutes: EDITOR_WORKBOOK_STAGE_MINUTES,
    })
  }
  const guide_cards = (raw?.guide_cards?.length ? raw.guide_cards : DEFAULT_EDITOR_GUIDE_CARDS)
    .map(c => ({
      icon: String(c.icon || '📋').trim(),
      title: String(c.title || '').trim(),
      body: String(c.body || '').trim(),
    }))
    .filter(c => c.title && c.body)
  return {
    terms_version: String(raw?.terms_version || EDITOR_PROGRAM_TERMS_VERSION),
    stage_count: 10,
    stages,
    guide_cards: guide_cards.length ? guide_cards : DEFAULT_EDITOR_GUIDE_CARDS,
    updated_at: raw?.updated_at || null,
  }
}

function getTotalMailCountFromConfig(config) {
  return config.stages.reduce((sum, s) => sum + s.mail_count, 0)
}

function buildWorkbookSlotMap(config) {
  const slots = []
  for (const stage of config.stages) {
    for (let p = 1; p <= stage.mail_count; p++) {
      slots.push({
        order_num: slots.length + 1,
        stage_num: stage.order,
        position_in_stage: p,
        stage_title: stage.title,
        stage_minutes: stage.minutes,
      })
    }
  }
  return slots
}

function getStageConfigForWorkbook(workbook, config) {
  if (!workbook) return null
  return config.stages.find(s => s.order === workbook.stage_num) || null
}

function getWorkbookStageMinutes(workbook, config) {
  return getStageConfigForWorkbook(workbook, config)?.minutes || EDITOR_WORKBOOK_STAGE_MINUTES
}

function isWorkbookCooldownActive(lockedUntil) {
  if (!lockedUntil) return false
  return new Date(lockedUntil).getTime() > Date.now()
}

function workbookCooldownUntil(days = EDITOR_WORKBOOK_FAIL_COOLDOWN_DAYS) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString()
}

function resolveWorkbookItemState(sub, unlocked, { isActiveStage = false, withinTimer = false, stageNotStarted = false } = {}) {
  if (sub?.status === 'passed') {
    return { status: 'passed', can_submit: false, locked_until: null }
  }
  if (!unlocked) {
    return { status: 'locked', can_submit: false, locked_until: null }
  }
  if (isActiveStage && (withinTimer || stageNotStarted)) {
    return { status: sub?.status === 'failed' ? 'retry' : 'available', can_submit: withinTimer, locked_until: null }
  }
  if (sub?.status === 'failed' && isWorkbookCooldownActive(sub.locked_until)) {
    return { status: 'cooldown', can_submit: false, locked_until: sub.locked_until }
  }
  if (isActiveStage && !withinTimer && !stageNotStarted) {
    return { status: 'locked', can_submit: false, locked_until: null }
  }
  return { status: 'locked', can_submit: false, locked_until: null }
}

function getActiveWorkbookForProgram(workbooks, submissions) {
  const sorted = [...workbooks].sort((a, b) => a.order_num - b.order_num)
  for (const wb of sorted) {
    const unlocked = wb.order_num <= 1 || submissions.some(
      s => s.workbook_id === sorted.find(w => w.order_num === wb.order_num - 1)?.id && s.status === 'passed'
    )
    if (!unlocked) return null
    const sub = submissions.find(s => s.workbook_id === wb.id)
    if (sub?.status !== 'passed') return wb
  }
  return null
}

function stageDeadlineIso(stageStartedAt, minutes = EDITOR_WORKBOOK_STAGE_MINUTES) {
  if (!stageStartedAt) return null
  return new Date(new Date(stageStartedAt).getTime() + minutes * 60 * 1000).toISOString()
}

function isStageWithinTimer(stageStartedAt, minutes = EDITOR_WORKBOOK_STAGE_MINUTES) {
  if (!stageStartedAt) return false
  return Date.now() < new Date(stageStartedAt).getTime() + minutes * 60 * 1000
}

function getStageCompletionStatus(config, workbooks, submissions) {
  return config.stages.map(stage => {
    const mails = workbooks.filter(w => w.stage_num === stage.order)
    const passedInStage = mails.filter(w =>
      submissions.some(s => s.workbook_id === w.id && s.status === 'passed')
    ).length
    return {
      order: stage.order,
      title: stage.title,
      mail_count: stage.mail_count,
      passed: passedInStage,
      minutes: stage.minutes,
      is_complete: mails.length > 0 && passedInStage >= stage.mail_count,
    }
  })
}

function countCompletedStages(stageStatuses) {
  return stageStatuses.filter(s => s.is_complete).length
}

function getVisibleWorkbooks(workbooks, submissions, active) {
  const passedIds = new Set(submissions.filter(s => s.status === 'passed').map(s => s.workbook_id))
  return workbooks.filter(w => passedIds.has(w.id) || (active && w.id === active.id))
}

function sanitizeWorkbookListItem(wb, state, { isActiveStage, visible, stageInfo }) {
  const base = {
    id: wb.id,
    order_num: wb.order_num,
    stage_num: wb.stage_num,
    position_in_stage: wb.position_in_stage,
    stage_title: stageInfo?.title || null,
    mission_title: visible || state.status === 'passed' ? wb.mission_title : null,
    status: state.status,
    can_submit: state.can_submit,
    locked_until: state.locked_until,
    is_active_stage: isActiveStage,
    submission: state.submission,
    unlocked: visible,
  }
  if (!visible && state.status !== 'passed') {
    return {
      ...base,
      from_name: null,
      from_company: null,
      subject: null,
      received_at: null,
      hidden: true,
    }
  }
  return {
    ...base,
    from_name: wb.from_name,
    from_company: wb.from_company,
    subject: wb.subject,
    received_at: wb.received_at,
    hidden: false,
  }
}

function evaluateWorkbookSubmission(workbook, submission) {
  const notes = String(submission.work_notes || '').trim()
  const url = String(submission.deliverable_url || '').trim()
  if (!/^https?:\/\/.+/i.test(url)) {
    return { passed: false, feedback: '납품 링크(URL)를 https:// 형식으로 입력해주세요.' }
  }
  if (!/^https?:\/\/(www\.)?(youtube\.com\/(watch|shorts|live)|youtu\.be\/)/i.test(url)) {
    return { passed: false, feedback: '과제는 유튜브에 업로드한 링크만 제출할 수 있습니다. (youtube.com 또는 youtu.be)' }
  }
  if (!/일부공개|unlisted/i.test(notes)) {
    return { passed: false, feedback: '유튜브 공개 설정을 「일부공개」로 적용했음을 작업 설명에 명시해주세요.' }
  }
  const minLen = workbook.min_note_length || 50
  if (notes.length < minLen) {
    return { passed: false, feedback: `작업 설명을 ${minLen}자 이상 작성해주세요. (현재 ${notes.length}자)` }
  }
  const keywords = workbook.required_keywords || []
  const missing = keywords.filter(kw => !notes.includes(kw))
  if (missing.length) {
    return { passed: false, feedback: `작업 설명에 미션 요구사항을 반영해주세요: ${missing.join(', ')}` }
  }
  const badgeMsg = workbook.pass_message || '미션 통과! 수고하셨습니다.'
  return { passed: true, feedback: `${badgeMsg} 🏅 금장 배지를 획득했습니다.` }
}

const EDITOR_WORKBOOK_SEED = [
  {
    slug: 'wb-shorts-hook',
    order_num: 1,
    from_name: '김지영',
    from_email: 'jiyoung@fitstudio.kr',
    from_company: '핏스튜디오',
    subject: '[의뢰] 유튜브 쇼츠 30초 편집 부탁드립니다',
    received_at: '2026-06-10T09:14:00',
    body: `안녕하세요, 편집자님.\n\n핏스튜디오 마케팅팀 김지영입니다.\n헬스장 홍보용 쇼츠 영상 원본(약 2분)을 보내드립니다.\n\n■ 요청 사항\n- 30초 내외로 압축 편집\n- 첫 3초에 시선을 끄는 훅(질문형 자막 또는 임팩트 컷)\n- 세로 9:16, 유튜브 쇼츠 업로드용\n- BGM은 저작권 프리, 템포감 있게\n\n■ 원본 소스\n구글 드라이브: https://drive.google.com/example/fitstudio-raw\n\n■ 납품\n구글 드라이브 또는 유튜브 미등록(unlisted) 링크로 보내주세요.\n\n감사합니다.\n김지영 드림`,
    mission_title: '30초 쇼츠 + 3초 훅',
    mission_brief: '원본에서 30초 내외 쇼츠 1편을 편집하고, 첫 3초 훅 전략을 작업 설명에 적어 제출하세요.',
    min_note_length: 50,
    required_keywords: ['30초', '9:16'],
    pass_message: '✅ 미션 통과! 김지영 클라이언트의 쇼츠 의뢰를 성공적으로 처리했습니다.',
  },
  {
    slug: 'wb-vertical-reframe',
    order_num: 2,
    from_name: '박민수',
    from_email: 'minsu.park@cafe-rove.com',
    from_company: '카페 로브',
    subject: '가로 영상 → 인스타 릴스(세로) 변환 의뢰',
    received_at: '2026-06-11T11:02:00',
    body: `편집자님, 안녕하세요.\n카페 로브 대표 박민수입니다.\n\n인스타그램 릴스용으로 가로(16:9)로 촬영한 카페 브이로그 원본이 있습니다.\n세로 9:16로 리프레이밍하고, 인물·음료가 잘리지 않게 구도를 잡아주세요.\n\n■ 길이: 20~25초\n■ 자막: 핵심 메뉴명 1~2개만 하단에\n■ 톤: 따뜻하고 감성적인 색감\n\n원본: https://drive.google.com/example/cafe-rove-h\n\n일정 여유 있으시면 답장 부탁드립니다.`,
    mission_title: '16:9 → 9:16 리프레이밍',
    mission_brief: '가로 원본을 세로 9:16 릴스용으로 재구도한 20~25초 영상을 제출하세요.',
    min_note_length: 50,
    required_keywords: ['9:16', '리프레이밍'],
    pass_message: '✅ 미션 통과! 세로 리프레이밍 역량이 확인되었습니다.',
  },
  {
    slug: 'wb-caption-style',
    order_num: 3,
    from_name: '이수진',
    from_email: 'sujin.lee@studywithme.io',
    from_company: '스터디윗미',
    subject: '강의 클립 자막 스타일링 의뢰 (가독성 중요)',
    received_at: '2026-06-12T14:30:00',
    body: `안녕하세요, 스터디윗미 콘텐츠팀 이수진입니다.\n\n온라인 강의 하이라이트 45초 클립에 자막을 입혀주세요.\n\n■ 자막 요구\n- 말하는 키워드는 강조색(노랑 또는 브랜드 컬러)\n- 한 화면 2줄 이내, 모바일 가독성 최우선\n- 말 더듬·군더더기 구간은 컷 편집 OK\n\n■ 포맷: 9:16, 1080×1920\n원본: https://drive.google.com/example/study-clip\n\n자막 폰트명과 강조 방식을 작업 설명에 꼭 적어주세요.`,
    mission_title: '자막 스타일링 + 가독성',
    mission_brief: '45초 클립에 자막을 적용하고, 폰트·강조 방식을 설명과 함께 제출하세요.',
    min_note_length: 50,
    required_keywords: ['자막', '가독성'],
    pass_message: '✅ 미션 통과! 자막 스타일링 미션을 클리어했습니다.',
  },
  {
    slug: 'wb-reels-tempo',
    order_num: 4,
    from_name: '최하늘',
    from_email: 'haneul@glowny.beauty',
    from_company: '글로니 뷰티',
    subject: '[릴스] 신제품 런칭 15초 3편 시리즈 편집',
    received_at: '2026-06-13T10:08:00',
    body: `편집자님, 글로니 뷰티 마케터 최하늘입니다.\n\n신제품 립틴트 런칭 릴스 15초 1편(시리즈 중 1편만 먼저 테스트) 편집 부탁드립니다.\n\n■ 편집 템포\n- 1~2초 단위 빠른 컷\n- 제품 클로즈업 + 사용 샷 교차\n- 마지막 2초 CTA 자막 「지금 구매」\n\n■ 레퍼런스\nhttps://instagram.com/example/reels-ref\n\n■ 원본\nhttps://drive.google.com/example/glowny-raw\n\n15초 ±1초, 9:16로 납품 부탁드립니다.`,
    mission_title: '15초 릴스 템포 편집',
    mission_brief: '15초 내외, 1~2초 컷 템포의 릴스 1편을 제출하고 CTA 처리 방식을 설명하세요.',
    min_note_length: 50,
    required_keywords: ['15초', 'CTA'],
    pass_message: '✅ 미션 통과! 릴스 템포 편집 역량이 확인되었습니다.',
  },
  {
    slug: 'wb-color-grade',
    order_num: 5,
    from_name: '정우빈',
    from_email: 'woobin@moment-wedding.com',
    from_company: '모먼트웨딩',
    subject: '웨딩 하이라이트 색보정 통일 요청',
    received_at: '2026-06-14T16:45:00',
    body: `안녕하세요, 모먼트웨딩 정우빈입니다.\n\n야외·실내 촬영 클립 3개를 하나의 웨딩 하이라이트(60초)로 엮었는데,\n장면마다 색감·노출이 달라 보입니다.\n\n■ 요청\n- 3개 클립 색감·화이트밸런스 통일\n- 따뜻하고 고급스러운 웨딩 톤\n- Before/After 비교 가능하면 best\n\n원본 프로젝트/클립: https://drive.google.com/example/wedding-clips\n\n사용하신 LUT 또는 프리셋명을 작업 설명에 적어주세요.`,
    mission_title: '색보정·톤 통일',
    mission_brief: '다른 조건의 클립 색감을 통일한 결과물을 제출하고, LUT/프리셋을 설명하세요.',
    min_note_length: 50,
    required_keywords: ['색보정', 'LUT'],
    pass_message: '✅ 미션 통과! 색보정 미션을 통과했습니다.',
  },
  {
    slug: 'wb-audio-balance',
    order_num: 6,
    from_name: '한소희',
    from_email: 'sohee@podlab.fm',
    from_company: '팟랩',
    subject: '팟캐스트 클립 BGM·보이스 밸런스 정리',
    received_at: '2026-06-15T08:20:00',
    body: `편집자님, 팟랩 한소희입니다.\n\n팟캐스트 1분 하이라이트 클립을 숏폼용으로 편집해주세요.\n\n■ 오디오\n- 보이스 음량 정규화\n- BGM은 보이스에 묻히지 않게(ducking)\n- 「음」 「어」 구간 가볍게 컷 OK\n\n■ 영상\n- 9:16, 웨이브폼 또는 자막으로 분위기 살리기\n\n원본: https://drive.google.com/example/podlab-audio\n\nBGM 볼륨 비율(예: 보이스 대비 -18dB)을 설명에 적어주세요.`,
    mission_title: '오디오·BGM 밸런스',
    mission_brief: '1분 클립의 보이스·BGM 밸런스를 정리하고, 볼륨 설정을 설명하세요.',
    min_note_length: 50,
    required_keywords: ['BGM', 'dB'],
    pass_message: '✅ 미션 통과! 오디오 밸런스 처리 능력이 확인되었습니다.',
  },
  {
    slug: 'wb-brand-film',
    order_num: 8,
    from_name: '서예린',
    from_email: 'yerin@pureskin.co.kr',
    from_company: '퓨어스킨',
    subject: '[세로 브랜드필름] 15초 광고형 편집 의뢰',
    received_at: '2026-06-17T15:10:00',
    body: `편집자님, 퓨어스킨 브랜드팀 서예린입니다.\n\n세로 브랜드필름 15초 1편 편집 부탁드립니다.\n\n■ 구성\n- 0~3초: 브랜드 로고 + 슬로건\n- 3~12초: 제품·모델 컷\n- 12~15초: CTA 「공식몰 20% OFF」\n\n■ 톤: 클린·미니멀·밝은 화이트 톤\n■ 해상도: 1080×1920\n\n에셋: https://drive.google.com/example/pureskin-assets\n\nCTA 문구와 납품 해상도를 설명에 포함해주세요.`,
    mission_title: '15초 세로 브랜드필름',
    mission_brief: '15초 세로 브랜드필름을 제출하고 CTA·해상도(1080×1920)를 설명하세요.',
    min_note_length: 50,
    required_keywords: ['1080', 'CTA'],
    pass_message: '✅ 미션 통과! 브랜드필름 편집 미션을 클리어했습니다.',
  },
  {
    slug: 'wb-delivery-pack',
    order_num: 9,
    from_name: '강민재',
    from_email: 'minjae@mediaflow.agency',
    from_company: '미디어플로우',
    subject: '납품 파일 구조·네이밍 규칙 맞춰 전달 요청',
    received_at: '2026-06-18T09:40:00',
    body: `편집자님, 미디어플로우 프로듀서 강민재입니다.\n\n클라이언트 납품용으로 아래 규칙에 맞춰 최종 파일을 정리해주세요.\n\n■ 폴더 구조\n프로젝트명/\n  ├─ 01_Project/\n  ├─ 02_Assets/\n  └─ 03_Export/\n\n■ Export\n- 파일명: 프로젝트명_v1_YYYYMMDD.mp4\n- H.264, 1080×1920, 30fps\n\n■ 함께 제출\n- export 설정 스크린샷 1장(링크)\n- 폴더 구조 스크린샷 1장(링크)\n\n이번 미션은 「정리된 납품」이 핵심입니다.\n설명에 v1 네이밍과 export 프리셋을 적어주세요.`,
    mission_title: '납품·파일 정리',
    mission_brief: '납품 규칙에 맞춘 export 파일과 설정·폴더 스크린샷 링크를 제출하세요.',
    min_note_length: 50,
    required_keywords: ['v1', 'Export'],
    pass_message: '✅ 미션 통과! 실무 납품 규칙을 이해하고 있습니다.',
  },
  {
    slug: 'wb-portfolio-pack',
    order_num: 10,
    from_name: '타닥클래스',
    from_email: 'editors@tadakclass.com',
    from_company: '타닥클래스',
    subject: '[최종] 에디터즈 포트폴리오 패키지 제출',
    received_at: '2026-06-19T17:00:00',
    body: `안녕하세요, 타닥클래스 에디터즈 운영팀입니다.\n\n지금까지 처리하신 의뢰 미션 중 **2편 이상**을 모아\n포트폴리오 페이지(Notion, Google Drive, 유튜브 unlisted 등)로 정리해주세요.\n\n■ 포함 내용\n- 대표 작업 2~3편 링크\n- 가능 작업 유형(쇼츠·릴스·색보정 등) 한 줄 소개\n- 사용 툴(CapCut, Premiere 등)\n\n■ 포지셔닝\n「어떤 클라이언트의 어떤 문제를 해결하는 편집자인지」50자 내외\n\n이 메일을 통과하시면 에디터즈 신청 자격이 부여됩니다.\n\n화이팅입니다!`,
    mission_title: '포트폴리오 패키징 (최종)',
    mission_brief: '미션 결과물 2편 이상을 담은 포트폴리오 URL과 50자 내외 포지셔닝을 제출하세요.',
    min_note_length: 50,
    required_keywords: ['포트폴리오', '툴'],
    pass_message: '🎉 최종 미션 통과! 에디터즈 신청 자격이 부여되었습니다.',
  },
]

const CLIENT_COUPON_FAQ_SEED_KEY = 'client_course_coupon'
const CLIENT_COUPON_FAQ = {
  question: '의뢰인 강의 수강 쿠폰은 어떻게 받고 사용하나요?',
  answer: `회원 유형이 의뢰인인 경우에만 발급·사용할 수 있는 혜택입니다. (기대평·수강 후기 쿠폰과 별도)

발급 조건
· 20만원 이상 유료 강의를 결제·수강하면 1만원 할인쿠폰 10장이 한 번에 발급됩니다. (강의당 1회)

사용 방법
· 발급된 10장 중 원하는 시점에 임의로 사용할 수 있습니다.
· 클라이언츠 의뢰에서 에디터 견적을 수락할 때 쿠폰 적용 여부를 선택하면, 해당 의뢰비에서 1만원이 할인됩니다. (견적 1건당 쿠폰 1장)

유효기간
· 발급일로부터 3개월 이내에만 사용할 수 있습니다.

보유 내역은 마이페이지 → 내 쿠폰에서 확인할 수 있습니다.`,
  category: '쿠폰',
  is_public: true,
  sort_order: 7,
}

async function seedClientCouponFaq() {
  const snap = await fs.collection('faqs').where('seed_key', '==', CLIENT_COUPON_FAQ_SEED_KEY).limit(1).get()
  const data = { ...CLIENT_COUPON_FAQ, seed_key: CLIENT_COUPON_FAQ_SEED_KEY, updated_at: now() }
  if (snap.empty) {
    await fs.collection('faqs').add({ ...data, created_at: now() })
  } else {
    await snap.docs[0].ref.set(data, { merge: true })
  }
}

async function seedInstructorsIntroDefaults() {
  const doc = await fs.collection('site_settings').doc('instructors_intro').get()
  if (doc.exists) return
  await fs.collection('site_settings').doc('instructors_intro').set({
    ...normalizeInstructorsIntro({}),
    updated_at: now(),
  })
}

async function seedEditorWorkbooks() {
  for (const wb of EDITOR_WORKBOOK_SEED) {
    const snap = await fs.collection('editor_workbooks').where('slug', '==', wb.slug).limit(1).get()
    if (snap.empty) {
      await fs.collection('editor_workbooks').add({ ...wb, created_at: now() })
    } else {
      await snap.docs[0].ref.set({ ...wb, updated_at: now() }, { merge: true })
    }
  }
  await db.ensureEditorProgramConfig()
  await db.syncWorkbookSlotsFromConfig()
}

function buildWorkbookFromTemplate(template, slot) {
  const variant = slot.order_num > EDITOR_WORKBOOK_SEED.length
  return {
    slug: variant ? `wb-slot-${slot.order_num}` : template.slug,
    order_num: slot.order_num,
    stage_num: slot.stage_num,
    position_in_stage: slot.position_in_stage,
    from_name: template.from_name,
    from_email: template.from_email,
    from_company: template.from_company,
    subject: variant
      ? `[${slot.stage_num}단계-${slot.position_in_stage}] ${template.subject}`
      : template.subject,
    received_at: template.received_at,
    body: variant
      ? `${template.body}\n\n— ${slot.stage_title} · 메일 ${slot.position_in_stage}/${slot.stage_mail_count || slot.position_in_stage}`
      : template.body,
    mission_title: variant ? `${template.mission_title} (${slot.stage_num}-${slot.position_in_stage})` : template.mission_title,
    mission_brief: template.mission_brief,
    min_note_length: template.min_note_length,
    required_keywords: template.required_keywords,
    pass_message: template.pass_message,
  }
}

function isEditorFeaturedCoupon(coupon) {
  const reason = coupon?.reason || coupon?.coupon_type
  return reason === EDITOR_FEATURED_REASON || reason === EDITOR_APPLY_FEATURED_REASON
}

function userPayload(user) {
  if (!user) return null
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    member_type: user.member_type || 'student',
    phone: user.phone || null,
    address: user.address || null,
    bio: user.bio || '',
    profile_image: user.profile_image || null,
    social_links: Array.isArray(user.social_links) ? user.social_links : [],
  }
}

function nextId() {
  return fs.collection('_').doc().id
}

function now() {
  return new Date().toISOString()
}

async function deleteFirestoreDocs(docsOrRefs) {
  const refs = docsOrRefs.map(d => (d.ref ? d.ref : d))
  if (!refs.length) return 0
  let deleted = 0
  for (let i = 0; i < refs.length; i += 500) {
    const batch = fs.batch()
    refs.slice(i, i + 500).forEach(ref => batch.delete(ref))
    await batch.commit()
    deleted += Math.min(500, refs.length - i)
  }
  return deleted
}

// ── 시드 데이터 (최초 1회) ──
async function seed() {
  const snap = await fs.collection('courses').limit(1).get()
  if (!snap.empty) return

  const pw = bcrypt.hashSync('admin1234', 10)
  await fs.collection('users').add({ email: 'admin@tadakclass.com', password: pw, name: '관리자', role: 'admin', member_type: 'student', profile_complete: true, marketing_agreed: 0, phone: null, created_at: now() })

  const { COURSES } = require('./course-catalog')
  const courses = COURSES

  const chapterDefs = {
    'after-effects': [
      { t:'After Effects 인터페이스와 핵심 개념', d:'18분', free:1 },
      { t:'키프레임 애니메이션 — 위치·크기·불투명도', d:'35분', free:1 },
      { t:'텍스트 애니메이션과 타이포그래피 모션', d:'42분', free:0 },
      { t:'마스크·트랙 매트·블렌딩 모드 활용', d:'38분', free:0 },
      { t:'익스프레션 기초 — wiggle·loopOut 실전 사용', d:'45분', free:0 },
      { t:'3D 레이어와 카메라 연출', d:'50분', free:0 },
      { t:'실전 프로젝트 — 방송용 오프닝 타이틀 제작', d:'60분', free:0 },
    ],
    'youtube-production': [
      { t:'유튜브 채널 기획과 콘셉트 잡기', d:'20분', free:1 },
      { t:'스마트폰·보급형 카메라로 퀄리티 높이기', d:'28분', free:1 },
      { t:'유튜브 영상 편집 루틴 — 빠르고 일관성 있게', d:'38분', free:0 },
      { t:'썸네일 디자인 — 클릭을 부르는 공식', d:'30분', free:0 },
      { t:'자막·자동 캡션 활용과 SEO 최적화', d:'25분', free:0 },
      { t:'채널 성장을 위한 데이터 분석과 전략', d:'32분', free:0 },
    ],
  }

  for (const c of courses) {
    const ref = await fs.collection('courses').add({ ...c, created_at: now() })
    const chs = chapterDefs[c.slug] || [
      { t:'강의 소개', d:'10분', free:1 },
      { t:'핵심 내용 1강', d:'30분', free:0 },
      { t:'핵심 내용 2강', d:'35분', free:0 },
    ]
    for (let i = 0; i < chs.length; i++) {
      await fs.collection('chapters').add({ course_id: ref.id, order_num: i+1, title: chs[i].t, duration: chs[i].d, is_free: chs[i].free, video_url: null })
    }
  }
  console.log('✓ Firestore 시드 데이터 완료')
}

function maskPublicName(name) {
  if (!name) return '회원'
  const n = String(name).trim()
  if (n.length <= 1) return n + '**'
  return n[0] + '**'
}

function isPublicReview(review) {
  return review?.is_public === 1 || review?.is_public === true || review?.is_public === '1'
}

function normalizeReviewRating(value, fallback = 0) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.max(1, Math.min(5, n))
}

const DEFAULT_HOMEPAGE_LAYOUT = require('../lib/homepage-layout-defaults')

const DEFAULT_HOMEPAGE_COPY = DEFAULT_HOMEPAGE_LAYOUT.copy
const DEFAULT_HOMEPAGE_CATEGORIES = DEFAULT_HOMEPAGE_LAYOUT.categories

function normalizeHomepageCopy(copy = {}) {
  const base = JSON.parse(JSON.stringify(DEFAULT_HOMEPAGE_COPY))
  for (const key of Object.keys(base)) {
    if (copy[key]) {
      for (const field of Object.keys(base[key])) {
        if (copy[key][field] != null) {
          base[key][field] = String(copy[key][field]).trim().slice(0, field === 'subtitle' ? 200 : 80)
        }
      }
    }
  }
  return base
}

function normalizeCategoryTile(item, fallback) {
  const key = String(item?.key || fallback?.key || '').trim().slice(0, 20)
  return {
    key,
    label: String(item?.label ?? fallback?.label ?? '').trim().slice(0, 60),
    style: String(item?.style ?? fallback?.style ?? key).trim().slice(0, 20),
    image: item?.image !== undefined ? (item.image || null) : (fallback?.image || null),
  }
}

function normalizeHomepageCategories(items) {
  return DEFAULT_HOMEPAGE_CATEGORIES.map(def => {
    const found = Array.isArray(items) ? items.find(c => c.key === def.key) : null
    return normalizeCategoryTile(found || def, def)
  })
}

function normalizeHomepageLayout(data = {}) {
  const layout = {
    sections: { ...DEFAULT_HOMEPAGE_LAYOUT.sections },
    nav: { ...DEFAULT_HOMEPAGE_LAYOUT.nav },
    copy: normalizeHomepageCopy(data.copy || {}),
    categories: normalizeHomepageCategories(data.categories),
    site: { ...DEFAULT_HOMEPAGE_LAYOUT.site },
  }
  if (data.sections) {
    for (const key of Object.keys(layout.sections)) {
      if (data.sections[key] !== undefined) layout.sections[key] = !!data.sections[key]
    }
  }
  if (data.nav) {
    for (const key of Object.keys(layout.nav)) {
      if (data.nav[key] !== undefined) layout.nav[key] = !!data.nav[key]
    }
  }
  if (data.copy) layout.copy = normalizeHomepageCopy({ ...layout.copy, ...data.copy })
  if (data.categories) layout.categories = normalizeHomepageCategories(data.categories)
  if (data.site?.brand_name != null) {
    layout.site.brand_name = String(data.site.brand_name).trim().slice(0, 40) || layout.site.brand_name
  }
  layout.sections.instructors = false
  return layout
}

const DEFAULT_FOOTER_CONFIG = {
  brand_name: '타닥클래스',
  tagline: '현업 전문가에게 배우는 실무 중심 영상 강의',
  columns: [
    {
      title: '강의',
      links: [
        { label: '전체 강의', href: '/#all' },
        { label: '캡컷 PRO', href: '/?cat=capcut#all' },
      ],
    },
    {
      title: '고객지원',
      links: [
        { label: '1:1 문의하기', href: '/inquiry.html' },
        { label: '자주 묻는 질문', href: '/faq.html' },
        { label: '환불 및 취소 정책', href: '/refund.html' },
      ],
    },
    {
      title: '안내',
      links: [
        { label: '공지사항', href: '/notices.html' },
      ],
    },
  ],
  biz_info: [
    '상호명 블루필드매뉴얼픽쳐스 · 대표자 이동헌 · 통신판매업신고 제 2025-부산진-0959 호',
    '사업자등록번호 640-50-00860 · 고객센터 010-4850-6946',
    '주소 부산광역시 부산진구 가야대로 707-2(당감동) · 이메일 dong8creative@gmail.com',
  ],
  copyright: '© 2025 타닥클래스. All rights reserved.',
  policy_links: [
    { label: '개인정보처리방침', href: '/privacy.html', emphasis: true },
    { label: '이용약관', href: '/terms.html' },
    { label: '청소년보호정책', href: '/youth.html' },
    { label: '환불정책', href: '/refund.html' },
  ],
}

function normalizeFooterLink(link) {
  return {
    label: String(link?.label || '').trim().slice(0, 80),
    href: String(link?.href || '#').trim().slice(0, 500),
    emphasis: !!link?.emphasis,
  }
}

function normalizeFooterConfig(data = {}) {
  const base = JSON.parse(JSON.stringify(DEFAULT_FOOTER_CONFIG))
  if (data.brand_name != null) base.brand_name = String(data.brand_name).trim().slice(0, 40) || base.brand_name
  if (data.tagline != null) base.tagline = String(data.tagline).trim().slice(0, 200)
  if (data.biz_info != null) {
    if (Array.isArray(data.biz_info)) {
      base.biz_info = data.biz_info.map(line => String(line || '').trim()).filter(Boolean)
    } else {
      base.biz_info = String(data.biz_info).trim().slice(0, 2000)
    }
  }
  if (data.copyright != null) base.copyright = String(data.copyright).trim().slice(0, 120) || base.copyright
  if (Array.isArray(data.columns)) {
    base.columns = data.columns.slice(0, 6).map(col => ({
      title: String(col?.title || '').trim().slice(0, 40),
      links: (Array.isArray(col?.links) ? col.links : [])
        .slice(0, 12)
        .map(normalizeFooterLink)
        .filter(l => l.label),
    })).filter(c => c.title)
  }
  if (Array.isArray(data.policy_links)) {
    base.policy_links = data.policy_links.slice(0, 8).map(normalizeFooterLink).filter(l => l.label)
  }
  if (!base.columns.length) base.columns = DEFAULT_FOOTER_CONFIG.columns
  return base
}

const DEFAULT_TEST_ROOM_CONFIG = {
  enabled: true,
  label: '테스트룸',
  hint: '편집 테스트 · 대기자 커뮤니티',
  instagram_url: 'https://www.instagram.com/official_vcml/',
  instagram_label: '인스타그램',
  kakao_url: 'https://open.kakao.com/o/gjEgOrBi',
  kakao_label: '카카오 대기방',
}

function devTestRoomFallback(cfg) {
  if (process.env.NODE_ENV === 'production') return cfg
  const next = { ...cfg }
  if (!next.instagram_url && !next.kakao_url) {
    next.enabled = true
    next.instagram_url = DEFAULT_TEST_ROOM_CONFIG.instagram_url
    next.kakao_url = DEFAULT_TEST_ROOM_CONFIG.kakao_url
  }
  return next
}

function normalizeTestRoomConfig(data = {}) {
  const base = { ...DEFAULT_TEST_ROOM_CONFIG }
  if (data.enabled != null) base.enabled = !!data.enabled
  if (data.label != null) base.label = String(data.label).trim().slice(0, 20) || base.label
  if (data.hint != null) base.hint = String(data.hint).trim().slice(0, 80)
  if (data.instagram_url != null) base.instagram_url = String(data.instagram_url).trim().slice(0, 500)
  if (data.instagram_label != null) {
    base.instagram_label = String(data.instagram_label).trim().slice(0, 24) || base.instagram_label
  }
  if (data.kakao_url != null) base.kakao_url = String(data.kakao_url).trim().slice(0, 500)
  if (data.kakao_label != null) {
    base.kakao_label = String(data.kakao_label).trim().slice(0, 24) || base.kakao_label
  }
  return base
}

const DEFAULT_HERO_CONFIG = {
  badge_text: '타닥클래스만의 편집 방식',
  title: '편집기능 외우는 강의 말고,',
  title_emphasis: '타닥타닥 완성되는 강의',
  subtitle: '도각쌤이 현장에서 쓰는 방식 그대로\n숏폼·납품 결과물을 직접 만듭니다',
  primary_btn: { label: '전체 강의 보기', href: '#all', action: 'all_courses' },
  secondary_btn: { label: '무료강의 신청하기', href: '/course.html?slug=capcut-beginner-free', show_icon: true, action: 'custom' },
  image: null,
  image_alt: '',
}

const MAX_HERO_IMAGE_LEN = 480000

function isValidHeroImage(value) {
  if (!value) return true
  if (typeof value !== 'string') return false
  if (value.length > MAX_HERO_IMAGE_LEN) return false
  return /^https?:\/\/.+/i.test(value) || /^data:image\/(jpeg|jpg|png|webp);base64,/.test(value)
}

const DEFAULT_INSTRUCTORS_INTRO = {
  section_title: '강사 소개',
  section_subtitle: '타닥클래스를 이끌어가는 대표 강사를 소개합니다.',
  page_intro: '현장 경험과 교육 노하우를 바탕으로, 실무에 바로 쓸 수 있는 강의를 만듭니다.',
  greeting_eyebrow: 'Message',
  greeting_heading: '인사말',
  greeting_body: `안녕하세요, 타닥클래스 대표 강사입니다.

영상·콘텐츠 제작 현장에서 쌓은 경험을, 누구나 따라 할 수 있는 실무 교육으로 풀어내고 있습니다. 단순한 기능 설명을 넘어, 실제 프로젝트에서 바로 쓸 수 있는 워크플로와 노하우를 전달하는 것이 타닥클래스의 방향입니다.

앞으로도 현장의 변화에 맞춘 강의와 콘텐츠로 여러분의 성장을 돕겠습니다. 감사합니다.`,
  timeline_heading: '주요 경력',
  timeline: [
    { year: '2024', title: '타닥클래스 런칭', description: '실무 중심 영상·콘텐츠 교육 플랫폼 설립' },
    { year: '2020', title: '방송·광고 현장 활동', description: '캡컷·다빈치 리졸브 기반 상업 영상 제작' },
    { year: '2010', title: '영상 제작 경력 시작', description: '편집·모션그래픽 분야 현장 경험 축적' },
  ],
}

function normalizeTimelineAchievements(list) {
  if (!Array.isArray(list)) return []
  return list
    .map(a => String(a || '').trim().slice(0, 200))
    .filter(Boolean)
    .slice(0, 12)
}

function normalizeInstructorTimeline(items) {
  if (!Array.isArray(items)) return DEFAULT_INSTRUCTORS_INTRO.timeline.map((row, i) => ({ ...row, sort_order: i + 1 }))
  return items
    .map((item, i) => ({
      year: String(item?.year || '').trim().slice(0, 20),
      title: String(item?.title || '').trim().slice(0, 120),
      description: String(item?.description || '').trim().slice(0, 500),
      achievements: normalizeTimelineAchievements(item?.achievements),
      sort_order: Number(item?.sort_order) || i + 1,
    }))
    .filter(item => item.year || item.title || item.description || item.achievements.length)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    .slice(0, 30)
    .map((item, i) => ({ ...item, sort_order: i + 1 }))
}

function normalizeHeroConfig(data = {}) {
  const base = JSON.parse(JSON.stringify(DEFAULT_HERO_CONFIG))
  if (data.badge_text != null) base.badge_text = String(data.badge_text).trim().slice(0, 60) || base.badge_text
  if (data.title != null) base.title = String(data.title).trim().slice(0, 120)
  if (data.title_emphasis != null) base.title_emphasis = String(data.title_emphasis).trim().slice(0, 120)
  if (data.subtitle != null) base.subtitle = String(data.subtitle).trim().slice(0, 400)
  if (data.primary_btn) {
    base.primary_btn = {
      label: String(data.primary_btn.label || base.primary_btn.label).trim().slice(0, 40),
      href: String(data.primary_btn.href || base.primary_btn.href).trim().slice(0, 300),
      action: data.primary_btn.action != null
        ? String(data.primary_btn.action).trim().slice(0, 80) || null
        : (base.primary_btn.action || null),
    }
  }
  if (data.secondary_btn) {
    base.secondary_btn = {
      label: String(data.secondary_btn.label || base.secondary_btn.label).trim().slice(0, 40),
      href: String(data.secondary_btn.href || base.secondary_btn.href).trim().slice(0, 300),
      show_icon: data.secondary_btn.show_icon !== false,
      action: data.secondary_btn.action != null
        ? String(data.secondary_btn.action).trim().slice(0, 80) || null
        : (base.secondary_btn.action || null),
    }
  }
  if (data.image !== undefined) {
    const img = data.image === null || data.image === '' ? null : String(data.image)
    base.image = img && isValidHeroImage(img) ? img : null
  }
  if (data.image_alt != null) {
    base.image_alt = String(data.image_alt).trim().slice(0, 120)
  }
  return base
}

function normalizeInstructorsIntro(data = {}) {
  const base = { ...DEFAULT_INSTRUCTORS_INTRO, timeline: DEFAULT_INSTRUCTORS_INTRO.timeline.map(r => ({ ...r })) }
  if (data.section_title != null) base.section_title = String(data.section_title).trim().slice(0, 80) || base.section_title
  if (data.section_subtitle != null) base.section_subtitle = String(data.section_subtitle).trim().slice(0, 200)
  if (data.page_intro != null) base.page_intro = String(data.page_intro).trim().slice(0, 1000)
  if (data.greeting_eyebrow != null) base.greeting_eyebrow = String(data.greeting_eyebrow).trim().slice(0, 40)
  if (data.greeting_heading != null) base.greeting_heading = String(data.greeting_heading).trim().slice(0, 80) || base.greeting_heading
  if (data.greeting_body != null) base.greeting_body = String(data.greeting_body).trim().slice(0, 5000)
  if (data.timeline_heading != null) base.timeline_heading = String(data.timeline_heading).trim().slice(0, 80) || base.timeline_heading
  if (data.timeline !== undefined) base.timeline = normalizeInstructorTimeline(data.timeline)
  return base
}

function normalizeInstructorTags(tags) {
  if (!Array.isArray(tags)) return []
  return tags.map(t => String(t).trim()).filter(Boolean).slice(0, 12).map(t => t.slice(0, 30))
}

// ── 헬퍼 ──
function docToObj(doc) { return doc.exists ? { id: doc.id, ...doc.data() } : null }
function snapToArr(snap) { return snap.docs.map(d => ({ id: d.id, ...d.data() })) }

function parseLiveStart(course) {
  if (course?.live_starts_at) {
    const d = new Date(course.live_starts_at)
    if (!isNaN(d.getTime())) return d
  }
  const s = String(course?.live_schedule || '').trim()
  if (s) {
    const m = s.match(/^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(오전|오후)\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/)
    if (m) {
      let hour = parseInt(m[5], 10)
      const minute = parseInt(m[6], 10)
      const second = parseInt(m[7] || '0', 10)
      if (m[4] === '오후' && hour !== 12) hour += 12
      if (m[4] === '오전' && hour === 12) hour = 0
      const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10), hour, minute, second)
      if (!isNaN(d.getTime())) return d
    }
    const d = new Date(s)
    if (!isNaN(d.getTime())) return d
  }
  return null
}

/** 무료 + 라이브 일정이 있는 강의 (다시보기·기대평 규칙 적용) */
function isFreeLiveCourse(course) {
  if (!course || Number(course.sale_price) !== 0) return false
  return !!parseLiveStart(course)
}

function courseSupportsLiveReplay(course) {
  return course?.course_type === 'live' || isFreeLiveCourse(course)
}

function kstDateKey(date) {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' })
}

const LIVE_END_AFTER_MS = 3 * 60 * 60 * 1000
const MEET_OPEN_BEFORE_MS = 30 * 60 * 1000
const REPLAY_OPEN_HOUR_KST = 13
const ANTICIPATION_MODIFY_LOCK_MS = 60 * 60 * 1000
const LIVE_REVIEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000  // 강의 종료 후 7일
const LIVE_MATERIAL_AFTER_REVIEW_MS = 7 * 24 * 60 * 60 * 1000

function kstCalendarParts(date) {
  const t = date.getTime() + 9 * 3600000
  const d = new Date(t)
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), day: d.getUTCDate() }
}

/** 강의일(KST) 다음 날 오후 1시 */
function getReplayOpensAt(course) {
  const start = parseLiveStart(course)
  if (!start) return null
  const { y, m, day } = kstCalendarParts(start)
  return new Date(Date.UTC(y, m, day + 1, REPLAY_OPEN_HOUR_KST - 9, 0, 0))
}

function isLiveCourseEnded(course, at = new Date()) {
  if (course?.live_status === 'ended') return true
  const start = parseLiveStart(course)
  if (!start) return false
  return at.getTime() > start.getTime() + LIVE_END_AFTER_MS
}

function isLiveReviewOpen(course, at = new Date()) {
  if (course?.course_type !== 'live') return true  // VOD는 제한 없음
  const start = parseLiveStart(course)
  if (!start) return true
  const liveEndsAt = start.getTime() + LIVE_END_AFTER_MS
  if (at.getTime() < liveEndsAt) return false  // 강의 종료 전에는 후기 불가
  return at.getTime() <= liveEndsAt + LIVE_REVIEW_WINDOW_MS
}

function isMeetJoinAvailable(course, start, at = new Date()) {
  if (course?.live_status === 'ended' || isLiveCourseEnded(course, at)) return false
  if (!String(course?.meet_code || '').trim()) return false
  if (!start) return false
  const now = at.getTime()
  const t = start.getTime()
  return now >= t - MEET_OPEN_BEFORE_MS && now <= t + LIVE_END_AFTER_MS
}

function canWriteAnticipationReview(course, at = new Date()) {
  if (!courseSupportsLiveReplay(course)) return true
  if (course.live_status === 'ended') return false
  return !isLiveCourseEnded(course, at)
}

/** 라이브 신청 취소 마감: 시작 1시간 전 */
function canModifyAnticipationReview(course, at = new Date()) {
  const start = parseLiveStart(course)
  if (!start) return true
  return at.getTime() < start.getTime() - ANTICIPATION_MODIFY_LOCK_MS
}

function getLiveEnrollmentCancelLockMessage(course, at = new Date()) {
  if (canModifyAnticipationReview(course, at)) return null
  const start = parseLiveStart(course)
  if (!start) return '라이브 시작 1시간 전부터는 신청 취소할 수 없습니다.'
  const deadline = new Date(start.getTime() - ANTICIPATION_MODIFY_LOCK_MS)
  const deadlineLabel = deadline.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
  return `라이브 시작 1시간 전(${deadlineLabel})부터는 신청 취소할 수 없습니다.`
}

function getAnticipationModifyMeta(course, at = new Date()) {
  if (!courseSupportsLiveReplay(course)) {
    return { can_modify: true, locked: false, deadline: null, deadline_label: null, message: null }
  }
  const start = parseLiveStart(course)
  const canWrite = canWriteAnticipationReview(course, at)
  let deadline = null
  let deadlineLabel = null
  if (start) {
    deadline = new Date(start.getTime() + LIVE_END_AFTER_MS)
    deadlineLabel = deadline.toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
  }
  return {
    can_modify: canWrite,
    locked: !canWrite,
    deadline: deadline ? deadline.toISOString() : null,
    deadline_label: deadlineLabel,
    message: canWrite
      ? null
      : (deadlineLabel
        ? `강의 종료(${deadlineLabel}) 후에는 기대평을 작성·수정·삭제할 수 없습니다.`
        : '종료된 강의에는 기대평을 작성·수정·삭제할 수 없습니다.'),
  }
}

function anticipationWriteLockedResult(course) {
  if (canWriteAnticipationReview(course)) return null
  return { error: 'edit_locked', message: getAnticipationModifyMeta(course).message }
}

function formatReplayOpensLabel(opensAt) {
  if (!opensAt || isNaN(opensAt.getTime())) return '다음 날 오후 1시'
  return opensAt.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function isLiveLectureDay(course, at = new Date()) {
  const start = parseLiveStart(course)
  if (!start) return false
  return kstDateKey(at) === kstDateKey(start)
}

function isLiveMaterialOpenByReview(reviewSubmittedAt, at = new Date()) {
  if (!reviewSubmittedAt) return true
  const submittedMs = new Date(reviewSubmittedAt).getTime()
  if (isNaN(submittedMs)) return true
  const now = at.getTime()
  return now >= submittedMs && now <= submittedMs + LIVE_MATERIAL_AFTER_REVIEW_MS
}

function getLiveResourceAccess(course, { enrolled = false, hasReview = false, reviewSubmittedAt = null, at = new Date() } = {}) {
  const replayUrl = String(course?.live_replay_url || '').trim()
  const materialUrl = String(course?.live_material_url || '').trim()
  const lectureDay = isLiveLectureDay(course, at)
  const materialShow = enrolled && !!materialUrl && hasReview
  const materialOpen = hasReview && isLiveMaterialOpenByReview(reviewSubmittedAt, at)
  const start = parseLiveStart(course)
  const lectureEnded = isLiveCourseEnded(course, at)
  const replayOpensAt = getReplayOpensAt(course)
  const replayReady = replayOpensAt ? at.getTime() >= replayOpensAt.getTime() : false
  const meetConfigured = !!String(course?.meet_code || '').trim()
  const meetJoinAvailable = meetConfigured && isMeetJoinAvailable(course, start, at)
  const replayPending = !!replayUrl && lectureEnded && !replayReady
  return {
    replay_configured: !!replayUrl,
    replay_available: !!replayUrl && lectureEnded && replayReady,
    replay_pending: replayPending,
    replay_opens_at: replayPending && replayOpensAt ? replayOpensAt.toISOString() : null,
    replay_opens_label: replayPending && replayOpensAt ? formatReplayOpensLabel(replayOpensAt) : null,
    live_ended: lectureEnded,
    material_configured: !!materialUrl,
    material_show: materialShow,
    material_available: materialShow && materialOpen,
    material_lecture_day: lectureDay,
    material_open: materialOpen,
    meet_configured: meetConfigured,
    meet_join_available: enrolled && meetJoinAvailable,
    review_open: isLiveReviewOpen(course, at),
    review_closes_at: (() => {
      if (!start) return null
      const closeAt = new Date(start.getTime() + LIVE_END_AFTER_MS + LIVE_REVIEW_WINDOW_MS)
      return closeAt.toISOString()
    })(),
    live_lecture_date: start
      ? start.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric' })
      : null,
  }
}

function stripLiveResourceUrls(course) {
  if (!course || typeof course !== 'object') return course
  const { live_replay_url, live_material_url, ...rest } = course
  return rest
}

function isCourseCouponAllowed(course) {
  if (!course) return false
  return course.coupon_allowed !== false && course.coupon_allowed !== 0
}

function canApplyCourseCoupon(course, { skipCoupon = false } = {}) {
  if (!isCourseCouponAllowed(course)) return false
  if (skipCoupon) return false
  return true
}

function normalizeStoreCheckoutUrls(urls = {}) {
  const clean = (value) => {
    const s = String(value || '').trim().slice(0, 500)
    return s || null
  }
  return {
    none: clean(urls.none),
    discount_10: clean(urls.discount_10),
    discount_20: clean(urls.discount_20),
  }
}

function usesSmartstoreCheckout(course) {
  if (!course || course.checkout_provider !== 'smartstore') return false
  const urls = course.store_checkout_urls || {}
  return !!urls.none
}

function buildCourseSlug(title) {
  const cleaned = String(title || '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9가-힣_-]/g, '')
    .slice(0, 40)
  return `${cleaned || 'course'}-${Date.now()}`
}

function parseCheckoutAt(value) {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function formatCheckoutLabel(date) {
  if (!date) return null
  return date.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function getCheckoutWindowPublic(course, at = new Date()) {
  const isLive = course?.course_type === 'live'
  const isFree = !isLive && Number(course?.sale_price) === 0
  const starts = parseCheckoutAt(course?.checkout_starts_at)
  const ends = parseCheckoutAt(course?.checkout_ends_at)
  const now = at.getTime()
  const base = {
    checkout_starts_at: starts ? starts.toISOString() : null,
    checkout_ends_at: ends ? ends.toISOString() : null,
    checkout_starts_label: formatCheckoutLabel(starts),
    checkout_ends_label: formatCheckoutLabel(ends),
    checkout_has_window: !!(starts || ends),
  }

  if (isLive || isFree || (!starts && !ends)) {
    return {
      ...base,
      checkout_open: true,
      checkout_closed: false,
      checkout_upcoming: false,
      checkout_status: 'unlimited',
      checkout_message: null,
      checkout_panel_label: null,
    }
  }

  if (starts && now < starts.getTime()) {
    const label = formatCheckoutLabel(starts)
    return {
      ...base,
      checkout_open: false,
      checkout_closed: false,
      checkout_upcoming: true,
      checkout_status: 'upcoming',
      checkout_message: label ? `${label}부터 결제할 수 있습니다.` : '결제 시작 전입니다.',
      checkout_panel_label: '결제 전',
    }
  }

  if (ends && now > ends.getTime()) {
    const label = formatCheckoutLabel(ends)
    return {
      ...base,
      checkout_open: false,
      checkout_closed: true,
      checkout_upcoming: false,
      checkout_status: 'closed',
      checkout_message: label ? `${label}에 결제가 마감되었습니다.` : '결제 기간이 종료되었습니다.',
      checkout_panel_label: '결제마감',
    }
  }

  const endsLabel = formatCheckoutLabel(ends)
  return {
    ...base,
    checkout_open: true,
    checkout_closed: false,
    checkout_upcoming: false,
    checkout_status: 'open',
    checkout_message: endsLabel ? `${endsLabel}까지 결제 가능` : null,
    checkout_panel_label: null,
  }
}

function isCheckoutBlockedForPurchase(course, at = new Date()) {
  return !getCheckoutWindowPublic(course, at).checkout_open
}

function normalizeCheckoutWindowInput(startsAt, endsAt) {
  const starts = startsAt ? parseCheckoutAt(startsAt) : null
  const ends = endsAt ? parseCheckoutAt(endsAt) : null
  if (startsAt && !starts) return { error: 'invalid_starts' }
  if (endsAt && !ends) return { error: 'invalid_ends' }
  if (starts && ends && starts.getTime() >= ends.getTime()) return { error: 'invalid_range' }
  return {
    checkout_starts_at: starts ? starts.toISOString() : null,
    checkout_ends_at: ends ? ends.toISOString() : null,
  }
}

function pickCourseCardFields(course = {}) {
  const pub = db.getCourseEnrollmentPublic(course)
  return {
    id: course.id,
    slug: course.slug,
    title: course.title,
    category: course.category,
    thumbnail_url: course.thumbnail_url || null,
    thumbnail_image: course.thumbnail_image || null,
    thumbnail_icon: course.thumbnail_icon || null,
    thumb_style: course.thumb_style || null,
    badge: course.badge || null,
    course_type: course.course_type || 'recorded',
    is_offline: course.is_offline || 0,
    live_schedule: course.live_schedule || null,
    live_starts_at: course.live_starts_at || null,
    live_status: course.live_status || null,
    live_ended: courseSupportsLiveReplay(course) && isLiveCourseEnded(course),
    price: Number(course.price || 0),
    sale_price: Number(course.sale_price || 0),
    rating: course.rating || 0,
    review_count: course.review_count || 0,
    student_count: course.student_count || 0,
    sort_order: course.sort_order ?? 999,
    is_published: course.is_published,
    ...pub,
  }
}

// ── DB API ──
const db = {
  maskPublicName,
  isPublicReview,
  normalizeReviewRating,
  isCourseCouponAllowed,
  canApplyCourseCoupon,
  usesSmartstoreCheckout,
  normalizeStoreCheckoutUrls,
  getCheckoutWindowPublic,
  isCheckoutBlockedForPurchase,
  normalizeCheckoutWindowInput,

  // users
  async batchGetUsers(ids) {
    if (!ids.length) return {}
    const docs = await fs.getAll(...ids.map(id => fs.collection('users').doc(id)))
    return Object.fromEntries(docs.map(d => [d.id, d.exists ? d.data() : null]))
  },
  async batchGetCourses(ids) {
    if (!ids.length) return {}
    const docs = await fs.getAll(...ids.map(id => fs.collection('courses').doc(id)))
    return Object.fromEntries(docs.map(d => [d.id, d.exists ? d.data() : null]))
  },
  async findUserByEmail(email) {
    const snap = await fs.collection('users').where('email', '==', email).limit(1).get()
    return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() }
  },
  async findUserById(id) {
    const doc = await fs.collection('users').doc(id).get()
    return docToObj(doc)
  },
  async findUserByKakaoId(kakaoId) {
    const snap = await fs.collection('users').where('kakao_id', '==', String(kakaoId)).limit(1).get()
    return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() }
  },
  async createUser(email, password, name, memberType = 'student', extra = {}) {
    const data = {
      email, password, name, role: 'student', member_type: memberType,
      profile_complete: true, marketing_agreed: 0, marketing_agreed_at: null,
      phone: extra.phone || null,
      gender: extra.gender || null,
      birth_year: extra.birth_year || null,
      age_range: extra.age_range || null,
      created_at: now(),
    }
    const ref = await fs.collection('users').add(data)
    return { id: ref.id, ...data }
  },
  async createKakaoUser(kakaoId, email, name, memberType = 'student', kakaoProfile = {}) {
    const data = {
      kakao_id: String(kakaoId),
      email: email || null,
      password: null,
      name: name || '카카오 사용자',
      role: 'student',
      member_type: ['student', 'client'].includes(memberType) ? memberType : 'student',
      profile_complete: false,
      auth_provider: 'kakao',
      marketing_agreed: 0,
      marketing_agreed_at: null,
      phone: null,
      address: null,
      kakao_gender: kakaoProfile.gender || null,
      kakao_age_range: kakaoProfile.age_range || null,
      kakao_birthyear: kakaoProfile.birthyear || null,
      kakao_ci: kakaoProfile.ci || null,
      created_at: now(),
    }
    const ref = await fs.collection('users').add(data)
    return { id: ref.id, ...data }
  },
  async updateKakaoProfile(userId, kakaoProfile = {}) {
    const update = {}
    if (kakaoProfile.gender) update.kakao_gender = kakaoProfile.gender
    if (kakaoProfile.age_range) update.kakao_age_range = kakaoProfile.age_range
    if (kakaoProfile.birthyear) update.kakao_birthyear = kakaoProfile.birthyear
    if (kakaoProfile.ci) update.kakao_ci = kakaoProfile.ci
    if (Object.keys(update).length) {
      await fs.collection('users').doc(userId).update(update)
    }
  },
  async linkKakaoId(userId, kakaoId) {
    await fs.collection('users').doc(userId).update({ kakao_id: String(kakaoId), auth_provider: 'kakao' })
  },
  async unlinkKakaoId(userId) {
    await fs.collection('users').doc(userId).update({
      kakao_id: admin.firestore.FieldValue.delete(),
      kakao_gender: admin.firestore.FieldValue.delete(),
      kakao_age_range: admin.firestore.FieldValue.delete(),
      kakao_birthyear: admin.firestore.FieldValue.delete(),
      kakao_ci: admin.firestore.FieldValue.delete(),
    })
  },
  async findUserByGoogleId(googleId) {
    const snap = await fs.collection('users').where('google_id', '==', String(googleId)).limit(1).get()
    return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() }
  },
  async createGoogleUser(googleId, email, name, profileImage, memberType = 'student') {
    const data = {
      google_id: String(googleId),
      email: email || null,
      password: null,
      name: name || 'Google 사용자',
      role: 'student',
      member_type: ['student', 'client'].includes(memberType) ? memberType : 'student',
      profile_complete: false,
      profile_image: profileImage || null,
      auth_provider: 'google',
      marketing_agreed: 0,
      marketing_agreed_at: null,
      phone: null,
      created_at: now(),
    }
    const ref = await fs.collection('users').add(data)
    return { id: ref.id, ...data }
  },
  async linkGoogleId(userId, googleId) {
    await fs.collection('users').doc(userId).update({ google_id: String(googleId), auth_provider: 'google' })
  },
  async unlinkGoogleId(userId) {
    await fs.collection('users').doc(userId).update({ google_id: admin.firestore.FieldValue.delete() })
  },
  async completeProfile(userId, { name, email, phone, address, marketing_agreed, member_type, ip }) {
    const update = { profile_complete: true }
    if (name) update.name = name
    if (email) update.email = email
    if (phone) update.phone = phone
    if (address) update.address = String(address).trim().slice(0, 200)
    const existing = await db.findUserById(userId)
    if (member_type && !existing?.member_type) update.member_type = member_type
    if (marketing_agreed) {
      update.marketing_agreed = 1
      update.marketing_agreed_at = new Date().toISOString()
      await fs.collection('consent_logs').add({ user_id: userId, type: 'marketing_sms', agreed: 1, agreed_at: new Date().toISOString(), ip: ip || null })
    }
    await fs.collection('users').doc(userId).update(update)
    return db.findUserById(userId)
  },
  async revokeMarketing(userId, ip) {
    await fs.collection('users').doc(userId).update({ marketing_agreed: 0 })
    await fs.collection('consent_logs').add({ user_id: userId, type: 'marketing_sms', agreed: 0, agreed_at: new Date().toISOString(), ip: ip || null })
  },
  async updateUserProfile(userId, { name, bio, profile_image, social_links, phone, address }) {
    const update = { profile_updated_at: now() }
    if (name !== undefined) update.name = String(name).trim()
    if (bio !== undefined) update.bio = String(bio).trim().slice(0, 500)
    if (profile_image !== undefined) update.profile_image = profile_image || null
    if (social_links !== undefined) update.social_links = social_links
    if (phone !== undefined) update.phone = phone ? String(phone).trim() : null
    if (address !== undefined) update.address = address ? String(address).trim().slice(0, 200) : null
    await fs.collection('users').doc(userId).update(update)
    return db.findUserById(userId)
  },

  // courses
  async getCourses(publishedOnly = true) {
    const key = publishedOnly ? 'courses:pub' : 'courses:all'
    const cached = cacheGet(key)
    if (cached) return cached
    let q = fs.collection('courses')
    if (publishedOnly) q = q.where('is_published', '==', 1)
    const snap = await q.get()
    const items = snapToArr(snap).sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999))
    cacheSet(key, items, TTL.COURSES)
    return items
  },
  async getCourseBySlug(slug) {
    const key = `course:slug:${slug}`
    const cached = cacheGet(key)
    if (cached) return cached
    const snap = await fs.collection('courses').where('slug', '==', slug).limit(1).get()
    const result = snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() }
    if (result) cacheSet(key, result, TTL.COURSE_SLUG)
    return result
  },
  async getCourseById(id) {
    const doc = await fs.collection('courses').doc(id).get()
    return docToObj(doc)
  },
  getCourseEnrollmentStats(course, countOverride) {
    const limit = Math.max(0, parseInt(course?.enrollment_limit, 10) || 0)
    const count = countOverride != null
      ? Math.max(0, parseInt(countOverride, 10) || 0)
      : Math.max(0, parseInt(course?.student_count, 10) || 0)
    if (limit <= 0) {
      return { limit: 0, count, ratio: 0, full: false, hasLimit: false, remaining: null }
    }
    const ratio = Math.min(1, count / limit)
    return {
      limit,
      count,
      ratio,
      full: count >= limit,
      hasLimit: true,
      remaining: Math.max(0, limit - count),
    }
  },
  isCourseEnrollmentFull(course, countOverride) {
    return db.getCourseEnrollmentStats(course, countOverride).full
  },
  getCourseEnrollmentPublic(course, countOverride) {
    const s = db.getCourseEnrollmentStats(course, countOverride)
    return {
      enrollment_limit: s.limit,
      enrollment_count: s.count,
      enrollment_ratio: s.ratio,
      enrollment_full: s.full,
      enrollment_has_limit: s.hasLimit,
      enrollment_remaining: s.remaining,
      ...getCheckoutWindowPublic(course),
    }
  },
  async countEnrollmentsByCourse(courseId) {
    const key = `enrollment_count:${courseId}`
    const cached = cacheGet(key)
    if (cached !== null) return cached
    const enrollees = await db.getActiveEnrolleesByCourse(courseId)
    const count = enrollees.length
    cacheSet(key, count, 30_000)
    return count
  },
  async getActiveEnrolleesByCourse(courseId) {
    const enrollments = await db.getEnrollmentsByCourse(courseId)
    const rowsByUser = new Map()
    for (const e of enrollments) {
      const order = await db.getActiveOrderForCourse(e.user_id, courseId)
      if (!order) continue
      const user = await db.findUserById(e.user_id)
      if (!user) continue
      const enrolledAt = e.enrolled_at || order.paid_at || null
      const prev = rowsByUser.get(e.user_id)
      if (!prev || String(enrolledAt) > String(prev.enrolled_at)) {
        rowsByUser.set(e.user_id, {
          user_id: e.user_id,
          name: user.name || '-',
          email: user.email || '-',
          phone: user.phone || null,
          member_type: user.member_type || 'student',
          enrolled_at: enrolledAt,
          paid_amount: Number(order.amount || 0),
          method: order.method || '-',
          paid_at: order.paid_at || null,
        })
      }
    }
    const rows = [...rowsByUser.values()]
    rows.sort((a, b) => String(b.enrolled_at || '').localeCompare(String(a.enrolled_at || '')))
    return rows
  },
  async syncCourseStudentCount(courseId) {
    const count = await db.countEnrollmentsByCourse(courseId)
    await db.updateCourse(courseId, { student_count: count })
    return count
  },
  async isCourseEnrollmentFullAsync(course) {
    const count = await db.countEnrollmentsByCourse(course.id)
    return db.isCourseEnrollmentFull(course, count)
  },
  async getCourseEnrollmentPublicAsync(course) {
    const count = await db.countEnrollmentsByCourse(course.id)
    return {
      student_count: count,
      ...db.getCourseEnrollmentPublic(course, count),
    }
  },
  async enrichCourseEnrollment(course, { liveCount = false } = {}) {
    if (!course) return course
    if (liveCount) {
      const pub = await db.getCourseEnrollmentPublicAsync(course)
      return { ...course, ...pub }
    }
    const count = Math.max(0, parseInt(course.student_count, 10) || 0)
    return {
      ...course,
      student_count: count,
      ...db.getCourseEnrollmentPublic(course, count),
    }
  },
  async updateCourse(id, data) {
    await fs.collection('courses').doc(id).update(data)
    cacheInvalidate('courses:pub', 'courses:all', 'homepage:data*')
    // slug 캐시도 무효화 (slug를 모르면 전체 패턴 삭제)
    for (const k of _cache.keys()) {
      if (k.startsWith('course:slug:')) _cache.delete(k)
    }
  },
  async createLiveCourse({ title, description, category, thumbnail_icon, live_schedule, live_starts_at, meet_code }) {
    const slug = 'live-' + Date.now()
    const data = { slug, title, description: description || '', category, thumbnail_icon: thumbnail_icon || 'ti-broadcast', thumb_style: 'dark', price: 0, sale_price: 0, badge: 'LIVE', rating: 0, review_count: 0, student_count: 0, is_published: 1, course_type: 'live', live_schedule: live_schedule || null, live_starts_at: live_starts_at || null, meet_code: meet_code || null, live_status: 'upcoming', created_at: now() }
    const ref = await fs.collection('courses').add(data)
    return { id: ref.id, ...data }
  },

  async createRecordedCourse({
    title,
    description,
    category,
    price,
    sale_price,
    thumbnail_icon,
    thumb_style,
    badge,
    sort_order,
    is_published,
    checkout_provider,
    store_checkout_urls,
    coupon_allowed,
    checkout_starts_at,
    checkout_ends_at,
  }) {
    const slug = buildCourseSlug(title)
    const sale = Number(sale_price != null ? sale_price : price) || 0
    const listPrice = Number(price != null ? price : sale) || sale
    const checkoutWindow = normalizeCheckoutWindowInput(checkout_starts_at, checkout_ends_at)
    if (checkoutWindow.error) return { error: checkoutWindow.error }
    const data = {
      slug,
      title,
      description: description || '',
      category: category || '영상 편집',
      thumbnail_icon: thumbnail_icon || 'ti-video',
      thumb_style: thumb_style === 'dark' ? 'dark' : 'light',
      price: listPrice,
      sale_price: sale,
      badge: badge || null,
      sort_order: sort_order != null ? Number(sort_order) : 999,
      rating: 0,
      review_count: 0,
      student_count: 0,
      is_published: is_published ? 1 : 0,
      course_type: 'recorded',
      coupon_allowed: coupon_allowed === false || coupon_allowed === 0 ? 0 : 1,
      checkout_provider: checkout_provider === 'smartstore' ? 'smartstore' : 'site',
      store_checkout_urls: normalizeStoreCheckoutUrls(store_checkout_urls || {}),
      checkout_starts_at: checkoutWindow.checkout_starts_at,
      checkout_ends_at: checkoutWindow.checkout_ends_at,
      created_at: now(),
    }
    const ref = await fs.collection('courses').add(data)
    await fs.collection('chapters').add({
      course_id: ref.id,
      order_num: 1,
      title: '강의 소개',
      duration: '10분',
      is_free: sale === 0 ? 1 : 0,
      video_url: null,
    })
    cacheInvalidate('courses:pub', 'courses:all', 'homepage:data*')
    return { id: ref.id, ...data }
  },

  /** course-catalog.js 기준으로 Firestore 강의 동기화 (수강생·후기 통계는 유지) */
  async syncCoursesFromCatalog() {
    const { COURSES, TARGET_SLUGS } = require('./course-catalog')
    const syncFields = [
      'title', 'description', 'category', 'thumbnail_icon', 'thumb_style',
      'price', 'sale_price', 'badge', 'sort_order', 'is_published', 'course_type', 'is_offline',
    ]
    const snap = await fs.collection('courses').get()
    let updated = 0
    let unpublished = 0
    let created = 0

    for (const doc of snap.docs) {
      const data = doc.data()
      const match = COURSES.find(c => c.slug === data.slug)
      if (match) {
        const patch = { updated_at: now() }
        for (const key of syncFields) {
          if (match[key] !== undefined) patch[key] = match[key]
        }
        patch.student_count = data.student_count ?? 0
        patch.review_count = data.review_count ?? 0
        patch.rating = data.rating ?? 0
        await doc.ref.update(patch)
        updated++
      } else if (data.is_published) {
        await doc.ref.update({ is_published: 0, updated_at: now() })
        unpublished++
      }
    }

    for (const c of COURSES) {
      const existing = await fs.collection('courses').where('slug', '==', c.slug).limit(1).get()
      if (existing.empty) {
        const ref = await fs.collection('courses').add({ ...c, created_at: now() })
        await fs.collection('chapters').add({
          course_id: ref.id,
          order_num: 1,
          title: '강의 소개',
          duration: '10분',
          is_free: c.sale_price === 0 ? 1 : 0,
          video_url: null,
        })
        created++
      }
    }

    return { updated, unpublished, created, catalog_count: COURSES.length, catalog_slugs: [...TARGET_SLUGS] }
  },

  /** 카탈로그에 없는 구버전 강의와 연관 데이터 삭제 (라이브 강의는 기본 제외) */
  async deleteCourseCascade(courseId) {
    const counts = {
      chapters: 0,
      enrollments: 0,
      reviews: 0,
      anticipation_reviews: 0,
      progress: 0,
      orders: 0,
    }

    const chaptersSnap = await fs.collection('chapters').where('course_id', '==', courseId).get()
    const chapterIds = chaptersSnap.docs.map(d => d.id)
    counts.chapters = await deleteFirestoreDocs(chaptersSnap.docs)

    for (let i = 0; i < chapterIds.length; i += 10) {
      const chunk = chapterIds.slice(i, i + 10)
      const progSnap = await fs.collection('progress').where('chapter_id', 'in', chunk).get()
      counts.progress += await deleteFirestoreDocs(progSnap.docs)
    }

    for (const col of ['enrollments', 'reviews', 'anticipation_reviews', 'orders']) {
      const snap = await fs.collection(col).where('course_id', '==', courseId).get()
      counts[col] = await deleteFirestoreDocs(snap.docs)
    }

    await fs.collection('courses').doc(courseId).delete()
    return counts
  },

  async deleteLegacyCourses({ includeLive = false } = {}) {
    const { TARGET_SLUGS } = require('./course-catalog')
    const snap = await fs.collection('courses').get()
    const legacy = snap.docs.filter(d => {
      const data = d.data()
      if (TARGET_SLUGS.has(data.slug)) return false
      if (!includeLive && data.course_type === 'live') return false
      return true
    })

    const deleted = []
    const totals = { courses: 0, chapters: 0, enrollments: 0, reviews: 0, anticipation_reviews: 0, progress: 0, orders: 0 }

    for (const doc of legacy) {
      const counts = await db.deleteCourseCascade(doc.id)
      deleted.push({
        id: doc.id,
        slug: doc.data().slug,
        title: doc.data().title,
        ...counts,
      })
      totals.courses++
      for (const key of Object.keys(counts)) totals[key] += counts[key]
    }

    return { deleted_count: deleted.length, deleted, totals, catalog_slugs: [...TARGET_SLUGS] }
  },

  // chapters
  async getChaptersByCourse(courseId) {
    const key = `chapters:${courseId}`
    const cached = cacheGet(key)
    if (cached) return cached
    const snap = await fs.collection('chapters').where('course_id', '==', courseId).orderBy('order_num').get()
    const result = snapToArr(snap)
    cacheSet(key, result, 30_000)
    return result
  },
  async getChapterById(id) {
    const doc = await fs.collection('chapters').doc(id).get()
    return docToObj(doc)
  },
  async createChapter(courseId, data = {}) {
    const course = await db.getCourseById(courseId)
    if (!course) return { error: 'course_not_found' }
    const chapters = await db.getChaptersByCourse(courseId)
    const maxOrder = chapters.reduce((m, c) => Math.max(m, Number(c.order_num) || 0), 0)
    const title = String(data.title || '').trim()
    if (!title) return { error: 'title_required' }
    const payload = {
      course_id: courseId,
      order_num: Number(data.order_num) > 0 ? Number(data.order_num) : maxOrder + 1,
      title,
      duration: String(data.duration || '').trim() || null,
      is_free: data.is_free ? 1 : 0,
      video_url: String(data.video_url || '').trim() || null,
    }
    const ref = await fs.collection('chapters').add(payload)
    cacheInvalidate(`chapters:${courseId}`)
    return { id: ref.id, ...payload }
  },
  async updateChapter(chapterId, data = {}) {
    const chapter = await db.getChapterById(chapterId)
    if (!chapter) return { error: 'not_found' }
    const patch = {}
    if (data.title !== undefined) {
      const title = String(data.title).trim()
      if (!title) return { error: 'title_required' }
      patch.title = title
    }
    if (data.duration !== undefined) patch.duration = String(data.duration).trim() || null
    if (data.is_free !== undefined) patch.is_free = data.is_free ? 1 : 0
    if (data.video_url !== undefined) patch.video_url = String(data.video_url).trim() || null
    if (data.order_num !== undefined) patch.order_num = Math.max(1, parseInt(data.order_num, 10) || 1)
    if (!Object.keys(patch).length) return chapter
    await fs.collection('chapters').doc(chapterId).update(patch)
    cacheInvalidate(`chapters:${chapter.course_id}`)
    return db.getChapterById(chapterId)
  },
  async deleteChapter(chapterId) {
    const chapter = await db.getChapterById(chapterId)
    if (!chapter) return { error: 'not_found' }
    await fs.collection('chapters').doc(chapterId).delete()
    cacheInvalidate(`chapters:${chapter.course_id}`)
    const remaining = await db.getChaptersByCourse(chapter.course_id)
    for (let i = 0; i < remaining.length; i++) {
      const target = remaining[i]
      if (Number(target.order_num) !== i + 1) {
        await fs.collection('chapters').doc(target.id).update({ order_num: i + 1 })
      }
    }
    cacheInvalidate(`chapters:${chapter.course_id}`)
    return { success: true, course_id: chapter.course_id }
  },
  async moveChapter(chapterId, direction) {
    const chapter = await db.getChapterById(chapterId)
    if (!chapter) return { error: 'not_found' }
    const chapters = await db.getChaptersByCourse(chapter.course_id)
    const idx = chapters.findIndex(c => c.id === chapterId)
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (idx < 0 || swapIdx < 0 || swapIdx >= chapters.length) return { error: 'cannot_move' }
    const other = chapters[swapIdx]
    await fs.collection('chapters').doc(chapter.id).update({ order_num: other.order_num })
    await fs.collection('chapters').doc(other.id).update({ order_num: chapter.order_num })
    cacheInvalidate(`chapters:${chapter.course_id}`)
    return db.getChaptersByCourse(chapter.course_id)
  },

  // enrollments
  async isEnrolled(userId, courseId) {
    const snap = await fs.collection('enrollments').where('user_id', '==', userId).where('course_id', '==', courseId).limit(1).get()
    return !snap.empty
  },
  async enroll(userId, courseId) {
    const already = await db.isEnrolled(userId, courseId)
    if (already) return
    await fs.collection('enrollments').add({ user_id: userId, course_id: courseId, enrolled_at: now() })
    cacheInvalidate(`enrollment_count:${courseId}`, 'admin:stats', 'admin:courseStats', 'homepage:data*')
  },
  async enrollAtomically(userId, courseId, course) {
    const courseRef = fs.collection('courses').doc(courseId)
    const limit = Math.max(0, parseInt(course?.enrollment_limit, 10) || 0)
    let enrollmentFull = false
    await fs.runTransaction(async t => {
      const courseSnap = await t.get(courseRef)
      if (!courseSnap.exists) throw new Error('course_not_found')
      const currentCount = Math.max(0, parseInt(courseSnap.data().student_count, 10) || 0)
      if (limit > 0 && currentCount >= limit) {
        enrollmentFull = true
        return
      }
      t.update(courseRef, { student_count: admin.firestore.FieldValue.increment(1) })
    })
    if (enrollmentFull) return { error: 'enrollment_full' }
    await fs.collection('enrollments').add({ user_id: userId, course_id: courseId, enrolled_at: now() })
    cacheInvalidate(`enrollment_count:${courseId}`, 'admin:stats', 'admin:courseStats', 'homepage:data*')
    return { success: true }
  },
  async getEnrollmentsByUser(userId) {
    const snap = await fs.collection('enrollments').where('user_id', '==', userId).get()
    return snapToArr(snap)
  },
  async getEnrollmentsByCourse(courseId) {
    const snap = await fs.collection('enrollments').where('course_id', '==', courseId).get()
    return snapToArr(snap)
  },

  // orders
  async createOrder(userId, courseId, amount, method, discount = 0) {
    const data = { user_id: userId, course_id: courseId, amount, discount, method, status: 'paid', paid_at: now() }
    const ref = await fs.collection('orders').add(data)
    return { id: ref.id, ...data }
  },
  async getOrderById(orderId) {
    const doc = await fs.collection('orders').doc(orderId).get()
    return docToObj(doc)
  },
  async cancelOrder(orderId) {
    await fs.collection('orders').doc(orderId).update({ status: 'cancelled', cancelled_at: now() })
  },
  async refundOrder(orderId, refundAmount) {
    await fs.collection('orders').doc(orderId).update({
      status: 'refunded',
      refunded_at: now(),
      refund_amount: refundAmount,
    })
  },
  async getActiveOrderForCourse(userId, courseId) {
    const orders = await db.getOrdersByUser(userId)
    return orders.find(o => o.course_id === courseId && o.status === 'paid') || null
  },
  async unenroll(userId, courseId) {
    const snap = await fs.collection('enrollments').where('user_id', '==', userId).get()
    const targets = snap.docs.filter(d => d.data().course_id === courseId)
    for (const doc of targets) await doc.ref.delete()
    cacheInvalidate(`enrollment_count:${courseId}`, 'admin:stats', 'admin:courseStats', 'homepage:data*')
    return targets.length
  },
  async deleteProgressByCourse(userId, courseId) {
    const chapters = await db.getChaptersByCourse(courseId)
    const chIds = new Set(chapters.map(c => c.id))
    const snap = await fs.collection('progress').where('user_id', '==', userId).get()
    let removed = 0
    for (const doc of snap.docs) {
      if (chIds.has(doc.data().chapter_id)) {
        await doc.ref.delete()
        removed++
      }
    }
    return removed
  },
  async deleteAnticipationReviewByUserAndCourse(userId, courseId) {
    const course = await db.getCourseById(courseId)
    if (course && !canWriteAnticipationReview(course)) return false
    const snap = await fs.collection('anticipation_reviews').where('user_id', '==', userId).get()
    for (const doc of snap.docs) {
      if (doc.data().course_id === courseId) {
        await doc.ref.delete()
        return true
      }
    }
    return false
  },
  async recallAnticipationCouponForCourse(userId, courseId) {
    const coupons = await db.getCouponsByUser(userId)
    let recalled = 0
    for (const c of coupons) {
      if (c.reason !== ANTICIPATION_COUPON_REASON || c.status !== 'available') continue
      if (c.source_course_id !== courseId) continue
      await fs.collection('coupons').doc(c.id).update({ status: 'revoked', revoked_at: now() })
      recalled++
    }
    return recalled
  },
  async recallEnrollmentCoupons(userId, courseId, { refundedOrderId } = {}) {
    const coupons = (await db.getCouponsByUser(userId)).filter(c => {
      if (c.reason === ANTICIPATION_COUPON_REASON) return true
      return c.reason === COURSE_REVIEW_FIVE_STAR_REASON && c.course_id === courseId
    })
    let recalled = 0
    for (const c of coupons) {
      if (c.status === 'available') {
        await fs.collection('coupons').doc(c.id).update({ status: 'revoked', revoked_at: now() })
        recalled++
      } else if (c.status === 'used' && refundedOrderId && c.order_id === refundedOrderId) {
        await fs.collection('coupons').doc(c.id).update({
          status: 'revoked',
          revoked_at: now(),
          used_at: null,
          order_id: null,
        })
        recalled++
      }
    }
    return recalled
  },
  countWatchedChapters(progress) {
    return progress.filter(p => Number(p.watched_sec) > 0 || p.completed).length
  },
  computeEnrollmentCancelPlan(course, order, progress, chapters) {
    const isLive = course.course_type === 'live'
    const paidAmount = Number(order?.amount || 0)
    const isFree = paidAmount === 0

    if (isLive) {
      if (isLiveCourseEnded(course)) {
        return { allowed: false, error: '종료된 라이브 강의는 취소할 수 없습니다.' }
      }
      if (course.live_status === 'live') {
        return { allowed: false, error: '진행 중인 라이브는 취소할 수 없습니다.' }
      }
      if (!canModifyAnticipationReview(course)) {
        return { allowed: false, error: getLiveEnrollmentCancelLockMessage(course) || '라이브 시작 1시간 전부터는 신청 취소할 수 없습니다.' }
      }
      return { allowed: true, type: 'cancel', refund_amount: 0, label: '신청 취소' }
    }

    if (isFree) {
      return { allowed: true, type: 'cancel', refund_amount: 0, label: '수강 취소' }
    }

    const total = chapters.length || 1
    const watched = db.countWatchedChapters(progress)
    const ratio = watched / total
    const paidAt = order?.paid_at ? new Date(order.paid_at) : null
    const daysSince = paidAt ? (Date.now() - paidAt.getTime()) / (1000 * 60 * 60 * 24) : 999

    if (daysSince <= 7 && watched === 0) {
      return { allowed: true, type: 'refund', refund_amount: paidAmount, label: '전액 환불', full: true }
    }
    if (ratio >= 0.5) {
      return { allowed: false, error: '전체 강의의 50% 이상 수강한 경우 환불할 수 없습니다.' }
    }
    if (daysSince > 7 && watched === 0) {
      return { allowed: false, error: '결제일로부터 7일이 지난 미수강 건은 환불할 수 없습니다. 1:1 문의를 이용해주세요.' }
    }
    if (ratio < 1 / 3) {
      return { allowed: true, type: 'refund', refund_amount: Math.floor(paidAmount * (2 / 3)), label: '부분 환불 (2/3)' }
    }
    return { allowed: true, type: 'refund', refund_amount: Math.floor(paidAmount / 2), label: '부분 환불 (1/2)' }
  },
  async cancelEnrollmentWithCleanup(userId, courseId) {
    if (!await db.isEnrolled(userId, courseId)) {
      return { error: 'not_enrolled' }
    }

    const course = await db.getCourseById(courseId)
    if (!course) return { error: 'course_not_found' }

    const chapters = await db.getChaptersByCourse(courseId)
    const progress = await db.getProgressByCourse(userId, courseId)
    const order = await db.getActiveOrderForCourse(userId, courseId)

    const plan = db.computeEnrollmentCancelPlan(course, order, progress, chapters)
    if (!plan.allowed) return { error: 'not_allowed', message: plan.error }

    await db.unenroll(userId, courseId)
    if (order && plan.type === 'refund') {
      await db.refundOrder(order.id, plan.refund_amount)
      refundedOrderId = order.id
    } else if (order && plan.type === 'cancel') {
      await db.cancelOrder(order.id)
      refundedOrderId = order.id
    }

    await db.syncCourseStudentCount(courseId)

    await db.deleteProgressByCourse(userId, courseId)
    const anticipationDeleted = await db.deleteAnticipationReviewByUserAndCourse(userId, courseId)
    const couponsRecalled = await db.recallEnrollmentCoupons(userId, courseId, { refundedOrderId })

    return {
      success: true,
      type: plan.type,
      refund_amount: plan.refund_amount || 0,
      label: plan.label,
      anticipation_deleted: anticipationDeleted,
      coupons_recalled: couponsRecalled,
      course_slug: course.slug,
    }
  },
  async getOrdersByUser(userId) {
    const snap = await fs.collection('orders').where('user_id', '==', userId).get()
    return snapToArr(snap)
  },
  /** 유료 강의 결제 이력 여부 — 무료 수강·라이브 신청(amount 0, discount 0)은 제외 */
  async hasPaidCourseOrder(userId) {
    const orders = await db.getOrdersByUser(userId)
    return orders.some(o => o.status === 'paid' && (Number(o.amount) > 0 || Number(o.discount) > 0))
  },
  async getAllOrders() {
    const snap = await fs.collection('orders').orderBy('paid_at', 'desc').get()
    return snapToArr(snap)
  },
  async getPublicStudentCount() {
    const snap = await fs.collection('orders').where('status', '==', 'paid').get()
    return new Set(snapToArr(snap).map(o => o.user_id).filter(Boolean)).size
  },

  // progress
  async getProgress(userId, chapterId) {
    const snap = await fs.collection('progress').where('user_id', '==', userId).where('chapter_id', '==', chapterId).limit(1).get()
    return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() }
  },
  async getProgressByCourse(userId, courseId) {
    const chapters = await db.getChaptersByCourse(courseId)
    const chIds = chapters.map(c => c.id)
    const snap = await fs.collection('progress').where('user_id', '==', userId).get()
    return snapToArr(snap).filter(p => chIds.includes(p.chapter_id))
  },
  async upsertProgress(userId, chapterId, completed, watchedSec) {
    const existing = await db.getProgress(userId, chapterId)
    if (existing) {
      await fs.collection('progress').doc(existing.id).update({ completed: completed ? 1 : 0, watched_sec: watchedSec, updated_at: now() })
    } else {
      await fs.collection('progress').add({ user_id: userId, chapter_id: chapterId, completed: completed ? 1 : 0, watched_sec: watchedSec, updated_at: now() })
    }
    // 마지막 시청 챕터 갱신 (이어서 수강하기에 사용)
    const chapter = await db.getChapterById(chapterId)
    if (chapter) {
      const enrollSnap = await fs.collection('enrollments')
        .where('user_id', '==', userId)
        .where('course_id', '==', chapter.course_id)
        .limit(1).get()
      if (!enrollSnap.empty) {
        await fs.collection('enrollments').doc(enrollSnap.docs[0].id).update({ last_chapter_id: chapterId, last_watched_at: now() })
      }
    }
  },

  // reviews
  async getReviews(courseId) {
    const snap = await fs.collection('reviews').where('course_id', '==', courseId).where('is_public', '==', 1).get()
    return snapToArr(snap)
  },
  async getAllReviews() {
    const snap = await fs.collection('reviews').orderBy('created_at', 'desc').get()
    return snapToArr(snap)
  },
  async getReviewByUserAndCourse(userId, courseId) {
    const snap = await fs.collection('reviews').where('user_id', '==', userId).where('course_id', '==', courseId).limit(1).get()
    if (snap.empty) return null
    return { id: snap.docs[0].id, ...snap.docs[0].data() }
  },
  async syncCourseReviewStats(courseId) {
    const pub = await db.getReviews(courseId)
    const ratings = pub
      .map(r => db.normalizeReviewRating(r.rating, 0))
      .filter(n => Number.isFinite(n) && n > 0)
    const avg = ratings.length
      ? Math.round((ratings.reduce((s, n) => s + n, 0) / ratings.length) * 10) / 10
      : 0
    await db.updateCourse(courseId, { rating: avg, review_count: pub.length })
    cacheInvalidate('homepage:data*', 'reviews:live:*')
    return { rating: avg, review_count: pub.length }
  },
  async upsertReview(userId, courseId, rating, content) {
    const snap = await fs.collection('reviews').where('user_id', '==', userId).where('course_id', '==', courseId).limit(1).get()
    const numRating = Math.max(1, Math.min(5, parseInt(rating, 10) || 0))
    if (!snap.empty) {
      await fs.collection('reviews').doc(snap.docs[0].id).update({ rating: numRating, content })
    } else {
      await fs.collection('reviews').add({ user_id: userId, course_id: courseId, rating: numRating, content, is_public: 1, created_at: now() })
    }
    await db.syncCourseReviewStats(courseId)

    let coupon = null
    const course = await db.getCourseById(courseId)
    const qualifiesForReviewCoupon = numRating === 5
    if (qualifiesForReviewCoupon) {
      const userCoupons = await db.getCouponsByUser(userId)
      const existingAvailable = userCoupons.find(
        c => c.reason === COURSE_REVIEW_FIVE_STAR_REASON
          && c.course_id === courseId
          && c.status === 'available'
          && !isTimedPercentCouponExpired(c)
      )
      const alreadyIssued = userCoupons.some(
        c => c.reason === COURSE_REVIEW_FIVE_STAR_REASON && c.course_id === courseId
      )
      if (existingAvailable) {
        coupon = db.enrichCoupon(existingAvailable)
      } else if (!alreadyIssued) {
        const issuedAt = now()
        const reviewCfg = (await db.getCouponIssuanceConfig()).course_review_five_star || DEFAULT_COUPON_ISSUANCE_CONFIG.course_review_five_star
        coupon = await db.createCoupon(userId, 0, COURSE_REVIEW_FIVE_STAR_REASON, {
          discount_percent: COURSE_REVIEW_FIVE_STAR_DISCOUNT_PERCENT,
          coupon_type: 'percent',
          stackable: true,
          first_course_only: true,
          course_id: courseId,
          source_course_id: courseId,
          source_course_title: course?.title || null,
          expires_at: addOneMonthFrom(issuedAt),
          issued_source_label: reviewCfg.source_label,
          issued_route_label: reviewCfg.route_label,
        })
      }
    }
    return { rating: numRating, coupon }
  },
  async deleteReview(id) {
    const existing = await fs.collection('reviews').doc(id).get()
    const courseId = existing.exists ? existing.data().course_id : null
    await fs.collection('reviews').doc(id).delete()
    if (courseId) await db.syncCourseReviewStats(courseId)
    cacheInvalidate('homepage:data*', 'reviews:live:*')
  },
  async updateReviewPublic(id, isPublic) {
    const existing = await fs.collection('reviews').doc(id).get()
    const courseId = existing.exists ? existing.data().course_id : null
    await fs.collection('reviews').doc(id).update({ is_public: isPublic ? 1 : 0 })
    if (courseId) await db.syncCourseReviewStats(courseId)
    cacheInvalidate('homepage:data*', 'reviews:live:*')
  },

  // platform_reviews (실시간 후기 — 유형별 노출)
  async getPlatformReviewsByTypes(types) {
    const key = `platform_reviews:${[...types].sort().join(',')}`
    const cached = cacheGet(key)
    if (cached) return cached
    const snap = await fs.collection('platform_reviews').where('is_public', '==', 1).get()
    const result = snapToArr(snap)
      .filter(r => types.includes(r.review_type) && !r.seed_key)
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    cacheSet(key, result, TTL.HOMEPAGE)
    return result
  },
  async upsertPlatformReview(seedKey, data) {
    const snap = await fs.collection('platform_reviews').where('seed_key', '==', seedKey).limit(1).get()
    if (!snap.empty) {
      await snap.docs[0].ref.update({ ...data, updated_at: now() })
      cacheInvalidate('platform_reviews:*', 'homepage:data*', 'reviews:live:*')
      return snap.docs[0].id
    }
    const ref = await fs.collection('platform_reviews').add({ seed_key: seedKey, created_at: now(), is_public: 1, ...data })
    cacheInvalidate('platform_reviews:*', 'homepage:data*', 'reviews:live:*')
    return ref.id
  },

  async getAllPlatformReviews() {
    const snap = await fs.collection('platform_reviews').get()
    return snapToArr(snap).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
  },

  async getPlatformReviewById(id) {
    const doc = await fs.collection('platform_reviews').doc(id).get()
    return docToObj(doc)
  },

  normalizePlatformReviewInput(data = {}, { partial = false } = {}) {
    const types = ['student', 'client', 'editor']
    const payload = {}
    if (!partial || data.review_type !== undefined) {
      payload.review_type = types.includes(data.review_type) ? data.review_type : 'student'
    }
    if (!partial || data.author_name !== undefined) {
      payload.author_name = String(data.author_name || '').trim().slice(0, 40)
    }
    if (!partial || data.author_initial !== undefined) {
      const name = data.author_name !== undefined ? data.author_name : ''
      payload.author_initial = String(data.author_initial || (name || '?')[0]).trim().slice(0, 2)
    }
    if (!partial || data.content !== undefined) {
      payload.content = String(data.content || '').trim().slice(0, 500)
    }
    if (!partial || data.rating !== undefined) {
      payload.rating = Math.min(5, Math.max(1, parseInt(data.rating, 10) || 5))
    }
    if (!partial || data.context_label !== undefined) {
      payload.context_label = String(data.context_label || '').trim().slice(0, 80)
    }
    if (!partial || data.is_public !== undefined) {
      payload.is_public = data.is_public === false || data.is_public === 0 ? 0 : 1
    }
    return payload
  },

  async createPlatformReview(data) {
    const payload = db.normalizePlatformReviewInput(data)
    if (!payload.content) throw new Error('후기 내용은 필수입니다.')
    if (!payload.author_name) throw new Error('작성자 이름은 필수입니다.')
    if (!payload.author_initial) payload.author_initial = payload.author_name[0]
    payload.created_at = now()
    payload.updated_at = now()
    const ref = await fs.collection('platform_reviews').add(payload)
    for (const k of _cache.keys()) if (k.startsWith('platform_reviews:')) _cache.delete(k)
    return { id: ref.id, ...payload }
  },

  async updatePlatformReview(id, data) {
    const existing = await db.getPlatformReviewById(id)
    if (!existing) return null
    const payload = db.normalizePlatformReviewInput({ ...existing, ...data }, { partial: true })
    if (payload.author_name && !payload.author_initial && data.author_initial === undefined) {
      payload.author_initial = payload.author_name[0]
    }
    payload.updated_at = now()
    await fs.collection('platform_reviews').doc(id).update(payload)
    cacheInvalidate('platform_reviews:*', 'homepage:data*', 'reviews:live:*')
    return db.getPlatformReviewById(id)
  },

  async deletePlatformReview(id) {
    await fs.collection('platform_reviews').doc(id).delete()
    cacheInvalidate('platform_reviews:*', 'homepage:data*', 'reviews:live:*')
  },

  // anticipation_reviews (강의별 기대평)
  maskAuthorName(name) {
    const n = String(name || '회원').trim()
    if (n.length <= 1) return n
    if (n.length === 2) return n[0] + '*'
    return n[0] + '*'.repeat(n.length - 2) + n[n.length - 1]
  },
  maskUserLoginId(user) {
    const email = user?.email
    if (email && email.includes('@')) {
      const [local, domain] = email.split('@')
      if (local.length <= 2) return `${local[0]}***@${domain}`
      return `${local.slice(0, 2)}***@${domain}`
    }
    const id = String(user?.id || '회원')
    if (id.length <= 4) return id[0] + '***'
    return id.slice(0, 3) + '***'
  },
  async getAnticipationReviewByUser(userId) {
    const snap = await fs.collection('anticipation_reviews').where('user_id', '==', userId).limit(1).get()
    return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() }
  },
  async getAnticipationReviewByUserAndCourse(userId, courseId) {
    const snap = await fs.collection('anticipation_reviews').where('user_id', '==', userId).get()
    const found = snapToArr(snap).find(r => r.course_id === courseId)
    return found || null
  },
  async getPublicAnticipationReviews() {
    const snap = await fs.collection('anticipation_reviews').where('is_public', '==', 1).get()
    return snapToArr(snap).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
  },
  async getCourseAnticipationReviews(courseId) {
    const key = `anticipation:${courseId}`
    const cached = cacheGet(key)
    if (cached) return cached
    const snap = await fs.collection('anticipation_reviews').where('course_id', '==', courseId).get()
    const result = snapToArr(snap)
      .filter(r => r.is_public === 1)
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    cacheSet(key, result, 30_000)
    return result
  },
  async enrollInCourse(userId, courseId) {
    const course = await db.getCourseById(courseId)
    if (!course) return { error: 'course_not_found' }
    if (await db.isEnrolled(userId, courseId)) return { error: 'already_enrolled' }

    const isLive = course.course_type === 'live' || isFreeLiveCourse(course)
    const isFreeVod = !isLive && Number(course.sale_price) === 0
    if (!isLive && !isFreeVod) return { error: 'payment_required' }
    if (isLive && isLiveCourseEnded(course)) {
      const replayConfigured = getLiveResourceAccess(course).replay_configured
      if (!replayConfigured) return { error: 'live_ended' }
    }

    const enrollResult = await db.enrollAtomically(userId, courseId, course)
    if (enrollResult.error) return enrollResult

    try {
      await db.createOrder(userId, courseId, 0, '무료', 0)
      await db.syncCourseStudentCount(courseId)
    } catch (e) {
      await db.unenroll(userId, courseId).catch(() => {})
      await db.syncCourseStudentCount(courseId).catch(() => {})
      throw e
    }
    return { success: true, course }
  },
  async createCourseAnticipationReview(userId, courseId, content, { enroll = false } = {}) {
    const existing = await db.getAnticipationReviewByUserAndCourse(userId, courseId)
    if (existing) return { error: 'already_submitted', review: existing }

    const user = await db.findUserById(userId)
    if (!user) return { error: 'user_not_found' }

    const course = await db.getCourseById(courseId)
    if (!course) return { error: 'course_not_found' }

    const writeLocked = anticipationWriteLockedResult(course)
    if (writeLocked) return writeLocked

    const text = String(content || '').trim()
    if (text.length < ANTICIPATION_MIN_LENGTH) return { error: 'too_short' }
    if (text.length > ANTICIPATION_MAX_LENGTH) return { error: 'too_long' }

    if (enroll && await db.isEnrolled(userId, courseId)) {
      return { error: 'already_enrolled' }
    }
    if (enroll && await db.isCourseEnrollmentFullAsync(course)) {
      return { error: 'enrollment_full' }
    }

    const authorDisplay = db.maskAuthorName(user.name)
    const authorIdDisplay = db.maskUserLoginId(user)
    const createdAt = now()
    const ref = await fs.collection('anticipation_reviews').add({
      user_id: userId,
      course_id: courseId,
      author_display: authorDisplay,
      author_id_display: authorIdDisplay,
      content: text,
      is_public: 1,
      created_at: createdAt,
    })
    const review = {
      id: ref.id,
      user_id: userId,
      course_id: courseId,
      author_display: authorDisplay,
      author_id_display: authorIdDisplay,
      content: text,
      is_public: 1,
      created_at: createdAt,
    }

    const issuanceCfg = (await db.getCouponIssuanceConfig()).anticipation_review || DEFAULT_COUPON_ISSUANCE_CONFIG.anticipation_review
    const userCoupons = await db.getCouponsByUser(userId)
    const existingCoupon = userCoupons.find(
      c => c.reason === ANTICIPATION_COUPON_REASON
        && c.source_course_id === courseId
        && c.status === 'available'
        && !isTimedPercentCouponExpired(c)
    ) || userCoupons.find(
      c => c.reason === ANTICIPATION_COUPON_REASON
        && c.anticipation_review_id === review.id
        && c.status === 'available'
        && !isTimedPercentCouponExpired(c)
    )
    let coupon = existingCoupon ? db.enrichCoupon(existingCoupon) : null
    if (!coupon) {
      const issuedAt = now()
      coupon = await db.createCoupon(userId, 0, ANTICIPATION_COUPON_REASON, {
        discount_percent: ANTICIPATION_DISCOUNT_PERCENT,
        coupon_type: 'percent',
        first_course_only: true,
        expires_at: addOneMonthFrom(issuedAt),
        source_course_id: courseId,
        source_course_title: course.title,
        anticipation_review_id: review.id,
        issued_source_label: issuanceCfg.source_label,
        issued_route_label: issuanceCfg.route_label,
      })
      coupon = db.enrichCoupon(coupon)
    }

    let enrolled = false
    if (enroll) {
      await db.enroll(userId, courseId)
      const isFree = course.course_type === 'live' || Number(course.sale_price) === 0
      if (isFree) {
        await db.createOrder(userId, courseId, 0, course.course_type === 'live' ? '무료' : '무료', 0)
      }
      await db.syncCourseStudentCount(courseId)
      enrolled = true
    }

    cacheInvalidate(`anticipation:${courseId}`)
    return { review, coupon, enrolled }
  },
  async updateCourseAnticipationReview(userId, courseId, content) {
    const review = await db.getAnticipationReviewByUserAndCourse(userId, courseId)
    if (!review) return { error: 'not_found' }

    const course = await db.getCourseById(courseId)
    if (course) {
      const writeLocked = anticipationWriteLockedResult(course)
      if (writeLocked) return writeLocked
    }

    const text = String(content || '').trim()
    if (text.length < ANTICIPATION_MIN_LENGTH) return { error: 'too_short' }
    if (text.length > ANTICIPATION_MAX_LENGTH) return { error: 'too_long' }

    const updatedAt = now()
    await fs.collection('anticipation_reviews').doc(review.id).update({
      content: text,
      updated_at: updatedAt,
    })
    cacheInvalidate(`anticipation:${courseId}`)
    return {
      review: {
        ...review,
        content: text,
        updated_at: updatedAt,
      },
    }
  },
  async deleteCourseAnticipationReview(userId, courseId) {
    const course = await db.getCourseById(courseId)
    if (!course) return { error: 'course_not_found' }
    const writeLocked = anticipationWriteLockedResult(course)
    if (writeLocked) return writeLocked
    const review = await db.getAnticipationReviewByUserAndCourse(userId, courseId)
    if (!review) return { error: 'not_found' }
    await fs.collection('anticipation_reviews').doc(review.id).delete()
    cacheInvalidate(`anticipation:${courseId}`)
    const coupons_recalled = await db.recallAnticipationCouponForCourse(userId, courseId)
    return { success: true, coupons_recalled }
  },
  /** @deprecated 글로벌 오픈베타 기대평 — createCourseAnticipationReview 사용 */
  async createAnticipationReview(userId, content) {
    const existing = await db.getAnticipationReviewByUser(userId)
    if (existing) return { error: 'already_submitted', review: existing }

    const user = await db.findUserById(userId)
    if (!user) return { error: 'user_not_found' }

    const text = String(content || '').trim()
    if (text.length < 10) return { error: 'too_short' }
    if (text.length > 500) return { error: 'too_long' }

    const authorDisplay = db.maskAuthorName(user.name)
    const ref = await fs.collection('anticipation_reviews').add({
      user_id: userId,
      author_display: authorDisplay,
      content: text,
      is_public: 1,
      created_at: now(),
    })
    const review = { id: ref.id, user_id: userId, author_display: authorDisplay, content: text, is_public: 1, created_at: now() }

    const existingCoupon = (await db.getCouponsByUser(userId)).find(
      c => c.reason === ANTICIPATION_COUPON_REASON && c.status === 'available' && !isTimedPercentCouponExpired(c)
    )
    let coupon = existingCoupon || null
    if (!coupon) {
      const issuedAt = now()
      coupon = await db.createCoupon(userId, 0, ANTICIPATION_COUPON_REASON, {
        discount_percent: ANTICIPATION_DISCOUNT_PERCENT,
        coupon_type: 'percent',
        first_course_only: true,
        expires_at: addOneMonthFrom(issuedAt),
      })
    }

    return { review, coupon }
  },

  // coupons
  isCouponExpired(coupon) {
    if (!coupon || coupon.status !== 'available') return coupon?.status === 'expired'
    if (TIMED_PERCENT_COUPON_REASONS.has(coupon.reason)) return isTimedPercentCouponExpired(coupon)
    if (coupon.reason === CLIENT_COURSE_REWARD_REASON) return isClientCourseRewardCouponExpired(coupon)
    return false
  },
  async expireCouponIfNeeded(coupon) {
    if (!coupon?.id || coupon.status !== 'available') return coupon
    if (!db.isCouponExpired(coupon)) return coupon
    await fs.collection('coupons').doc(coupon.id).update({ status: 'expired', expired_at: now() })
    return { ...coupon, status: 'expired', expired_at: now() }
  },
  enrichCoupon(coupon) {
    if (!coupon) return coupon
    const expires_at = TIMED_PERCENT_COUPON_REASONS.has(coupon.reason)
      ? getTimedPercentCouponExpiresAt(coupon)
      : coupon.reason === CLIENT_COURSE_REWARD_REASON
        ? getClientCourseRewardExpiresAt(coupon)
        : (coupon.expires_at || null)
    return { ...coupon, expires_at }
  },
  async resolveCouponIssuance(coupon) {
    if (!coupon) return null
    const config = await db.getCouponIssuanceConfig()
    const row = config[coupon.reason] || DEFAULT_COUPON_ISSUANCE_CONFIG[coupon.reason] || {}
    let courseTitle = coupon.source_course_title || null
    if (!courseTitle && coupon.source_course_id) {
      const course = await db.getCourseById(coupon.source_course_id)
      courseTitle = course?.title || null
    }
    return {
      source: coupon.issued_source_label || row.source_label || COUPON_REASON_LABELS[coupon.reason] || coupon.reason,
      route: coupon.issued_route_label || row.route_label || '',
      benefit: row.benefit_label || '',
      course_title: courseTitle,
    }
  },
  async resolveStackableCourseDiscount(userId, salePrice, isFirstPurchase) {
    const coupons = await db.getCouponsByUser(userId)
    const applicable = []
    for (const raw of coupons) {
      const c = db.enrichCoupon(raw)
      if (c.status !== 'available') continue
      if (db.isCouponExpired(c)) continue
      if (!STACKABLE_COURSE_COUPON_REASONS.includes(c.reason)) continue
      if (c.first_course_only && !isFirstPurchase) continue
      if (!c.discount_percent) continue
      applicable.push(c)
    }
    const anticipation = applicable.filter(c => c.reason === ANTICIPATION_COUPON_REASON).slice(0, 1)
    const reviewCandidates = applicable
      .filter(c => c.reason === COURSE_REVIEW_FIVE_STAR_REASON)
      .sort((a, b) => (a.expires_at || a.created_at || '').localeCompare(b.expires_at || b.created_at || ''))
    const reviewPick = reviewCandidates.length ? [reviewCandidates[0]] : []
    const toApply = [...anticipation, ...reviewPick]
    const applied = []
    let totalDiscount = 0
    for (const c of toApply) {
      const discount = Math.floor(Number(salePrice) * Number(c.discount_percent) / 100)
      if (discount <= 0) continue
      totalDiscount += discount
      applied.push({ coupon: c, discount })
    }
    return { totalDiscount, applied }
  },

  async resolveCourseCheckoutTier(userId, course) {
    if (!userId || !isCourseCouponAllowed(course)) {
      return { tier: 'none', discount_percent: 0, label: '정가' }
    }
    const salePrice = Number(course.sale_price || 0)
    const isFirstPurchase = !(await db.hasPaidCourseOrder(userId))
    const stack = await db.resolveStackableCourseDiscount(userId, salePrice, isFirstPurchase)
    const count = stack.applied.length
    if (count >= 2) {
      return { tier: '20', discount_percent: 20, label: '20% 할인 (기대평·후기 쿠폰)' }
    }
    if (count === 1) {
      const reason = stack.applied[0]?.coupon?.reason
      const detail = reason === COURSE_REVIEW_FIVE_STAR_REASON ? '수강 후기 쿠폰' : '기대평 쿠폰'
      return { tier: '10', discount_percent: 10, label: `10% 할인 (${detail})` }
    }
    return { tier: 'none', discount_percent: 0, label: '사용 가능한 쿠폰 없음' }
  },

  async resolveStoreCheckoutRedirect(userId, course, useCoupon) {
    const urls = course.store_checkout_urls || {}
    if (!urls.none) return { error: 'store_not_configured' }

    if (!useCoupon || !isCourseCouponAllowed(course)) {
      return {
        redirect_url: urls.none,
        tier: 'none',
        discount_percent: 0,
        label: '정가',
      }
    }

    const tierInfo = await db.resolveCourseCheckoutTier(userId, course)
    if (tierInfo.tier === '20' && urls.discount_20) {
      return { redirect_url: urls.discount_20, ...tierInfo }
    }
    if (tierInfo.tier === '10' && urls.discount_10) {
      return { redirect_url: urls.discount_10, ...tierInfo }
    }
    if (tierInfo.tier === 'none') {
      return {
        redirect_url: urls.none,
        tier: 'none',
        discount_percent: 0,
        label: tierInfo.label,
        fallback: true,
        message: '보유하신 할인 쿠폰이 없어 정가 링크로 안내합니다.',
      }
    }

    return {
      redirect_url: urls.none,
      ...tierInfo,
      fallback: true,
      message: `${tierInfo.label} 전용 링크가 없어 정가 링크로 안내합니다.`,
    }
  },

  inferCouponUsedContext(coupon) {
    if (!coupon) return null
    if (coupon.used_context) return coupon.used_context
    if (coupon.order_id) return COUPON_USED_CONTEXT.COURSE_ORDER
    if (coupon.project_id) return COUPON_USED_CONTEXT.CLIENT_PROJECT
    if (coupon.featured_until || isEditorFeaturedCoupon(coupon)) return COUPON_USED_CONTEXT.EDITOR_FEATURED
    return 'unknown'
  },
  async resolveCouponUsage(coupon) {
    if (!coupon || coupon.status !== 'used') return null
    const context = db.inferCouponUsedContext(coupon)
    let targetTitle = coupon.used_target_title || null
    let detail = null
    const discount = coupon.used_discount ?? coupon.amount ?? 0

    if (context === COUPON_USED_CONTEXT.COURSE_ORDER) {
      if (!targetTitle) {
        const order = coupon.order_id ? await db.getOrderById(coupon.order_id) : null
        const courseId = coupon.used_target_id || coupon.used_course_id || order?.course_id
        if (courseId) {
          const course = await db.getCourseById(courseId)
          targetTitle = course?.title || '강의'
        }
        if (order) detail = `결제 ${Number(order.amount || 0).toLocaleString('ko-KR')}원`
      }
    } else if (context === COUPON_USED_CONTEXT.CLIENT_PROJECT) {
      if (!targetTitle) {
        const projectId = coupon.used_target_id || coupon.project_id
        if (projectId) {
          const project = await db.getProjectById(projectId)
          targetTitle = project?.title || '의뢰'
        }
      }
      if (coupon.used_quote_amount) {
        detail = `견적 ${Number(coupon.used_quote_amount).toLocaleString('ko-KR')}원`
      }
    } else if (context === COUPON_USED_CONTEXT.EDITOR_FEATURED) {
      targetTitle = targetTitle || '에디터즈 상위노출 7일'
    }

    return {
      context,
      context_label: COUPON_USED_CONTEXT_LABELS[context] || COUPON_USED_CONTEXT_LABELS.unknown,
      target_title: targetTitle,
      detail,
      used_at: coupon.used_at,
      discount,
    }
  },
  async getCouponsByUserNormalized(userId) {
    const coupons = await db.getCouponsByUser(userId)
    const result = []
    for (const c of coupons) {
      let item
      if (c.status === 'available' && db.isCouponExpired(c)) {
        await fs.collection('coupons').doc(c.id).update({ status: 'expired', expired_at: now() })
        item = db.enrichCoupon({ ...c, status: 'expired', expired_at: now() })
      } else {
        item = db.enrichCoupon(c)
      }
      item.issuance = await db.resolveCouponIssuance(item)
      if (item.status === 'used') {
        item.usage = await db.resolveCouponUsage(item)
      }
      result.push(item)
    }
    return result
  },
  async getAdminCouponReport() {
    const snap = await fs.collection('coupons').get()
    const coupons = snapToArr(snap).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    const userIds = [...new Set(coupons.map(c => c.user_id).filter(Boolean))]
    const users = await Promise.all(userIds.map(id => db.findUserById(id)))
    const userMap = Object.fromEntries(users.filter(Boolean).map(u => [u.id, u]))

    const summary = {
      total: coupons.length,
      available: 0,
      used: 0,
      expired: 0,
      revoked: 0,
      by_reason: {},
      usage_by_context: {},
      total_discount_applied: 0,
    }

    for (const c of coupons) {
      if (summary[c.status] !== undefined) summary[c.status]++
      const reason = c.reason || 'unknown'
      if (!summary.by_reason[reason]) {
        summary.by_reason[reason] = { issued: 0, available: 0, used: 0, expired: 0, revoked: 0 }
      }
      summary.by_reason[reason].issued++
      if (summary.by_reason[reason][c.status] !== undefined) summary.by_reason[reason][c.status]++

      if (c.status === 'used') {
        const ctx = db.inferCouponUsedContext(c)
        if (!summary.usage_by_context[ctx]) {
          summary.usage_by_context[ctx] = { count: 0, discount_total: 0, label: COUPON_USED_CONTEXT_LABELS[ctx] || ctx }
        }
        summary.usage_by_context[ctx].count++
        const applied = Number(c.used_discount ?? c.amount ?? 0)
        summary.usage_by_context[ctx].discount_total += applied
        summary.total_discount_applied += applied
      }
    }

    const list = await Promise.all(coupons.map(async c => {
      const u = userMap[c.user_id]
      const enriched = db.enrichCoupon(c)
      return {
        ...enriched,
        user_name: u?.name || u?.email || '-',
        user_email: u?.email || null,
        reason_label: COUPON_REASON_LABELS[c.reason] || c.reason,
        issuance: await db.resolveCouponIssuance(enriched),
        usage: c.status === 'used' ? await db.resolveCouponUsage(c) : null,
      }
    }))

    return { summary, coupons: list }
  },
  async createCoupon(userId, amount, reason, extra = {}) {
    const code = 'TADAK' + String(Date.now()).slice(-7) + Math.random().toString(36).slice(2,5).toUpperCase()
    const data = { user_id: userId, code, amount, reason, status: 'available', created_at: now(), used_at: null, ...extra }
    const ref = await fs.collection('coupons').add(data)
    return { id: ref.id, ...data }
  },
  /** 의뢰인 — 20만원 이상 강의 수강 시 1만원 할인쿠폰 10장 (강의당 1회) */
  async issueClientCourseRewardCoupons(userId, course, orderId) {
    const user = await db.findUserById(userId)
    if (!user || user.member_type !== 'client') return null
    const price = course.sale_price ?? course.price ?? 0
    if (price < CLIENT_COURSE_REWARD_MIN_COURSE_PRICE) return null
    const existing = (await db.getCouponsByUser(userId)).filter(
      c => c.reason === CLIENT_COURSE_REWARD_REASON && c.course_id === course.id
    )
    if (existing.length > 0) return null
    const coupons = []
    const issuedAt = now()
    const expiresAt = addMonthsFrom(issuedAt, CLIENT_COURSE_REWARD_EXPIRY_MONTHS)
    for (let i = 0; i < CLIENT_COURSE_REWARD_COUNT; i++) {
      const coupon = await db.createCoupon(userId, CLIENT_COURSE_REWARD_AMOUNT, CLIENT_COURSE_REWARD_REASON, {
        course_id: course.id,
        enrollment_order_id: orderId,
        coupon_type: 'client_project_discount',
        min_project_amount: CLIENT_PROJECT_COUPON_MIN_AMOUNT,
        expires_at: expiresAt,
      })
      coupons.push(coupon)
    }
    return {
      count: coupons.length,
      amount_each: CLIENT_COURSE_REWARD_AMOUNT,
      total_amount: coupons.length * CLIENT_COURSE_REWARD_AMOUNT,
      coupon_ids: coupons.map(c => c.id),
    }
  },
  /** 의뢰인 — 3만원 이상 견적 수락 시 1만원 할인 쿠폰 사용 가능 여부 */
  checkClientProjectCoupon(userId, couponId, quoteAmount) {
    return db.getCouponById(couponId).then(coupon => {
      if (!coupon) return null
      const enriched = db.enrichCoupon(coupon)
      if (enriched.user_id !== userId || enriched.reason !== CLIENT_COURSE_REWARD_REASON) return null
      if (enriched.status !== 'available') return null
      if (db.isCouponExpired(enriched)) return null
      if (Number(quoteAmount) < CLIENT_PROJECT_COUPON_MIN_AMOUNT) return null
      return enriched
    })
  },
  async getCouponById(couponId) {
    const doc = await fs.collection('coupons').doc(couponId).get()
    return doc.exists ? { id: doc.id, ...doc.data() } : null
  },
  /** 의뢰인 — 3만원 이상 견적 수락 시 1만원 할인 쿠폰 사용 */
  async redeemClientProjectCoupon(userId, couponId, projectId, quoteAmount) {
    const coupon = await db.checkClientProjectCoupon(userId, couponId, quoteAmount)
    if (!coupon) return null
    const project = await db.getProjectById(projectId)
    await fs.collection('coupons').doc(couponId).update({
      status: 'used',
      used_at: now(),
      project_id: projectId,
      used_quote_amount: Number(quoteAmount),
      order_id: null,
      used_context: COUPON_USED_CONTEXT.CLIENT_PROJECT,
      used_target_type: 'project',
      used_target_id: projectId,
      used_target_title: project?.title || null,
      used_discount: coupon.amount,
    })
    return {
      discount: coupon.amount,
      coupon_id: couponId,
      final_amount: Number(quoteAmount) - coupon.amount,
    }
  },
  async getCouponsByUser(userId) {
    const snap = await fs.collection('coupons').where('user_id', '==', userId).get()
    return snapToArr(snap)
  },
  async getCouponByCode(code) {
    const snap = await fs.collection('coupons').where('code', '==', code).limit(1).get()
    if (snap.empty) return null
    const coupon = { id: snap.docs[0].id, ...snap.docs[0].data() }
    return db.expireCouponIfNeeded(db.enrichCoupon(coupon))
  },
  async useCoupon(couponId, usage = {}) {
    const meta = typeof usage === 'string' ? { order_id: usage } : usage
    const doc = await fs.collection('coupons').doc(couponId).get()
    if (!doc.exists || doc.data().status !== 'available') return false
    await fs.collection('coupons').doc(couponId).update({
      status: 'used',
      used_at: now(),
      order_id: meta.order_id ?? null,
      used_context: meta.used_context ?? (meta.order_id ? COUPON_USED_CONTEXT.COURSE_ORDER : null),
      used_target_type: meta.used_target_type ?? null,
      used_target_id: meta.used_target_id ?? meta.course_id ?? null,
      used_target_title: meta.used_target_title ?? null,
      used_discount: meta.used_discount ?? null,
      ...(meta.course_id ? { used_course_id: meta.course_id } : {}),
      ...(meta.project_id ? { project_id: meta.project_id } : {}),
    })
    return true
  },

  // ── 의뢰(프로젝트) ──
  async createProject(clientId, { title, description, category, budget_min, budget_max, deadline, requirements }) {
    const data = { client_id: clientId, title, description, category, budget_min: budget_min||0, budget_max: budget_max||0, deadline: deadline||null, requirements: requirements||'', status: 'open', created_at: now() }
    const ref = await fs.collection('projects').add(data)
    return { id: ref.id, ...data }
  },
  async getProjects(status = null) {
    let q = fs.collection('projects').orderBy('created_at', 'desc')
    if (status) q = q.where('status', '==', status)
    const snap = await q.get()
    return snapToArr(snap)
  },
  async getProjectById(id) {
    const doc = await fs.collection('projects').doc(id).get()
    return docToObj(doc)
  },
  async getProjectsByClient(clientId) {
    const snap = await fs.collection('projects').where('client_id', '==', clientId).orderBy('created_at', 'desc').get()
    return snapToArr(snap)
  },
  async updateProject(id, data) {
    await fs.collection('projects').doc(id).update(data)
  },

  // ── 견적(Quote) ──
  async submitQuote(editorId, projectId, { amount, message }) {
    const existing = await fs.collection('quotes').where('editor_id', '==', editorId).where('project_id', '==', projectId).limit(1).get()
    if (!existing.empty) throw new Error('이미 견적을 제출했습니다.')
    const data = { editor_id: editorId, project_id: projectId, amount, message, status: 'pending', created_at: now() }
    const ref = await fs.collection('quotes').add(data)
    return { id: ref.id, ...data }
  },
  async getQuotesByProject(projectId) {
    const snap = await fs.collection('quotes').where('project_id', '==', projectId).orderBy('created_at', 'asc').get()
    return snapToArr(snap)
  },
  async getQuotesByEditor(editorId) {
    const snap = await fs.collection('quotes').where('editor_id', '==', editorId).orderBy('created_at', 'desc').get()
    return snapToArr(snap)
  },
  async acceptQuote(quoteId, projectId) {
    // 해당 견적 승인, 나머지 거절, 프로젝트 상태 변경
    await fs.collection('quotes').doc(quoteId).update({ status: 'accepted' })
    const others = await fs.collection('quotes').where('project_id', '==', projectId).get()
    for (const d of others.docs) {
      if (d.id !== quoteId) await d.ref.update({ status: 'rejected' })
    }
    await fs.collection('projects').doc(projectId).update({ status: 'matched', matched_quote_id: quoteId })
  },

  // ── 편집자 신청 ──
  /** 에디터 승격(승인) 시 수강생에게 상위노출 쿠폰 2만원 × 5장 (최초 1회) */
  async issueEditorApprovalFeaturedCoupons(userId, applicationId) {
    const user = await db.findUserById(userId)
    if (!user || user.member_type !== 'student') return null
    const existing = (await db.getCouponsByUser(userId)).filter(c => c.reason === EDITOR_APPLY_FEATURED_REASON)
    if (existing.length >= EDITOR_APPLY_FEATURED_COUNT) return null
    const coupons = []
    for (let i = existing.length; i < EDITOR_APPLY_FEATURED_COUNT; i++) {
      const coupon = await db.createCoupon(userId, EDITOR_APPLY_FEATURED_AMOUNT, EDITOR_APPLY_FEATURED_REASON, {
        coupon_type: EDITOR_FEATURED_REASON,
        editor_application_id: applicationId,
      })
      coupons.push(coupon)
    }
    if (!coupons.length) return null
    return {
      count: coupons.length,
      amount_each: EDITOR_APPLY_FEATURED_AMOUNT,
      total_amount: coupons.length * EDITOR_APPLY_FEATURED_AMOUNT,
      coupon_ids: coupons.map(c => c.id),
    }
  },
  // ── 에디터즈 프로그램 설정 ──
  async ensureEditorProgramConfig() {
    const doc = await fs.collection('site_settings').doc('editor_program').get()
    if (!doc.exists) {
      const config = normalizeEditorProgramConfig(DEFAULT_EDITOR_PROGRAM_CONFIG)
      await fs.collection('site_settings').doc('editor_program').set({ ...config, updated_at: now() })
      return config
    }
    return normalizeEditorProgramConfig(doc.data())
  },
  async getEditorProgramConfig() {
    const doc = await fs.collection('site_settings').doc('editor_program').get()
    if (!doc.exists) return db.ensureEditorProgramConfig()
    return normalizeEditorProgramConfig(doc.data())
  },
  async updateEditorProgramConfig(data) {
    const current = await db.getEditorProgramConfig()
    const next = normalizeEditorProgramConfig({
      ...current,
      terms_version: data.terms_version !== undefined ? data.terms_version : current.terms_version,
      stages: data.stages !== undefined ? data.stages : current.stages,
      guide_cards: data.guide_cards !== undefined ? data.guide_cards : current.guide_cards,
    })
    await fs.collection('site_settings').doc('editor_program').set({ ...next, updated_at: now() })
    await db.syncWorkbookSlotsFromConfig(next)
    return db.getEditorProgramConfig()
  },
  async syncWorkbookSlotsFromConfig(configIn) {
    const config = configIn || await db.getEditorProgramConfig()
    const slots = buildWorkbookSlotMap(config).map(s => ({
      ...s,
      stage_mail_count: config.stages.find(st => st.order === s.stage_num)?.mail_count || 1,
    }))
    const existing = await db.getEditorWorkbooks()
    const byOrder = new Map(existing.map(w => [w.order_num, w]))
    const usedIds = new Set()

    for (const slot of slots) {
      const template = EDITOR_WORKBOOK_SEED[(slot.order_num - 1) % EDITOR_WORKBOOK_SEED.length]
      const existingWb = byOrder.get(slot.order_num)
      const payload = buildWorkbookFromTemplate(template, slot)
      if (existingWb) {
        usedIds.add(existingWb.id)
        await fs.collection('editor_workbooks').doc(existingWb.id).set({
          ...payload,
          slug: existingWb.slug || payload.slug,
          updated_at: now(),
        }, { merge: true })
      } else {
        const ref = await fs.collection('editor_workbooks').add({ ...payload, created_at: now() })
        usedIds.add(ref.id)
      }
    }
    for (const wb of existing) {
      if (!usedIds.has(wb.id)) {
        await fs.collection('editor_workbooks').doc(wb.id).delete().catch(() => {})
      }
    }
    return { total_mails: slots.length, slots: slots.length }
  },
  async updateEditorWorkbook(id, data) {
    const allowed = [
      'from_name', 'from_email', 'from_company', 'subject', 'received_at', 'body',
      'mission_title', 'mission_brief', 'min_note_length', 'required_keywords', 'pass_message',
    ]
    const update = { updated_at: now() }
    for (const key of allowed) {
      if (data[key] !== undefined) update[key] = data[key]
    }
    if (data.required_keywords !== undefined) {
      update.required_keywords = Array.isArray(data.required_keywords)
        ? data.required_keywords
        : String(data.required_keywords).split(',').map(s => s.trim()).filter(Boolean)
    }
    await fs.collection('editor_workbooks').doc(id).update(update)
    return db.getEditorWorkbookById(id)
  },
  // ── 에디터즈 프로그램 (동의 · 단계 타이머) ──
  async getEditorProgram(userId) {
    const doc = await fs.collection('editor_programs').doc(userId).get()
    return doc.exists ? { id: doc.id, ...doc.data() } : null
  },
  async agreeEditorProgram(userId, { guide_steps_completed } = {}) {
    const config = await db.getEditorProgramConfig()
    const requiredSteps = config.guide_cards.length
    if (!guide_steps_completed || guide_steps_completed < requiredSteps) {
      return { error: 'guide_incomplete', message: `안내 카드 ${requiredSteps}개를 모두 확인한 후 동의해주세요.` }
    }
    await fs.collection('editor_programs').doc(userId).set({
      user_id: userId,
      agreed_at: now(),
      terms_version: config.terms_version,
      guide_steps_completed,
      status: 'active',
      active_workbook_id: null,
      stage_started_at: null,
      updated_at: now(),
    }, { merge: true })
    return db.getEditorProgram(userId)
  },
  async resetEditorProgram(userId, reason = 'timeout') {
    const subs = await db.getWorkbookSubmissionsByUser(userId)
    if (subs.length) {
      const batch = fs.batch()
      subs.forEach(s => batch.delete(fs.collection('workbook_submissions').doc(s.id)))
      await batch.commit()
    }
    await fs.collection('editor_programs').doc(userId).set({
      user_id: userId,
      agreed_at: null,
      terms_version: null,
      status: 'reset',
      guide_steps_completed: null,
      reset_reason: reason,
      reset_at: now(),
      active_workbook_id: null,
      stage_started_at: null,
      updated_at: now(),
    }, { merge: true })
    return { reset: true, reason }
  },
  async checkAndHandleProgramTimeout(userId) {
    const program = await db.getEditorProgram(userId)
    if (!program?.agreed_at || !program.stage_started_at || !program.active_workbook_id) {
      return { timed_out: false, program }
    }
    const config = await db.getEditorProgramConfig()
    const workbook = await db.getEditorWorkbookById(program.active_workbook_id)
    const minutes = getWorkbookStageMinutes(workbook, config)
    if (isStageWithinTimer(program.stage_started_at, minutes)) {
      return {
        timed_out: false,
        program,
        deadline_at: stageDeadlineIso(program.stage_started_at, minutes),
        stage_minutes: minutes,
      }
    }
    await db.resetEditorProgram(userId, 'timeout')
    return {
      timed_out: true,
      message: `제한 시간(${minutes}분) 내에 미션을 완료하지 못해 처음부터 다시 시작해야 합니다.`,
    }
  },
  async beginWorkbookStage(userId, workbookId) {
    const timeout = await db.checkAndHandleProgramTimeout(userId)
    if (timeout.timed_out) return { error: 'timeout_reset', message: timeout.message }
    const program = await db.getEditorProgram(userId)
    if (!program?.agreed_at) return { error: 'not_agreed', message: '안내 문구에 동의한 후 프로그램을 시작해주세요.' }
    const config = await db.getEditorProgramConfig()
    const [workbooks, submissions] = await Promise.all([
      db.getEditorWorkbooks(),
      db.getWorkbookSubmissionsByUser(userId),
    ])
    const active = getActiveWorkbookForProgram(workbooks, submissions)
    const workbook = workbooks.find(w => w.id === workbookId)
    if (!workbook) return { error: 'not_found' }
    const minutes = getWorkbookStageMinutes(workbook, config)
    const sub = submissions.find(s => s.workbook_id === workbookId)
    if (sub?.status === 'passed') {
      return {
        view_only: true,
        stage_started_at: null,
        deadline_at: null,
        stage_minutes: minutes,
        stage_num: workbook.stage_num,
        stage_title: getStageConfigForWorkbook(workbook, config)?.title || null,
      }
    }
    if (!active || active.id !== workbookId) {
      return { error: 'not_active_stage', message: '현재 진행 중인 메일만 열 수 있습니다.' }
    }
    let stageStartedAt = program.stage_started_at
    if (program.active_workbook_id !== workbookId || !stageStartedAt) {
      stageStartedAt = now()
      await fs.collection('editor_programs').doc(userId).update({
        active_workbook_id: workbookId,
        stage_started_at: stageStartedAt,
        updated_at: now(),
      })
    }
    return {
      stage_started_at: stageStartedAt,
      deadline_at: stageDeadlineIso(stageStartedAt, minutes),
      stage_minutes: minutes,
      stage_num: workbook.stage_num,
      stage_title: getStageConfigForWorkbook(workbook, config)?.title || null,
      position_in_stage: workbook.position_in_stage,
    }
  },
  async clearWorkbookStageTimer(userId) {
    const program = await db.getEditorProgram(userId)
    if (!program) return
    const config = await db.getEditorProgramConfig()
    const [workbooks, submissions] = await Promise.all([
      db.getEditorWorkbooks(),
      db.getWorkbookSubmissionsByUser(userId),
    ])
    const stagesCompleted = countCompletedStages(getStageCompletionStatus(config, workbooks, submissions))
    const update = {
      active_workbook_id: null,
      stage_started_at: null,
      updated_at: now(),
      status: stagesCompleted >= config.stage_count ? 'completed' : 'active',
    }
    await fs.collection('editor_programs').doc(userId).update(update)
  },

  // ── 에디터즈 워크북 (의뢰 메일 미션) ──
  async getEditorWorkbooks() {
    const snap = await fs.collection('editor_workbooks').orderBy('order_num').get()
    return snapToArr(snap)
  },
  async getEditorWorkbookById(id) {
    const doc = await fs.collection('editor_workbooks').doc(id).get()
    return docToObj(doc)
  },
  async getWorkbookSubmissionsByUser(userId) {
    const snap = await fs.collection('workbook_submissions').where('user_id', '==', userId).get()
    return snapToArr(snap)
  },
  async getWorkbookSubmission(userId, workbookId) {
    const subs = await db.getWorkbookSubmissionsByUser(userId)
    const sub = subs.find(s => s.workbook_id === workbookId)
    return sub || null
  },
  isWorkbookUnlocked(workbooks, submissions, orderNum) {
    if (orderNum <= 1) return true
    const prev = workbooks.find(w => w.order_num === orderNum - 1)
    if (!prev) return true
    const sub = submissions.find(s => s.workbook_id === prev.id && s.status === 'passed')
    return !!sub
  },
  async getEditorWorkbookProgress(userId) {
    const config = await db.getEditorProgramConfig()
    const stageRequired = config.stage_count
    const totalMails = getTotalMailCountFromConfig(config)
    const timeout = await db.checkAndHandleProgramTimeout(userId)
    if (timeout.timed_out) {
      return {
        required: stageRequired,
        stage_count: stageRequired,
        total_mails: totalMails,
        mails_passed: 0,
        total: 0,
        passed: 0,
        can_apply: false,
        needs_agreement: true,
        timed_out: true,
        timeout_message: timeout.message,
        workbooks: [],
        stages: [],
        stage_progress: [],
        program: null,
        guide_card_count: config.guide_cards.length,
      }
    }
    const program = await db.getEditorProgram(userId)
    const [workbooks, submissions] = await Promise.all([
      db.getEditorWorkbooks(),
      db.getWorkbookSubmissionsByUser(userId),
    ])
    const stageProgress = getStageCompletionStatus(config, workbooks, submissions)
    const stagesCompleted = countCompletedStages(stageProgress)
    const mailsPassed = submissions.filter(s => s.status === 'passed').length

    if (!program?.agreed_at) {
      return {
        required: stageRequired,
        stage_count: stageRequired,
        total_mails: totalMails,
        mails_passed: mailsPassed,
        total: workbooks.length,
        passed: stagesCompleted,
        can_apply: false,
        needs_agreement: true,
        workbooks: [],
        stages: [],
        stage_progress: stageProgress,
        program: program || null,
        guide_card_count: config.guide_cards.length,
      }
    }
    const active = getActiveWorkbookForProgram(workbooks, submissions)
    const activeMinutes = getWorkbookStageMinutes(active, config)
    const withinTimer = program.active_workbook_id
      && isStageWithinTimer(program.stage_started_at, activeMinutes)
    const visibleWbs = getVisibleWorkbooks(workbooks, submissions, active)

    const items = visibleWbs.map(wb => {
      const sub = submissions.find(s => s.workbook_id === wb.id)
      const unlocked = db.isWorkbookUnlocked(workbooks, submissions, wb.order_num)
      const isActiveStage = active?.id === wb.id
      const stageInfo = getStageConfigForWorkbook(wb, config)
      const state = resolveWorkbookItemState(sub, unlocked, {
        isActiveStage,
        withinTimer: isActiveStage && withinTimer,
        stageNotStarted: isActiveStage && !program.stage_started_at,
      })
      const submission = sub ? {
        deliverable_url: sub.deliverable_url,
        work_notes: sub.work_notes,
        feedback: sub.feedback,
        submitted_at: sub.submitted_at,
        locked_until: sub.locked_until || null,
      } : null
      return sanitizeWorkbookListItem(wb, { ...state, submission }, {
        isActiveStage,
        visible: true,
        stageInfo,
      })
    })

    const stages = stageProgress.map(stage => ({
      ...stage,
      is_current: active?.stage_num === stage.order,
      visible: stage.passed > 0 || active?.stage_num === stage.order,
    })).filter(s => s.visible)

    return {
      required: stageRequired,
      stage_count: stageRequired,
      total_mails: totalMails,
      mails_passed: mailsPassed,
      total: workbooks.length,
      passed: stagesCompleted,
      can_apply: stagesCompleted >= stageRequired,
      needs_agreement: false,
      program: {
        agreed_at: program.agreed_at,
        active_workbook_id: program.active_workbook_id,
        stage_started_at: program.stage_started_at,
        deadline_at: withinTimer ? stageDeadlineIso(program.stage_started_at, activeMinutes) : null,
        stage_minutes: activeMinutes,
        active_order: active?.order_num || null,
        active_stage: active?.stage_num || null,
        active_stage_title: active ? getStageConfigForWorkbook(active, config)?.title : null,
      },
      stages,
      stage_progress: stageProgress,
      workbooks: items,
      guide_card_count: config.guide_cards.length,
    }
  },
  async submitEditorWorkbook(userId, workbookId, { deliverable_url, work_notes }) {
    const timeout = await db.checkAndHandleProgramTimeout(userId)
    if (timeout.timed_out) return { error: 'timeout_reset', message: timeout.message }
    const program = await db.getEditorProgram(userId)
    if (!program?.agreed_at) {
      return { error: 'not_agreed', message: '안내 문구에 동의한 후 프로그램을 시작해주세요.' }
    }
    const config = await db.getEditorProgramConfig()
    const workbook = await db.getEditorWorkbookById(workbookId)
    if (!workbook) return { error: 'not_found' }
    const minutes = getWorkbookStageMinutes(workbook, config)
    const [workbooks, submissions] = await Promise.all([
      db.getEditorWorkbooks(),
      db.getWorkbookSubmissionsByUser(userId),
    ])
    const active = getActiveWorkbookForProgram(workbooks, submissions)
    if (!active || active.id !== workbookId) {
      return { error: 'not_active_stage', message: '현재 진행 중인 메일만 제출할 수 있습니다.' }
    }
    if (!program.stage_started_at || !isStageWithinTimer(program.stage_started_at, minutes)) {
      await db.resetEditorProgram(userId, 'timeout')
      return { error: 'timeout_reset', message: `제한 시간(${minutes}분)이 초과되어 처음부터 다시 시작해야 합니다.` }
    }
    const existing = submissions.find(s => s.workbook_id === workbookId)
    if (existing?.status === 'passed') {
      return { error: 'already_passed', message: '이미 통과한 미션입니다.' }
    }
    const evaluation = evaluateWorkbookSubmission(workbook, { deliverable_url, work_notes })
    const data = {
      user_id: userId,
      workbook_id: workbookId,
      deliverable_url: String(deliverable_url || '').trim(),
      work_notes: String(work_notes || '').trim(),
      status: evaluation.passed ? 'passed' : 'failed',
      feedback: evaluation.feedback,
      submitted_at: now(),
      reviewed_at: now(),
      locked_until: null,
    }
    if (existing) {
      await fs.collection('workbook_submissions').doc(existing.id).update(data)
    } else {
      await fs.collection('workbook_submissions').add({ ...data, created_at: now() })
    }
    if (evaluation.passed) {
      await db.clearWorkbookStageTimer(userId)
    }
    return {
      submission: data,
      passed: evaluation.passed,
      feedback: evaluation.feedback,
      locked_until: null,
    }
  },

  async applyEditor(userId, { intro, skills, portfolio_url, experience_years, tools, location, work_type }) {
    const existing = await fs.collection('editor_applications').where('user_id', '==', userId).limit(1).get()
    const fields = {
      intro, skills, portfolio_url, experience_years, tools,
      location: location || null,
      work_type: work_type || null,
      status: 'pending',
      applied_at: now(),
    }
    let app
    if (!existing.empty) {
      const doc = existing.docs[0]
      await doc.ref.update(fields)
      app = { id: doc.id, ...doc.data(), ...fields }
    } else {
      const data = {
        user_id: userId,
        ...fields,
        reviewed_at: null,
        reject_reason: null,
        featured_until: null,
        featured_started_at: null,
      }
      const ref = await fs.collection('editor_applications').add(data)
      app = { id: ref.id, ...data }
    }
    return app
  },
  async getEditorApplication(userId) {
    const snap = await fs.collection('editor_applications').where('user_id', '==', userId).limit(1).get()
    return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() }
  },
  async getAllEditorApplications(status = null) {
    let q = fs.collection('editor_applications')
    if (status) q = q.where('status', '==', status)
    const snap = await q.get()
    return snapToArr(snap).sort((a, b) => (b.applied_at || '').localeCompare(a.applied_at || ''))
  },
  async reviewEditorApplication(appId, status, rejectReason = null) {
    const doc = await fs.collection('editor_applications').doc(appId).get()
    if (!doc.exists) return null
    const userId = doc.data().user_id
    await doc.ref.update({ status, reviewed_at: now(), reject_reason: rejectReason || null })
    if (status === 'approved') {
      await fs.collection('users').doc(userId).update({ role: 'editor' })
      await db.grantEditorFeaturedBoost(userId)
      const approvalCoupons = await db.issueEditorApprovalFeaturedCoupons(userId, doc.id)
      return { id: doc.id, ...doc.data(), status, approval_featured_coupons: approvalCoupons }
    } else if (status === 'rejected') {
      await fs.collection('users').doc(userId).update({ role: 'student' })
    }
    return { id: doc.id, ...doc.data(), status }
  },
  /** 편집자 승인 시 상위노출 7일 + 쿠폰 발급(즉시 적용) */
  async grantEditorFeaturedBoost(userId) {
    const app = await db.getEditorApplication(userId)
    if (!app || app.status !== 'approved') return null
    const until = new Date(Date.now() + EDITOR_FEATURED_DAYS * 86400000).toISOString()
    await fs.collection('editor_applications').doc(app.id).update({
      featured_until: until,
      featured_started_at: now(),
    })
    const coupon = await db.createCoupon(userId, 0, EDITOR_FEATURED_REASON, {
      coupon_type: EDITOR_FEATURED_REASON,
      featured_until: until,
    })
    await fs.collection('coupons').doc(coupon.id).update({
      status: 'used',
      used_at: now(),
      order_id: null,
      used_context: COUPON_USED_CONTEXT.EDITOR_FEATURED,
      used_target_type: 'editor_application',
      used_target_id: app.id,
      used_target_title: '에디터즈 상위노출 7일',
      used_discount: 0,
      featured_until: until,
    })
    return { featured_until: until, coupon_id: coupon.id }
  },
  async redeemEditorFeaturedCoupon(userId, couponId) {
    const couponDoc = await fs.collection('coupons').doc(couponId).get()
    if (!couponDoc.exists) return null
    const coupon = { id: couponDoc.id, ...couponDoc.data() }
    if (coupon.user_id !== userId || !isEditorFeaturedCoupon(coupon) || coupon.status !== 'available') {
      return null
    }
    const app = await db.getEditorApplication(userId)
    if (!app || app.status !== 'approved') return null
    const until = new Date(Date.now() + EDITOR_FEATURED_DAYS * 86400000).toISOString()
    await fs.collection('editor_applications').doc(app.id).update({
      featured_until: until,
      featured_started_at: now(),
    })
    await fs.collection('coupons').doc(couponId).update({
      status: 'used',
      used_at: now(),
      order_id: null,
      featured_until: until,
      used_context: COUPON_USED_CONTEXT.EDITOR_FEATURED,
      used_target_type: 'editor_application',
      used_target_id: app.id,
      used_target_title: '에디터즈 상위노출 7일',
      used_discount: coupon.amount || 0,
    })
    return { featured_until: until }
  },
  async updateEditorProfile(userId, { location, work_type, intro, portfolio_url }) {
    const app = await db.getEditorApplication(userId)
    if (!app || app.status !== 'approved') return null
    const update = { profile_updated_at: now() }
    if (location !== undefined) update.location = String(location).trim() || null
    if (work_type !== undefined) update.work_type = work_type || null
    if (intro !== undefined) update.intro = String(intro).trim().slice(0, 1000)
    if (portfolio_url !== undefined) update.portfolio_url = portfolio_url || null
    await fs.collection('editor_applications').doc(app.id).update(update)
    return db.getEditorApplication(userId)
  },
  async getEditorProfile(userId) {
    const [user, app] = await Promise.all([
      db.findUserById(userId),
      fs.collection('editor_applications').where('user_id', '==', userId).where('status', '==', 'approved').limit(1).get(),
    ])
    if (!user || user.role !== 'editor' || app.empty) return null
    return { ...user, password: undefined, ...app.docs[0].data(), app_id: app.docs[0].id }
  },
  async getApprovedEditors() {
    const snap = await fs.collection('editor_applications').where('status', '==', 'approved').get()
    const ts = Date.now()
    const editors = await Promise.all(snap.docs.map(async d => {
      const user = await db.findUserById(d.data().user_id)
      if (!user) return null
      const data = d.data()
      const featuredActive = data.featured_until && new Date(data.featured_until).getTime() > ts
      return {
        ...data,
        id: d.id,
        user_id: user.id,
        name: user.name,
        bio: user.bio || '',
        profile_image: user.profile_image || null,
        social_links: user.social_links || [],
        created_at: user.created_at,
        is_featured: featuredActive,
      }
    }))
    return editors.filter(Boolean).sort((a, b) => {
      if (a.is_featured && !b.is_featured) return -1
      if (!a.is_featured && b.is_featured) return 1
      if (a.is_featured && b.is_featured) {
        return (b.featured_until || '').localeCompare(a.featured_until || '')
      }
      return (b.reviewed_at || b.applied_at || '').localeCompare(a.reviewed_at || a.applied_at || '')
    })
  },

  // ── 메시지 ──
  async sendMessage(projectId, senderId, senderName, senderRole, content) {
    const data = { project_id: projectId, sender_id: senderId, sender_name: senderName, sender_role: senderRole, content, created_at: now(), read: false }
    const ref = await fs.collection('messages').add(data)
    return { id: ref.id, ...data }
  },
  async getMessages(projectId, since = null) {
    let q = fs.collection('messages').where('project_id', '==', projectId).orderBy('created_at', 'asc')
    if (since) q = q.where('created_at', '>', since)
    const snap = await q.get()
    return snapToArr(snap)
  },
  async markMessagesRead(projectId, userId) {
    const snap = await fs.collection('messages').where('project_id', '==', projectId).where('sender_id', '!=', userId).where('read', '==', false).get()
    const batch = fs.batch()
    snap.docs.forEach(d => batch.update(d.ref, { read: true }))
    if (!snap.empty) await batch.commit()
  },
  async getUnreadCount(projectId, userId) {
    const snap = await fs.collection('messages').where('project_id', '==', projectId).where('sender_id', '!=', userId).where('read', '==', false).get()
    return snap.size
  },

  // ── 프로젝트 진행 단계 업데이트 ──
  async updateProjectStage(projectId, stage) {
    const stageMap = { contract: 'contract', working: 'in_progress', delivered: 'delivered', completed: 'completed' }
    const status = stageMap[stage] || stage
    await fs.collection('projects').doc(projectId).update({ status, stage_updated_at: now() })
  },

  // admin stats
  async getStats() {
    const cached = cacheGet('admin:stats')
    if (cached) return cached
    const [orders, refunded, enrollments, users] = await Promise.all([
      fs.collection('orders').where('status', '==', 'paid').get(),
      fs.collection('orders').where('status', '==', 'refunded').get(),
      fs.collection('enrollments').get(),
      fs.collection('users').where('role', '==', 'student').get(),
    ])
    const todayStr = now().slice(0, 10)
    const monthStr = now().slice(0, 7)
    let revenue = 0, todayRevenue = 0, monthRevenue = 0, todayOrders = 0, monthOrders = 0, refundCount = 0
    orders.docs.forEach(d => {
      const o = d.data()
      revenue += o.amount || 0
      if ((o.paid_at || '').startsWith(todayStr)) { todayRevenue += o.amount || 0; todayOrders++ }
      if ((o.paid_at || '').startsWith(monthStr)) { monthRevenue += o.amount || 0; monthOrders++ }
    })
    refunded.docs.forEach(d => { const o = d.data(); if ((o.refunded_at || '').startsWith(monthStr)) refundCount++ })
    const result = {
      revenue, todayRevenue, monthRevenue,
      todayOrders, monthOrders,
      newStudents: enrollments.size, orderCount: orders.size,
      refundPending: refundCount, totalStudents: users.size,
    }
    cacheSet('admin:stats', result, TTL.STATS)
    return result
  },
  async getAllStudents() {
    const [usersSnap, enrollSnap, ordersSnap] = await Promise.all([
      fs.collection('users').where('role', '==', 'student').get(),
      fs.collection('enrollments').get(),
      fs.collection('orders').where('status', '==', 'paid').get(),
    ])
    const enrollCount = {}
    enrollSnap.docs.forEach(d => {
      const uid = d.data().user_id
      enrollCount[uid] = (enrollCount[uid] || 0) + 1
    })
    const paidTotal = {}
    ordersSnap.docs.forEach(d => {
      const o = d.data()
      paidTotal[o.user_id] = (paidTotal[o.user_id] || 0) + (o.amount || 0)
    })
    return usersSnap.docs.map(d => {
      const u = { id: d.id, ...d.data() }
      return { ...u, course_count: enrollCount[u.id] || 0, total_paid: paidTotal[u.id] || 0 }
    })
  },
  async getCourseStats() {
    const cached = cacheGet('admin:courseStats')
    if (cached) return cached
    const [courses, ordersSnap, enrollSnap] = await Promise.all([
      db.getCourses(false),
      fs.collection('orders').where('status', '==', 'paid').get(),
      fs.collection('enrollments').get(),
    ])
    const revenueMap = {}
    ordersSnap.docs.forEach(d => {
      const o = d.data()
      revenueMap[o.course_id] = (revenueMap[o.course_id] || 0) + (o.amount || 0)
    })
    const countMap = {}
    enrollSnap.docs.forEach(d => {
      const e = d.data()
      countMap[e.course_id] = (countMap[e.course_id] || 0) + 1
    })
    const result = courses.map(c => ({
      id: c.id,
      title: c.title,
      sale_price: c.sale_price,
      student_count: countMap[c.id] || 0,
      revenue: revenueMap[c.id] || 0,
    }))
    cacheSet('admin:courseStats', result, TTL.STATS)
    return result
  },

  async getPublicSiteStats() {
    const [courses, studentCount, reviewSnap] = await Promise.all([
      db.getCourses(true),
      db.getPublicStudentCount(),
      fs.collection('reviews').where('is_public', '==', 1).get(),
    ])
    const reviews = reviewSnap.docs.map(d => d.data())
    const ratings = reviews
      .map(r => db.normalizeReviewRating(r.rating, 0))
      .filter(n => Number.isFinite(n) && n > 0)
    const avgRating = ratings.length
      ? Math.round(ratings.reduce((s, n) => s + n, 0) / ratings.length * 10) / 10
      : 0
    return {
      studentCount,
      avgRating,
      courseCount: courses.length,
    }
  },

  async getRecentPublicOrders(limit = 20) {
    const snap = await fs.collection('orders').orderBy('paid_at', 'desc').limit(50).get()
    const orders = snapToArr(snap).filter(o => o.status === 'paid').slice(0, limit)
    return Promise.all(orders.map(async o => {
      const [u, c] = await Promise.all([
        db.findUserById(o.user_id),
        db.getCourseById(o.course_id),
      ])
      return {
        user_name: maskPublicName(u?.name),
        course_title: c?.title || '강의',
        paid_at: o.paid_at,
      }
    }))
  },

  // ── 미션 제출 검수 ──
  async getWorkbookSubmissions({ userId, workbookId } = {}) {
    let snap
    if (userId) {
      snap = await fs.collection('workbook_submissions').where('user_id', '==', userId).orderBy('created_at', 'desc').get()
    } else if (workbookId) {
      snap = await fs.collection('workbook_submissions').where('workbook_id', '==', workbookId).orderBy('created_at', 'desc').get()
    } else {
      snap = await fs.collection('workbook_submissions').orderBy('created_at', 'desc').limit(200).get()
    }
    return snapToArr(snap)
  },
  async adminReviewSubmission(submissionId, { verdict, feedback }) {
    if (!['passed', 'failed'].includes(verdict)) throw new Error('verdict must be passed or failed')
    await fs.collection('workbook_submissions').doc(submissionId).update({
      status: verdict,
      feedback: feedback || (verdict === 'passed' ? '관리자 승인으로 통과되었습니다.' : '관리자 검토 결과 반려되었습니다.'),
      reviewed_at: now(),
      admin_reviewed: true,
      updated_at: now(),
    })
    const sub = (await fs.collection('workbook_submissions').doc(submissionId).get()).data()
    if (verdict === 'passed' && sub?.user_id) {
      await db.clearWorkbookStageTimer(sub.user_id).catch(() => {})
    }
    return sub
  },

  // ── 공지사항 ──
  async getNotices({ publicOnly = false } = {}) {
    const snap = await fs.collection('notices').orderBy('created_at', 'desc').get()
    const items = snapToArr(snap)
    const sorted = [...items.filter(n => n.is_pinned), ...items.filter(n => !n.is_pinned)]
    if (publicOnly) return sorted.filter(n => n.is_public)
    return sorted
  },
  async getNoticeById(id) {
    const doc = await fs.collection('notices').doc(id).get()
    return docToObj(doc)
  },
  async createNotice({ title, content, is_public = false, is_pinned = false }) {
    const data = { title, content, is_public, is_pinned, created_at: now(), updated_at: now() }
    const ref = await fs.collection('notices').add(data)
    return { id: ref.id, ...data }
  },
  async updateNotice(id, { title, content, is_public, is_pinned }) {
    const update = { updated_at: now() }
    if (title !== undefined) update.title = title
    if (content !== undefined) update.content = content
    if (is_public !== undefined) update.is_public = is_public
    if (is_pinned !== undefined) update.is_pinned = is_pinned
    await fs.collection('notices').doc(id).update(update)
    return db.getNoticeById(id)
  },
  async deleteNotice(id) {
    await fs.collection('notices').doc(id).delete()
  },

  // ── 고객지원 문의 ──
  async createTicket({ name, email, type, subject, content, user_id = null }) {
    const data = { name, email, type: type || 'general', subject, content, status: 'open', answer: null, user_id, created_at: now(), updated_at: now(), answered_at: null }
    const ref = await fs.collection('support_tickets').add(data)
    return { id: ref.id, ...data }
  },
  async getTickets({ status } = {}) {
    let snap
    if (status && status !== 'all') {
      snap = await fs.collection('support_tickets').where('status', '==', status).orderBy('created_at', 'desc').get()
    } else {
      snap = await fs.collection('support_tickets').orderBy('created_at', 'desc').get()
    }
    return snapToArr(snap)
  },
  async getTicketById(id) {
    const doc = await fs.collection('support_tickets').doc(id).get()
    return docToObj(doc)
  },
  async answerTicket(id, { answer }) {
    const update = { answer, status: 'answered', answered_at: now(), updated_at: now() }
    await fs.collection('support_tickets').doc(id).update(update)
    return db.getTicketById(id)
  },
  async updateTicketStatus(id, status) {
    await fs.collection('support_tickets').doc(id).update({ status, updated_at: now() })
    return db.getTicketById(id)
  },
  async deleteTicket(id) {
    await fs.collection('support_tickets').doc(id).delete()
  },

  // ── FAQ ──
  async getFaqs({ publicOnly = false } = {}) {
    const key = publicOnly ? 'faqs:public' : 'faqs:all'
    const cached = cacheGet(key)
    if (cached) return cached
    const snap = await fs.collection('faqs').orderBy('sort_order', 'asc').get()
    const items = snapToArr(snap)
    const result = publicOnly ? items.filter(f => f.is_public) : items
    cacheSet(key, result, TTL.FAQS)
    return result
  },
  async getFaqById(id) {
    const doc = await fs.collection('faqs').doc(id).get()
    return docToObj(doc)
  },
  async createFaq({ question, answer, category = '일반', is_public = true, sort_order }) {
    const existing = await db.getFaqs()
    const order = sort_order !== undefined ? sort_order : (existing.length ? Math.max(...existing.map(f => f.sort_order || 0)) + 1 : 0)
    const data = { question, answer, category, is_public, sort_order: order, created_at: now(), updated_at: now() }
    const ref = await fs.collection('faqs').add(data)
    cacheInvalidate('faqs:public', 'faqs:all')
    return { id: ref.id, ...data }
  },
  async updateFaq(id, { question, answer, category, is_public, sort_order }) {
    const update = { updated_at: now() }
    if (question !== undefined) update.question = question
    if (answer !== undefined) update.answer = answer
    if (category !== undefined) update.category = category
    if (is_public !== undefined) update.is_public = is_public
    if (sort_order !== undefined) update.sort_order = sort_order
    await fs.collection('faqs').doc(id).update(update)
    cacheInvalidate('faqs:public', 'faqs:all')
    return db.getFaqById(id)
  },
  async deleteFaq(id) {
    await fs.collection('faqs').doc(id).delete()
    cacheInvalidate('faqs:public', 'faqs:all')
  },

  // ── 사이트 설정 ──
  async getSiteSettings(key) {
    const doc = await fs.collection('site_settings').doc(key).get()
    if (!doc.exists) return { pending_review_image: null, updated_at: null }
    const data = doc.data()
    return {
      pending_review_image: data.pending_review_image || null,
      updated_at: data.updated_at || null,
    }
  },
  async updateSiteSettings(key, data) {
    const update = { updated_at: now() }
    if (data.pending_review_image !== undefined) {
      update.pending_review_image = data.pending_review_image || null
    }
    await fs.collection('site_settings').doc(key).set(update, { merge: true })
    return db.getSiteSettings(key)
  },

  async getHomepageLayout() {
    const cached = cacheGet('site:homepage')
    if (cached) return cached
    const doc = await fs.collection('site_settings').doc('homepage').get()
    const data = doc.exists ? doc.data() : {}
    const result = { ...normalizeHomepageLayout(data), updated_at: data.updated_at || null }
    cacheSet('site:homepage', result, TTL.HOMEPAGE)
    return result
  },

  async updateHomepageLayout({ sections, nav, copy, categories, site } = {}) {
    cacheInvalidate('site:homepage', 'homepage:data*')
    const current = await db.getHomepageLayout()
    const next = normalizeHomepageLayout({
      sections: sections ? { ...current.sections, ...sections } : current.sections,
      nav: nav ? { ...current.nav, ...nav } : current.nav,
      copy: copy ? { ...current.copy, ...copy } : current.copy,
      categories: categories !== undefined ? categories : current.categories,
      site: site ? { ...current.site, ...site } : current.site,
    })
    await fs.collection('site_settings').doc('homepage').set({ ...next, updated_at: now() })
    return db.getHomepageLayout()
  },

  async getFooterConfig() {
    const cached = cacheGet('site:footer')
    if (cached) return cached
    const doc = await fs.collection('site_settings').doc('footer').get()
    const data = doc.exists ? doc.data() : {}
    const result = { ...normalizeFooterConfig(data), updated_at: data.updated_at || null }
    cacheSet('site:footer', result, TTL.FOOTER)
    return result
  },

  async updateFooterConfig(data) {
    const next = normalizeFooterConfig(data)
    await fs.collection('site_settings').doc('footer').set({ ...next, updated_at: now() })
    cacheInvalidate('site:footer')
    return db.getFooterConfig()
  },

  async getTestRoomConfig() {
    const cached = cacheGet('site:test_room')
    if (cached) return cached
    const doc = await fs.collection('site_settings').doc('test_room').get()
    const data = doc.exists ? doc.data() : {}
    const result = devTestRoomFallback({ ...normalizeTestRoomConfig(data), updated_at: data.updated_at || null })
    cacheSet('site:test_room', result, TTL.TEST_ROOM)
    return result
  },

  async updateTestRoomConfig(data) {
    const next = normalizeTestRoomConfig(data)
    await fs.collection('site_settings').doc('test_room').set({ ...next, updated_at: now() })
    cacheInvalidate('site:test_room')
    return db.getTestRoomConfig()
  },

  async getHeroConfig() {
    const cached = cacheGet('site:hero')
    if (cached) return cached
    const doc = await fs.collection('site_settings').doc('hero').get()
    const data = doc.exists ? doc.data() : {}
    const result = { ...normalizeHeroConfig(data), updated_at: data.updated_at || null }
    cacheSet('site:hero', result, TTL.HERO)
    return result
  },

  async updateHeroConfig(data) {
    const next = normalizeHeroConfig(data)
    await fs.collection('site_settings').doc('hero').set({ ...next, updated_at: now() })
    cacheInvalidate('site:hero', 'homepage:data*')
    return db.getHeroConfig()
  },

  async getCouponIssuanceConfig() {
    const doc = await fs.collection('site_settings').doc('coupon_issuance').get()
    if (!doc.exists) return normalizeCouponIssuanceConfig({})
    return normalizeCouponIssuanceConfig(doc.data())
  },

  async updateCouponIssuanceConfig(data) {
    const next = normalizeCouponIssuanceConfig(data)
    await fs.collection('site_settings').doc('coupon_issuance').set({ ...next, updated_at: now() })
    return db.getCouponIssuanceConfig()
  },

  async getInstructorsIntro() {
    const doc = await fs.collection('site_settings').doc('instructors_intro').get()
    if (!doc.exists) return { ...normalizeInstructorsIntro({}), updated_at: null }
    const data = doc.data()
    return { ...normalizeInstructorsIntro(data), updated_at: data.updated_at || null }
  },

  async updateInstructorsIntro(data) {
    const existing = await db.getInstructorsIntro()
    const { updated_at, ...rest } = existing || {}
    const merged = { ...rest, ...data }
    if (Array.isArray(data?.timeline)) merged.timeline = data.timeline
    const next = normalizeInstructorsIntro(merged)
    for (const item of next.timeline || []) {
      const hasContent = item.title || item.description || (item.achievements && item.achievements.length)
      if (hasContent && !String(item.year || '').trim()) {
        throw new Error(`연혁 "${item.title || '제목 없음'}" 항목에 연도가 필요합니다.`)
      }
    }
    await fs.collection('site_settings').doc('instructors_intro').set({ ...next, updated_at: now() })
    return db.getInstructorsIntro()
  },

  async getInstructors({ publicOnly = false } = {}) {
    const key = publicOnly ? 'instructors:public' : 'instructors:all'
    const cached = cacheGet(key)
    if (cached) return cached
    const snap = await fs.collection('instructors').orderBy('sort_order', 'asc').get()
    const items = snapToArr(snap)
    const result = publicOnly ? items.filter(i => i.is_published) : items
    cacheSet(key, result, TTL.INSTRUCTORS)
    return result
  },

  async getInstructorById(id) {
    const doc = await fs.collection('instructors').doc(id).get()
    return docToObj(doc)
  },

  async createInstructor(data) {
    const existing = await db.getInstructors()
    const sort_order = data.sort_order !== undefined
      ? Number(data.sort_order)
      : (existing.length ? Math.max(...existing.map(i => i.sort_order || 0)) + 1 : 1)
    const payload = {
      name: String(data.name || '').trim().slice(0, 40),
      role_title: String(data.role_title || '').trim().slice(0, 120),
      bio: String(data.bio || '').trim().slice(0, 2000),
      profile_image: data.profile_image || null,
      tags: normalizeInstructorTags(data.tags),
      sort_order,
      is_published: data.is_published === false || data.is_published === 0 ? 0 : 1,
      created_at: now(),
      updated_at: now(),
    }
    if (!payload.name) throw new Error('강사 이름은 필수입니다.')
    const ref = await fs.collection('instructors').add(payload)
    cacheInvalidate('instructors:public', 'instructors:all')
    return { id: ref.id, ...payload }
  },

  async updateInstructor(id, data) {
    const existing = await db.getInstructorById(id)
    if (!existing) return null
    const update = { updated_at: now() }
    if (data.name !== undefined) update.name = String(data.name).trim().slice(0, 40)
    if (data.role_title !== undefined) update.role_title = String(data.role_title).trim().slice(0, 120)
    if (data.bio !== undefined) update.bio = String(data.bio).trim().slice(0, 2000)
    if (data.profile_image !== undefined) update.profile_image = data.profile_image || null
    if (data.tags !== undefined) update.tags = normalizeInstructorTags(data.tags)
    if (data.sort_order !== undefined) update.sort_order = Number(data.sort_order) || 0
    if (data.is_published !== undefined) update.is_published = data.is_published ? 1 : 0
    await fs.collection('instructors').doc(id).update(update)
    cacheInvalidate('instructors:public', 'instructors:all')
    return db.getInstructorById(id)
  },

  async deleteInstructor(id) {
    await fs.collection('instructors').doc(id).delete()
    cacheInvalidate('instructors:public', 'instructors:all')
  },

  parseLiveStart,
  isFreeLiveCourse,
  courseSupportsLiveReplay,
  isLiveLectureDay,
  isLiveMaterialOpenByReview,
  isLiveCourseEnded,
  canWriteAnticipationReview,
  canModifyAnticipationReview,
  getAnticipationModifyMeta,
  getReplayOpensAt,
  getLiveResourceAccess,
  stripLiveResourceUrls,
  pickCourseCardFields,
  maskPublicName,
  isPublicReview,
  normalizeReviewRating,
  _cacheGet: cacheGet,
  _cacheSet: cacheSet,
  _cacheInvalidate: cacheInvalidate,
}

seed().catch(console.error)
seedEditorWorkbooks().catch(console.error)
seedClientCouponFaq().catch(console.error)
seedInstructorsIntroDefaults().catch(console.error)

module.exports = db
module.exports.parseLiveStart = parseLiveStart
module.exports.isFreeLiveCourse = isFreeLiveCourse
module.exports.courseSupportsLiveReplay = courseSupportsLiveReplay
module.exports.isLiveLectureDay = isLiveLectureDay
module.exports.isLiveMaterialOpenByReview = isLiveMaterialOpenByReview
module.exports.isLiveCourseEnded = isLiveCourseEnded
module.exports.isLiveReviewOpen = isLiveReviewOpen
module.exports.canWriteAnticipationReview = canWriteAnticipationReview
module.exports.canModifyAnticipationReview = canModifyAnticipationReview
module.exports.getAnticipationModifyMeta = getAnticipationModifyMeta
module.exports.getReplayOpensAt = getReplayOpensAt
module.exports.getLiveResourceAccess = getLiveResourceAccess
module.exports.stripLiveResourceUrls = stripLiveResourceUrls
module.exports.pickCourseCardFields = pickCourseCardFields
module.exports.maskPublicName = maskPublicName
module.exports.isPublicReview = isPublicReview
module.exports.normalizeReviewRating = normalizeReviewRating
module.exports.userPayload = userPayload
module.exports.EDITOR_WORK_TYPES = EDITOR_WORK_TYPES
module.exports.EDITOR_FEATURED_REASON = EDITOR_FEATURED_REASON
module.exports.CLIENT_COURSE_REWARD_REASON = CLIENT_COURSE_REWARD_REASON
module.exports.ANTICIPATION_COUPON_REASON = ANTICIPATION_COUPON_REASON
module.exports.ANTICIPATION_DISCOUNT_PERCENT = ANTICIPATION_DISCOUNT_PERCENT
module.exports.ANTICIPATION_MIN_LENGTH = ANTICIPATION_MIN_LENGTH
module.exports.ANTICIPATION_MAX_LENGTH = ANTICIPATION_MAX_LENGTH
module.exports.COURSE_REVIEW_FIVE_STAR_REASON = COURSE_REVIEW_FIVE_STAR_REASON
module.exports.COURSE_REVIEW_FIVE_STAR_DISCOUNT_PERCENT = COURSE_REVIEW_FIVE_STAR_DISCOUNT_PERCENT
module.exports.STACKABLE_COURSE_COUPON_REASONS = STACKABLE_COURSE_COUPON_REASONS
module.exports.CLIENT_PROJECT_COUPON_MIN_AMOUNT = CLIENT_PROJECT_COUPON_MIN_AMOUNT
module.exports.getTotalMailCountFromConfig = getTotalMailCountFromConfig
module.exports.DEFAULT_EDITOR_PROGRAM_CONFIG = DEFAULT_EDITOR_PROGRAM_CONFIG
module.exports.DEFAULT_HOMEPAGE_LAYOUT = DEFAULT_HOMEPAGE_LAYOUT
module.exports.DEFAULT_HOMEPAGE_COPY = DEFAULT_HOMEPAGE_COPY
module.exports.DEFAULT_HOMEPAGE_CATEGORIES = DEFAULT_HOMEPAGE_CATEGORIES
module.exports.DEFAULT_FOOTER_CONFIG = DEFAULT_FOOTER_CONFIG
module.exports.DEFAULT_HERO_CONFIG = DEFAULT_HERO_CONFIG
module.exports.DEFAULT_COUPON_ISSUANCE_CONFIG = DEFAULT_COUPON_ISSUANCE_CONFIG
module.exports.DEFAULT_INSTRUCTORS_INTRO = DEFAULT_INSTRUCTORS_INTRO

// ── 기관강의 (institution_courses / institution_codes) ──

async function getInstitutionCourses() {
  const snap = await fs.collection('institution_courses').orderBy('created_at', 'desc').get()
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

async function getInstitutionCourseById(id) {
  const doc = await fs.collection('institution_courses').doc(id).get()
  if (!doc.exists) return null
  return { id: doc.id, ...doc.data() }
}

async function createInstitutionCourse(data) {
  const ref = await fs.collection('institution_courses').add({ ...data, created_at: now() })
  return { id: ref.id, ...data }
}

async function updateInstitutionCourse(id, data) {
  await fs.collection('institution_courses').doc(id).update({ ...data, updated_at: now() })
}

async function deleteInstitutionCourse(id) {
  await fs.collection('institution_courses').doc(id).delete()
}

async function createInstitutionCode(data) {
  // data: { course_id, code, max_uses, note }
  const ref = await fs.collection('institution_codes').add({
    ...data,
    used_count: 0,
    used_by: [],
    created_at: now(),
  })
  return { id: ref.id, ...data, used_count: 0, used_by: [] }
}

async function getInstitutionCodesByCourse(courseId) {
  const snap = await fs.collection('institution_codes').where('course_id', '==', courseId).get()
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

async function validateInstitutionCode(code, userId) {
  const snap = await fs.collection('institution_codes').where('code', '==', code.toUpperCase()).limit(1).get()
  if (snap.empty) return { ok: false, reason: 'not_found' }
  const doc = snap.docs[0]
  const data = doc.data()
  if (data.used_by && data.used_by.includes(userId)) {
    return { ok: true, already: true, courseId: data.course_id, codeId: doc.id }
  }
  if (data.used_count >= data.max_uses) return { ok: false, reason: 'limit_reached' }
  return { ok: true, already: false, courseId: data.course_id, codeId: doc.id }
}

async function redeemInstitutionCode(codeId, userId) {
  const ref = fs.collection('institution_codes').doc(codeId)
  await ref.update({
    used_count: admin.firestore.FieldValue.increment(1),
    used_by: admin.firestore.FieldValue.arrayUnion(userId),
  })
  await fs.collection('institution_access').add({
    user_id: userId,
    code_id: codeId,
    redeemed_at: now(),
  })
}

async function getUserInstitutionAccess(userId) {
  const snap = await fs.collection('institution_access').where('user_id', '==', userId).get()
  const codeIds = snap.docs.map(d => d.data().code_id)
  if (!codeIds.length) return []
  const codeDocs = await fs.getAll(...codeIds.map(id => fs.collection('institution_codes').doc(id)))
  return codeDocs.filter(d => d.exists).map(d => ({ id: d.id, ...d.data() }))
}

// 열람실 전용 후기
async function getInstitutionReview(userId, courseId) {
  const snap = await fs.collection('institution_reviews')
    .where('user_id', '==', userId).where('course_id', '==', courseId).limit(1).get()
  if (snap.empty) return null
  return { id: snap.docs[0].id, ...snap.docs[0].data() }
}

async function submitInstitutionReview(userId, courseId, content) {
  const existing = await getInstitutionReview(userId, courseId)
  if (existing) {
    await fs.collection('institution_reviews').doc(existing.id).update({ content, updated_at: now() })
    return { id: existing.id }
  }
  const ref = await fs.collection('institution_reviews').add({ user_id: userId, course_id: courseId, content, created_at: now() })
  return { id: ref.id }
}

module.exports.getInstitutionReview = getInstitutionReview
module.exports.submitInstitutionReview = submitInstitutionReview

module.exports.getInstitutionCourses = getInstitutionCourses
module.exports.getInstitutionCourseById = getInstitutionCourseById
module.exports.createInstitutionCourse = createInstitutionCourse
module.exports.updateInstitutionCourse = updateInstitutionCourse
module.exports.deleteInstitutionCourse = deleteInstitutionCourse
module.exports.createInstitutionCode = createInstitutionCode
module.exports.getInstitutionCodesByCourse = getInstitutionCodesByCourse
module.exports.validateInstitutionCode = validateInstitutionCode
module.exports.redeemInstitutionCode = redeemInstitutionCode
module.exports.getUserInstitutionAccess = getUserInstitutionAccess
