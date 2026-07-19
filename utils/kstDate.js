/** KST(UTC+9) 날짜 키 · 표시용 포맷 */

function toKstDate(date = new Date()) {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000)
}

function kstDateKey(date = new Date()) {
  return toKstDate(date).toISOString().slice(0, 10)
}

function formatKstDateTime(iso) {
  if (!iso) return ''
  const d = toKstDate(new Date(iso))
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

function yesterdayKstDateKey(date = new Date()) {
  const kst = toKstDate(date)
  kst.setUTCDate(kst.getUTCDate() - 1)
  return kst.toISOString().slice(0, 10)
}

module.exports = { toKstDate, kstDateKey, formatKstDateTime, yesterdayKstDateKey }
