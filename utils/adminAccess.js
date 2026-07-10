/** 관리자 페이지·API 접근 허용 이메일 (ADMIN_EMAILS) */
function parseAdminEmails() {
  const raw = process.env.ADMIN_EMAILS || ''
  return raw.split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
}

function isAllowedAdmin(user) {
  if (!user) return false
  if (user.role !== 'admin') return false
  const email = String(user.email || '').trim().toLowerCase()
  if (!email) return false
  const allowlist = parseAdminEmails()
  if (!allowlist.length) return true
  return allowlist.includes(email)
}

/** 마스터·관리자 — 강의 시작 2시간 전 등 시간 게이트 우회 */
function bypassesLectureTimeGate(user) {
  return !!user && user.role === 'admin'
}

module.exports = { parseAdminEmails, isAllowedAdmin, bypassesLectureTimeGate }
