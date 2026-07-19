const db = require('../db/schema')

function safeUserAgent(req) {
  return String(req?.headers?.['user-agent'] || '').slice(0, 500) || null
}

/** 로그인 기록 — 실패해도 로그인 흐름을 막지 않는다 */
async function recordLoginLog(req, payload) {
  try {
    const { clientIp } = require('../middleware/auth')
    await db.recordLoginLog({
      ...payload,
      ip: payload.ip ?? clientIp(req),
      user_agent: payload.user_agent ?? safeUserAgent(req),
    })
  } catch (e) {
    console.error('recordLoginLog:', e.message)
  }
}

module.exports = { recordLoginLog, safeUserAgent }
