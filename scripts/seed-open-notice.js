#!/usr/bin/env node
/** 6월 30일 정식 오픈 공지 등록 (중복 시 스킵) */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const db = require('../db/schema')

const NOTICE_TITLE = '6월 30일 정식 오픈 안내 — 캡컷 PRO 강의'

const NOTICE_CONTENT = `안녕하세요, 타닥클래스입니다.

타닥클래스는 2026년 6월 30일(월) 정식 오픈을 목표로 준비하고 있습니다.

■ 정식 오픈 시 제공 예정 강의 (캡컷 PRO)

1. 캡컷 초보자반 — 캡컷을 처음 시작하는 분을 위한 무료 입문 강의
2. 캡컷 PRO 기초반 — 캡컷 PRO 핵심 기능과 기본 편집 워크플로
3. 캡컷 PRO 초고속 영상제작반 — 기획·촬영·편집·납품까지 실무 속도로 완성
4. 캡컷 PRO 영상납품 수익화 — 영상 납품 실무와 수익화 심화 과정

현재는 오픈 베타 기간으로 Google 로그인을 통해 서비스를 미리 이용해 보실 수 있습니다.
정식 오픈 전후 강의 순차 오픈 일정은 공지사항을 통해 다시 안내드리겠습니다.

감사합니다.
타닥클래스 드림`

async function seed() {
  const existing = await db.getNotices()
  const dup = existing.find(n => n.title === NOTICE_TITLE)
  if (dup) {
    console.log('ℹ 이미 등록된 공지입니다:', dup.id)
    process.exit(0)
  }

  const notice = await db.createNotice({
    title: NOTICE_TITLE,
    content: NOTICE_CONTENT,
    is_public: true,
    is_pinned: true,
  })
  console.log('✓ 공지 등록 완료:', notice.id)
  console.log('  · 제목:', notice.title)
  process.exit(0)
}

seed().catch(e => { console.error(e); process.exit(1) })
