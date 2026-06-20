/**
 * 카카오 알림톡 발송 유틸리티
 *
 * 수강생 구조:
 *   - 카카오 로그인 → kakao_id 보유, 전화번호는 온보딩에서 선택 입력
 *   - 전화번호 있는 수강생만 알림톡 발송 (없으면 조용히 스킵)
 *
 * 운영 전환 시:
 *   1. business.kakao.com 에서 카카오 비즈니스 채널 개설
 *   2. 솔라피(solapi.com) 또는 알리고(aligo.in) 가입 후 채널 연동
 *   3. 아래 알림톡 템플릿을 대행사에서 카카오 심사 등록
 *   4. .env 에 ALIMTALK_API_KEY, ALIMTALK_API_SECRET, ALIMTALK_SENDER_KEY 추가
 *   5. npm install solapi 후 아래 주석 해제
 */

const IS_PROD = process.env.NODE_ENV === 'production'

// ── 템플릿 코드 (카카오 심사 후 발급받은 코드로 교체) ──
const TEMPLATES = {
  COUPON_ISSUED:  process.env.ALIMTALK_TMPL_COUPON || 'TMPL_COUPON_001',
  LIVE_INVITE:    process.env.ALIMTALK_TMPL_LIVE   || 'TMPL_LIVE_001',
}

async function sendAlimtalk({ to, templateCode, variables }) {
  const phone = to.replace(/[^0-9]/g, '')
  if (!phone) return { skipped: true, reason: '전화번호 없음' }

  if (!IS_PROD) {
    console.log('\n[카카오 알림톡 시뮬레이션]')
    console.log(`수신: ${phone}`)
    console.log(`템플릿: ${templateCode}`)
    console.log('변수:', variables)
    console.log('────────────────────\n')
    return { success: true, simulated: true }
  }

  // 운영: 솔라피 카카오 알림톡
  // const SolapiMessageService = require('solapi').SolapiMessageService
  // const service = new SolapiMessageService(process.env.ALIMTALK_API_KEY, process.env.ALIMTALK_API_SECRET)
  // return await service.sendOne({
  //   to: phone,
  //   from: process.env.ALIMTALK_SENDER_KEY,
  //   kakaoOptions: {
  //     pfId: process.env.ALIMTALK_PFID,   // 플러스친구 ID
  //     templateId: templateCode,
  //     variables,
  //   },
  // })

  throw new Error('운영 환경 알림톡 설정이 필요합니다. utils/kakaoMessage.js를 확인하세요.')
}

/**
 * 마케팅 동의 + 쿠폰 발급 알림톡
 *
 * 카카오 심사 등록 템플릿 문안:
 * ───────────────────────────────
 * [타닥클래스] #{이름}님, 마케팅 정보 수신에 동의해 주셔서 감사합니다.
 *
 * ✔ 5,000원 할인 쿠폰이 발급되었습니다.
 * 쿠폰번호: #{쿠폰번호}
 *
 * 마이페이지 > 내 쿠폰에서 확인하세요.
 *
 * [쿠폰 확인하기]
 * ───────────────────────────────
 * 수신거부: 마이페이지 > 계정 설정 > 마케팅 수신 철회
 */
async function sendCouponIssuedMessage(phone, name, couponCode) {
  if (!phone) return { skipped: true, reason: '전화번호 없음 — 알림톡 미발송' }
  return sendAlimtalk({
    to: phone,
    templateCode: TEMPLATES.COUPON_ISSUED,
    variables: { 이름: name, 쿠폰번호: couponCode },
  })
}

/**
 * 라이브 강의 Google Meet 초대 알림톡
 *
 * 카카오 심사 등록 템플릿 문안:
 * ───────────────────────────────
 * [타닥클래스] #{이름}님, 라이브 강의가 곧 시작됩니다!
 *
 * 📹 #{강의명}
 * 🕐 #{일정}
 *
 * Google Meet 참여 코드: #{미트코드}
 * 아래 링크로 바로 입장하세요.
 * meet.google.com/#{미트코드}
 *
 * [라이브 입장하기]
 * ───────────────────────────────
 * 문의: 마이페이지 > 고객센터
 */
async function sendLiveInviteMessage(phone, name, courseTitle, schedule, meetCode) {
  if (!phone) return { skipped: true, reason: '전화번호 없음 — 알림톡 미발송' }
  return sendAlimtalk({
    to: phone,
    templateCode: TEMPLATES.LIVE_INVITE,
    variables: { 이름: name, 강의명: courseTitle, 일정: schedule, 미트코드: meetCode },
  })
}

module.exports = { sendAlimtalk, sendCouponIssuedMessage, sendLiveInviteMessage }
