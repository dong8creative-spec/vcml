/**
 * 1:1 문의 자동응답 — 정책/템플릿 기반 (AI가 실시간으로 답을 지어내지 않음)
 *
 * 결제·환불 관련은 절대 자동으로 결론(환불 가능/불가)을 내리지 않는다.
 * 실제 정책 안내 + "담당자가 개별 확인 후 연락드립니다"로 항상 사람 확인으로 넘긴다.
 */

const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://vcml.kr'

function template({ name, greeting, body, closing }) {
  const who = name ? `${name}님, ` : ''
  return [`${who}${greeting}`, '', body, '', closing].join('\n')
}

const REPLIES = {
  payment: (name) => template({
    name,
    greeting: '문의 남겨주셔서 감사합니다.',
    body: [
      '결제·환불 관련 문의는 자동으로 결과를 안내해드리지 않고, 담당자가 주문 내역을 직접 확인한 뒤 답변드립니다.',
      '',
      `환불 정책 참고: ${SITE_ORIGIN}/refund.html`,
      '(요약: 구매 후 7일 이내 + 강의를 1강도 수강하지 않은 경우 환불 가능, 접수 후 5일 이내 처리)',
    ].join('\n'),
    closing: '담당자가 영업일 기준 1~2일 내 개별 연락드립니다. 조금만 기다려주세요.',
  }),
  course: (name) => template({
    name,
    greeting: '문의 남겨주셔서 감사합니다.',
    body: [
      '강의 관련 자주 묻는 질문은 아래에서 먼저 확인하실 수 있습니다.',
      '',
      `자주 묻는 질문: ${SITE_ORIGIN}/faq.html`,
    ].join('\n'),
    closing: '해당 내용으로 해결되지 않으면 담당자가 영업일 기준 1~2일 내 개별 연락드립니다.',
  }),
  account: (name) => template({
    name,
    greeting: '문의 남겨주셔서 감사합니다.',
    body: [
      '계정 관련 정보는 마이페이지에서 대부분 직접 확인·수정하실 수 있습니다.',
      '',
      `마이페이지: ${SITE_ORIGIN}/mypage.html`,
    ].join('\n'),
    closing: '그 외 계정 문제는 담당자가 영업일 기준 1~2일 내 개별 연락드립니다.',
  }),
  editor: (name) => template({
    name,
    greeting: '문의 남겨주셔서 감사합니다.',
    body: [
      '편집자(에디터즈) 관련 안내는 아래 페이지에서 확인하실 수 있습니다.',
      '',
      `에디터즈 안내: ${SITE_ORIGIN}/editors.html`,
      `지원하기: ${SITE_ORIGIN}/editor-apply.html`,
    ].join('\n'),
    closing: '추가로 궁금한 점은 담당자가 영업일 기준 1~2일 내 개별 연락드립니다.',
  }),
  general: (name) => template({
    name,
    greeting: '문의가 정상적으로 접수되었습니다.',
    body: '내용을 확인한 뒤 답변드리겠습니다.',
    closing: '영업일 기준 1~2일 내 답변드립니다.',
  }),
  etc: (name) => template({
    name,
    greeting: '문의가 정상적으로 접수되었습니다.',
    body: '내용을 확인한 뒤 답변드리겠습니다.',
    closing: '영업일 기준 1~2일 내 답변드립니다.',
  }),
}

function buildAutoReply(ticket) {
  const fn = REPLIES[ticket.type] || REPLIES.general
  return fn(ticket.name)
}

module.exports = { buildAutoReply }
