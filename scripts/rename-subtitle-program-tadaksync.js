/**
 * 도각 자막패치 → 타닥싱크(TadakSync) 프로그램 메타 갱신
 *
 * 사용:
 *   node scripts/rename-subtitle-program-tadaksync.js --dry-run
 *   node scripts/rename-subtitle-program-tadaksync.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const db = require('../db/schema')

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  await new Promise(r => setTimeout(r, 800))

  if (dryRun) {
    const byNew = await db.getCourseProgramBySlug('tadak-sync')
    const byOld = await db.getCourseProgramBySlug('dogak-subtitle')
    console.log('[dry-run] tadak-sync:', byNew ? { id: byNew.id, name: byNew.name, storage_path: byNew.storage_path } : null)
    console.log('[dry-run] dogak-subtitle:', byOld ? { id: byOld.id, name: byOld.name, storage_path: byOld.storage_path } : null)
    return
  }

  const program = await db.ensureDefaultSubtitleProgram()
  console.log('[apply] program:', {
    id: program.id,
    slug: program.slug,
    name: program.name,
    storage_path: program.storage_path,
    feature_label: program.feature_label,
  })
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
