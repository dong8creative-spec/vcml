#!/usr/bin/env node
/** 어제(KST) 또는 --date=YYYY-MM-DD 로그인 로그를 Google Sheets에 append */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })

const { runDailySync, kstDateKey } = require('../utils/loginLogSheetsCron')
const { yesterdayKstDateKey } = require('../utils/kstDate')

async function main() {
  const arg = process.argv.find((a) => a.startsWith('--date='))
  const dateKey = arg ? arg.split('=')[1] : yesterdayKstDateKey()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    console.error('사용법: node scripts/sync-login-logs-to-sheets.js [--date=YYYY-MM-DD]')
    process.exit(1)
  }
  const result = await runDailySync(dateKey)
  if (!result) {
    console.error('Google Sheets env 미설정')
    process.exit(2)
  }
  console.log(JSON.stringify(result, null, 2))
}

main().catch((e) => {
  console.error(e.message || e)
  process.exit(1)
})
