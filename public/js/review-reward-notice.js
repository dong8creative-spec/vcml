/**
 * 기대평·수강 후기 혜택 안내 및 동의 UI
 * @see /policy/terms 제8조의2, /faq
 */
(function (global) {
  const TERMS_LINK = '/policy/terms#review-rewards'
  const FAQ_LINK = '/faq'

  const REVIEW_INFO_LINES = [
    '별점 <strong>5점</strong> 후기를 해당 강의에 <strong>최초</strong> 작성하면 10% 할인 쿠폰이 발급됩니다. (강의당 1회, 유효기간 1개월)',
    '1~4점으로 작성한 후 5점으로 수정하는 경우 <strong>추가 쿠폰은 발급되지 않습니다.</strong>',
    '타닥싱크 등 별도 안내가 있는 프로그램은 수강 후기 작성 시 강의별 50코인 혜택이 추가될 수 있습니다.',
    '네이버 스마트스토어 후기는 앱에서 작성 완료 신고 후 관리자 확인을 거쳐 150코인이 지급될 수 있습니다.',
    '후기는 실제 수강 경험에 기반해 작성해야 하며, 허위·과장 후기는 금지됩니다.',
  ]

  const REVIEW_FIVE_STAR_CONSENT =
    '별점 5점 후기로 쿠폰·코인 등 혜택을 받은 경우, 해당 강의 후기의 별점·내용 <strong>수정 및 삭제가 제한</strong>됩니다. ' +
    '위 혜택 조건과 제한 사항을 확인하였으며 이에 동의합니다. (<a href="' + TERMS_LINK + '" target="_blank" rel="noopener">이용약관</a>)'

  const ANTICIPATION_INFO_LINES = [
    '기대평 <strong>최초</strong> 작성 시 10% 할인 쿠폰이 발급됩니다. (유효기간 1개월)',
    '기대평 수정·삭제 시 <strong>추가 쿠폰은 발급되지 않습니다.</strong>',
    '기대평은 실제 기대·관심에 기반해 작성해야 하며, 허위·과장 내용은 금지됩니다.',
  ]

  const ANTICIPATION_CONSENT =
    '기대평 작성 혜택 조건을 확인하였으며 이에 동의합니다. (<a href="' + TERMS_LINK + '" target="_blank" rel="noopener">이용약관</a>)'

  function linesHtml(lines) {
    return '<ul class="reward-notice-list">' + lines.map(l => '<li>' + l + '</li>').join('') + '</ul>'
  }

  function reviewFormBlock(idSuffix, opts = {}) {
    const isEdit = !!opts.isEdit
    const editNote = isEdit
      ? '<p class="reward-notice-edit">이미 작성한 후기를 수정하는 경우, 별점 5점으로 올릴 때에도 <strong>추가 쿠폰은 발급되지 않습니다.</strong></p>'
      : ''
    return (
      '<div class="reward-notice" id="reward-notice-' + idSuffix + '">' +
        '<p class="reward-notice-title"><i class="ti ti-info-circle"></i> 후기 작성·혜택 안내</p>' +
        linesHtml(REVIEW_INFO_LINES) +
        editNote +
        '<p class="reward-notice-more">자세한 내용은 <a href="' + FAQ_LINK + '" target="_blank" rel="noopener">FAQ</a> 및 ' +
        '<a href="' + TERMS_LINK + '" target="_blank" rel="noopener">이용약관</a>을 확인해 주세요.</p>' +
      '</div>' +
      '<label class="reward-consent" id="reward-consent-wrap-' + idSuffix + '" hidden>' +
        '<input type="checkbox" id="reward-consent-' + idSuffix + '">' +
        '<span>' + REVIEW_FIVE_STAR_CONSENT + '</span>' +
      '</label>'
    )
  }

  function anticipationFormBlock() {
    return (
      '<div class="reward-notice reward-notice--compact" id="anticipation-reward-notice">' +
        '<p class="reward-notice-title"><i class="ti ti-info-circle"></i> 기대평·혜택 안내</p>' +
        linesHtml(ANTICIPATION_INFO_LINES) +
      '</div>' +
      '<label class="reward-consent" id="anticipation-consent-wrap">' +
        '<input type="checkbox" id="anticipation-consent">' +
        '<span>' + ANTICIPATION_CONSENT + '</span>' +
      '</label>'
    )
  }

  function updateReviewConsentVisibility(idSuffix, rating) {
    const wrap = document.getElementById('reward-consent-wrap-' + idSuffix)
    if (!wrap) return
    const show = Number(rating) === 5
    wrap.hidden = !show
    if (!show) {
      const cb = document.getElementById('reward-consent-' + idSuffix)
      if (cb) cb.checked = false
    }
  }

  function validateReviewConsent(idSuffix, rating) {
    if (Number(rating) !== 5) return true
    const cb = document.getElementById('reward-consent-' + idSuffix)
    return !!(cb && cb.checked)
  }

  function validateAnticipationConsent(isEdit) {
    if (isEdit) return true
    const cb = document.getElementById('anticipation-consent')
    return !!(cb && cb.checked)
  }

  function reviewConsentPayload(rating) {
    if (Number(rating) !== 5) return {}
    return { consent_review_reward_terms: true }
  }

  function anticipationConsentPayload(isEdit) {
    if (isEdit) return {}
    return { consent_anticipation_coupon_terms: true }
  }

  global.ReviewRewardNotice = {
    reviewFormBlock,
    anticipationFormBlock,
    updateReviewConsentVisibility,
    validateReviewConsent,
    validateAnticipationConsent,
    reviewConsentPayload,
    anticipationConsentPayload,
  }
})(typeof window !== 'undefined' ? window : globalThis)
