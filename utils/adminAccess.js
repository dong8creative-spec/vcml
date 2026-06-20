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

module.exports = { parseAdminEmails, isAllowedAdmin }
