const { yesterdayKstDateKey, kstDateKey } = require('./kstDate')
const { syncLoginLogsForKstDate, isSheetsConfigured } = require('./googleSheetsLoginSync')

function msUntilNextKst(hour, minute = 0) {
  const now = Date.now()
  const kstNow = new Date(now + 9 * 60 * 60 * 1000)
  const target = new Date(kstNow)
  target.setUTCHours(hour, minute, 0, 0)
  if (target.getTime() <= kstNow.getTime()) {
    target.setUTCDate(target.getUTCDate() + 1)
  }
  const targetUtcMs = target.getTime() - 9 * 60 * 60 * 1000
  return Math.max(1000, targetUtcMs - now)
}

async function runDailySync(dateKey) {
  if (!isSheetsConfigured()) {
    console.log('[login-log-sheets] Google Sheets env 미설정 — 건너뜀')
    return null
  }
  const db = require('../db/schema')
  const key = dateKey || yesterdayKstDateKey()
  console.log(`[login-log-sheets] ${key} 동기화 시작`)
  const result = await syncLoginLogsForKstDate(key, db)
  console.log('[login-log-sheets] 완료:', result)
  return result
}

function scheduleLoginLogSheetsSync() {
  const hour = Number(process.env.LOGIN_LOG_SHEETS_CRON_HOUR_KST || 1)
  const minute = Number(process.env.LOGIN_LOG_SHEETS_CRON_MINUTE_KST || 5)

  const tick = async () => {
    try {
      await runDailySync(yesterdayKstDateKey())
    } catch (e) {
      console.error('[login-log-sheets] 오류:', e.message)
    }
    setTimeout(tick, msUntilNextKst(hour, minute))
  }

  console.log(`[login-log-sheets] KST ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} 일일 동기화 예약`)
  setTimeout(tick, msUntilNextKst(hour, minute))
}

module.exports = { scheduleLoginLogSheetsSync, runDailySync, kstDateKey }
