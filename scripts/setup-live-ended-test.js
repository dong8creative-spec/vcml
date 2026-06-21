#!/usr/bin/env node
/**
 * 무료 라이브 강의 종료·다시보기 UI 테스트용 데이터 설정
 *
 * 사용법:
 *   node scripts/setup-live-ended-test.js pending   # 다시보기 대기 (다음 날 1시 전)
 *   node scripts/setup-live-ended-test.js available # 다시보기 활성
 *   node scripts/setup-live-ended-test.js reset     # 테스트 해제 (예정 상태로 복구)
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const db = require('../db/schema')

const SLUG = 'capcut-beginner-free'
const REPLAY_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
const RESET_SCHEDULE = {
  live_starts_at: '2026-06-27T05:00:00.000Z',
  live_schedule: '2026. 6. 27. 오후 2:00:00',
}

function kstParts(date) {
  const t = date.getTime() + 9 * 3600000
  const d = new Date(t)
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), day: d.getUTCDate(), hour: d.getUTCHours(), min: d.getUTCMinutes() }
}

function formatKoSchedule(date) {
  return date.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })
}

function buildSchedule(mode) {
  const now = new Date()
  const p = kstParts(now)
  let lectureUtc
  if (mode === 'pending') {
    // 오늘 오전 10시(KST) 강의 → 종료됐지만 다시보기는 내일 1시
    lectureUtc = new Date(Date.UTC(p.y, p.m, p.day, 10 - 9, 0, 0))
  } else {
    // 2일 전 오후 2시(KST) 강의 → 다시보기 이미 공개
    lectureUtc = new Date(Date.UTC(p.y, p.m, p.day - 2, 14 - 9, 0, 0))
  }
  return {
    live_starts_at: lectureUtc.toISOString(),
    live_schedule: formatKoSchedule(lectureUtc),
  }
}

async function enrollTestUsers(courseId) {
  const admin = await db.findUserByEmail('admin@tadakclass.com')
  const demo = await db.findUserByEmail('demo@tadakclass.com')
  const ids = [admin?.id, demo?.id].filter(Boolean)
  for (const uid of ids) {
    if (!await db.isEnrolled(uid, courseId)) {
      await db.enroll(uid, courseId)
      console.log('  ✓ 수강 등록:', uid)
    } else {
      console.log('  · 이미 수강 중:', uid)
    }
  }
  if (!ids.length) console.log('  ⚠ admin/demo 계정 없음 — Google 로그인 후 강의 페이지에서 신청해주세요.')
}

async function resetTest(course) {
  const patch = {
    ...RESET_SCHEDULE,
    live_status: 'upcoming',
  }
  if (course.live_replay_url === REPLAY_URL) patch.live_replay_url = null
  if (course.meet_code === 'test-meet-code') patch.meet_code = null

  await db.updateCourse(course.id, patch)
  console.log(`\n✓ 테스트 해제 — ${course.title}`)
  console.log('  일정:', RESET_SCHEDULE.live_schedule)
  console.log('  상태: upcoming')
}

async function main() {
  const mode = (process.argv[2] || 'available').toLowerCase()
  if (!['pending', 'available', 'reset'].includes(mode)) {
    console.error('사용법: node scripts/setup-live-ended-test.js [pending|available|reset]')
    process.exit(1)
  }

  const course = await db.getCourseBySlug(SLUG)
  if (!course) {
    console.error('라이ve 강의를 찾을 수 없습니다:', SLUG)
    process.exit(1)
  }

  if (mode === 'reset') {
    await resetTest(course)
    const base = process.env.APP_URL || 'http://localhost:3300'
    console.log('\n열어볼 페이지:')
    console.log(`  ${base}/course.html?slug=${SLUG}`)
    console.log(`  ${base}/mypage.html#courses`)
    return
  }

  const sched = buildSchedule(mode)
  await db.updateCourse(course.id, {
    ...sched,
    live_status: 'ended',
    live_replay_url: REPLAY_URL,
    meet_code: course.meet_code || 'test-meet-code',
  })

  console.log(`\n✓ [${mode}] 테스트 데이터 적용 — ${course.title}`)
  console.log('  일정:', sched.live_schedule)
  console.log('  상태: ended')
  console.log('  다시보기:', REPLAY_URL)

  const access = db.getLiveResourceAccess(
    { ...course, ...sched, live_status: 'ended', live_replay_url: REPLAY_URL },
    { enrolled: true }
  )
  console.log('  replay_available:', access.replay_available)
  console.log('  replay_pending:', access.replay_pending)
  if (access.replay_opens_label) console.log('  opens:', access.replay_opens_label)

  await enrollTestUsers(course.id)

  const base = process.env.APP_URL || 'http://localhost:3300'
  console.log('\n열어볼 페이지:')
  console.log(`  ${base}/live-ended-test.html`)
  console.log(`  ${base}/course.html?slug=${SLUG}`)
  console.log(`  ${base}/mypage.html#courses`)
}

main().catch(e => { console.error(e); process.exit(1) })
