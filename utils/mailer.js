/**
 * Gmail SMTP 발송 유틸리티 (nodemailer)
 *
 * .env 에 GMAIL_USER, GMAIL_APP_PASSWORD 필요.
 * (구글 계정 → 보안 → 2단계 인증 → 앱 비밀번호에서 발급)
 * 설정 전에는 실제로 보내지 않고 콘솔에 시뮬레이션 로그만 남긴다 — 이메일 미설정이 다른 기능(문의 접수 등)을 막지 않는다.
 */

const nodemailer = require('nodemailer')

let transporter = null
function getTransporter() {
  if (transporter) return transporter
  const user = process.env.GMAIL_USER
  const pass = process.env.GMAIL_APP_PASSWORD
  if (!user || !pass) return null
  transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } })
  return transporter
}

async function sendMail({ to, subject, text }) {
  const t = getTransporter()
  if (!t) {
    console.log('\n[이메일 발송 시뮬레이션 — GMAIL_USER/GMAIL_APP_PASSWORD 미설정]')
    console.log(`수신: ${to}`)
    console.log(`제목: ${subject}`)
    console.log(text)
    console.log('────────────────────\n')
    return { success: true, simulated: true }
  }
  try {
    await t.sendMail({ from: process.env.GMAIL_USER, to, subject, text })
    return { success: true }
  } catch (e) {
    console.error('이메일 발송 실패:', e.message)
    return { success: false, error: e.message }
  }
}

module.exports = { sendMail }
