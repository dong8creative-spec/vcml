#!/usr/bin/env node
/** 타닥싱크 요금 정책 정식 오픈 공지 등록·수정 (기존 타닥싱크 요금 공지가 있으면 업데이트) */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const db = require('../db/schema')

const NOTICE_TITLE = '타닥싱크 2 요금 정책 정식 오픈 안내 — 8월 1일(토)'

const NOTICE_CONTENT = `안녕하세요, 타닥클래스입니다.

타닥싱크 2(TadakSync 2)의 요금·구독 정책을 아래 일정에 맞춰 정식 공개합니다.

■ 정식 오픈 일시

2026년 8월 1일(토) (한국 시간)

위 날짜부터 타닥클래스 웹사이트의 「요금 안내」 페이지에 전체 요금 정책이 공개됩니다.

■ 오픈 시 안내 예정 내용

· 종량제(코인 충전) — 1코인 15원 기준
· 월 구독 PRO — 월 11,000원, 매월 1,100코인 제공 (종량제 대비 약 33% 저렴)
· 코인 차감 기준 — 전문 인식 (30초 단위), 맥락 번역 (20초 단위), 직접 줄 나눔 (1회 1코인)
· 캡컷 프로젝트 직접 삽입 — 모든 요금제에서 이용 가능

자세한 비교표·이용 시나리오는 오픈 후 타닥싱크 요금 안내 페이지에서 확인하실 수 있습니다.
(https://vcml.kr/subtitle-tool/pricing.html)

■ 오픈 전까지 이용 안내

정식 요금 공개 전까지는 기존과 같이 기본 10코인과 매일 출석 +1코인으로 프로그램을 이용하실 수 있습니다.
구독·코인 충전 결제는 정식 오픈 이후 순차적으로 제공될 예정입니다.

이용 중 궁금한 점은 1:1 문의를 이용해 주세요.

감사합니다.
타닥클래스 드림`

const NOTICE_TITLE_PATTERN = /타닥싱크 2 요금 정책 정식 오픈/

async function seed() {
  const existing = await db.getNotices()
  const prev = existing.find(n => NOTICE_TITLE_PATTERN.test(n.title || ''))
  if (prev) {
    const updated = await db.updateNotice(prev.id, {
      title: NOTICE_TITLE,
      content: NOTICE_CONTENT,
      is_public: true,
      is_pinned: true,
    })
    console.log('✓ 공지 수정 완료:', updated.id)
    console.log('  · 제목:', updated.title)
    process.exit(0)
  }

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
