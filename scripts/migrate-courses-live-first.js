/**
 * 기존 강의를 live_first로 전환하고 타닥싱크(TadakSync) 프로그램을 연결합니다.
 *
 * 사용:
 *   node scripts/migrate-courses-live-first.js --dry-run
 *   node scripts/migrate-courses-live-first.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const db = require('../db/schema')

const LIVE_END_AFTER_MS = 3 * 60 * 60 * 1000

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  await new Promise(r => setTimeout(r, 1200))

  const program = await db.ensureDefaultSubtitleProgram()
  console.log(dryRun ? '[dry-run]' : '[apply]', 'program:', program.id, program.slug)

  const courses = await db.getCourses(false)
  let changedCount = 0

  for (const course of courses) {
    const patch = {
      delivery_mode: 'live_first',
      updated_at: new Date().toISOString(),
    }

    let startsAt = course.live_starts_at || null
    if (!startsAt && course.checkout_ends_at) startsAt = course.checkout_ends_at
    if (startsAt) {
      const d = new Date(startsAt)
      if (!isNaN(d.getTime())) {
        patch.live_starts_at = d.toISOString()
        if (!course.live_schedule) {
          patch.live_schedule = d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
        }
        startsAt = patch.live_starts_at
      } else {
        startsAt = null
      }
    }

    let endsAt = course.live_ends_at || null
    if (!endsAt && startsAt) {
      endsAt = new Date(new Date(startsAt).getTime() + LIVE_END_AFTER_MS).toISOString()
    }
    if (endsAt) patch.live_ends_at = endsAt

    if (!course.live_status) {
      patch.live_status = startsAt && new Date(startsAt) < new Date() ? 'ended' : 'upcoming'
    }

    if (course.slug === 'capcut-pro-basic') {
      patch.program_id = program.id
    }

    // 시작 일시가 없으면 비공개 (관리자 입력 대기)
    if (!startsAt) {
      patch.is_published = 0
    }

    const changedKeys = Object.keys(patch).filter(k => {
      if (k === 'updated_at') return false
      return String(course[k] ?? '') !== String(patch[k] ?? '')
    })
    const changed = changedKeys.length > 0
    if (changed) changedCount++

    console.log(
      `${changed ? 'UPDATE' : 'skip '} ${course.slug}` +
      ` | starts=${patch.live_starts_at || course.live_starts_at || '-'}` +
      ` | ends=${patch.live_ends_at || course.live_ends_at || '-'}` +
      ` | program=${patch.program_id || course.program_id || '-'}` +
      `${patch.is_published === 0 && course.is_published ? ' [UNPUBLISH]' : ''}`
    )

    if (!dryRun && changed) {
      await db.updateCourse(course.id, patch)
    }
  }

  console.log(`total=${courses.length} changed=${changedCount} dryRun=${dryRun}`)
  process.exit(0)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
