/**
 * 타닥싱크 프로그램 레코드 생성(없을 때만) + 알려진 강의에 program_id 연결.
 * 일반(tadak-sync) 프로그램의 최초 코인이 레거시 100이면 10으로 맞춘다.
 *
 * 사용:
 *   node scripts/sync-course-programs.js --dry-run
 *   node scripts/sync-course-programs.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const db = require('../db/schema')

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  await new Promise(r => setTimeout(r, 800))

  const subtitle = await db.ensureDefaultSubtitleProgram()
  const views = await db.ensureDefaultViewsEditingProgram()
  console.log(dryRun ? '[dry-run]' : '[apply]', 'programs:', {
    subtitle: { id: subtitle.id, slug: subtitle.slug, name: subtitle.name, initial_coins: subtitle.initial_coins },
    views: { id: views.id, slug: views.slug, name: views.name, initial_coins: views.initial_coins },
  })

  // 일반 다운로드(초신속 등) 최초 코인: 레거시 100 → 10
  if (!dryRun && Number(subtitle.initial_coins) === 100) {
    await db.updateCourseProgram(subtitle.id, { initial_coins: db.SUBTITLE_INITIAL_COINS })
    console.log(`[coins] ${subtitle.slug} initial_coins 100 → ${db.SUBTITLE_INITIAL_COINS}`)
  }

  // 관리자 목록에서 구분이 되도록 조회수 프로그램 이름만 1회 정리 (코인/스토리지는 유지)
  if (!dryRun && views.name === '조회수 편집법 코인') {
    await db.updateCourseProgram(views.id, { name: '타닥싱크 · 조회수 편집법' })
    console.log('[rename] views program name → 타닥싱크 · 조회수 편집법')
  }

  if (dryRun) {
    for (const slug of [db.SUBTITLE_COURSE_SLUG, db.VIEWS_EDITING_COURSE_SLUG]) {
      const course = await db.getCourseBySlug(slug)
      const program = await db.getProgramForCourse(course)
      console.log('[dry-run] course', {
        slug,
        stored_program_id: course?.program_id || null,
        resolved: program ? { id: program.id, slug: program.slug } : null,
        needs_link: course && program && course.program_id !== program.id,
      })
    }
    return
  }

  const linked = await db.linkDefaultProgramIdsForKnownCourses()
  console.log('[linked]', linked)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
