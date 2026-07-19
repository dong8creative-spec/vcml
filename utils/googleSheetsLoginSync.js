const jwt = require('jsonwebtoken')
const { formatKstDateTime } = require('./kstDate')

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets']

function sheetsConfig() {
  const spreadsheetId = (process.env.GOOGLE_SHEETS_SPREADSHEET_ID || '').trim()
  const tab = (process.env.GOOGLE_SHEETS_LOGIN_LOG_TAB || '로그인기록').trim()
  let credentials = null
  const raw = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON || ''
  if (raw) {
    try {
      credentials = JSON.parse(raw)
    } catch {
      throw new Error('GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON 형식이 올바르지 않습니다.')
    }
  }
  return { spreadsheetId, tab, credentials }
}

function isSheetsConfigured() {
  try {
    const { spreadsheetId, credentials } = sheetsConfig()
    return !!(spreadsheetId && credentials?.client_email && credentials?.private_key)
  } catch {
    return false
  }
}

async function getAccessToken(credentials) {
  const now = Math.floor(Date.now() / 1000)
  const assertion = jwt.sign(
    {
      iss: credentials.client_email,
      scope: SCOPES.join(' '),
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    },
    credentials.private_key,
    { algorithm: 'RS256' }
  )
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  const data = await res.json()
  if (!data.access_token) {
    throw new Error(data.error_description || data.error || 'Google OAuth 토큰 발급 실패')
  }
  return data.access_token
}

const METHOD_LABEL = {
  email: '이메일',
  google: 'Google',
  kakao: 'Kakao',
  register: '회원가입',
  subtitle_app: '타닥싱크 앱',
}

function logToRow(log) {
  return [
    formatKstDateTime(log.created_at),
    log.email || '',
    log.user_name || '',
    log.user_id || '',
    METHOD_LABEL[log.method] || log.method || '',
    log.success ? '성공' : '실패',
    log.failure_reason || '',
    log.ip || '',
    log.user_agent || '',
    log.client || '',
  ]
}

const HEADER_ROW = ['일시(KST)', '이메일', '이름', 'user_id', '로그인방식', '성공여부', '실패사유', 'IP', 'User-Agent', '클라이언트']

async function ensureHeaderRow(accessToken, spreadsheetId, tab) {
  const range = encodeURIComponent(`${tab}!A1:J1`)
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  const data = await res.json()
  const first = data.values?.[0]?.[0]
  if (first === HEADER_ROW[0]) return
  await fetch(`${url}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values: [HEADER_ROW] }),
  })
}

async function appendLoginLogRows(logs) {
  if (!logs?.length) return { appended: 0 }
  const { spreadsheetId, tab, credentials } = sheetsConfig()
  if (!spreadsheetId || !credentials) {
    throw new Error('Google Sheets 연동 env가 설정되지 않았습니다.')
  }
  const accessToken = await getAccessToken(credentials)
  await ensureHeaderRow(accessToken, spreadsheetId, tab)
  const range = encodeURIComponent(`${tab}!A:J`)
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values: logs.map(logToRow) }),
  })
  const data = await res.json()
  if (data.error) {
    throw new Error(data.error.message || 'Google Sheets append 실패')
  }
  return { appended: logs.length, updates: data.updates || null }
}

async function syncLoginLogsForKstDate(dateKey, db) {
  const logs = await db.getLoginLogsForKstDate(dateKey, { unsyncedOnly: true })
  if (!logs.length) {
    return { dateKey, appended: 0, skipped: true, message: '동기화할 새 로그가 없습니다.' }
  }
  const result = await appendLoginLogRows(logs)
  await db.markLoginLogsSheetsSynced(
    logs.map((l) => l.id),
    dateKey,
    { row_count: logs.length }
  )
  return { dateKey, appended: result.appended, log_count: logs.length }
}

module.exports = {
  isSheetsConfigured,
  sheetsConfig,
  syncLoginLogsForKstDate,
  appendLoginLogRows,
  HEADER_ROW,
}
