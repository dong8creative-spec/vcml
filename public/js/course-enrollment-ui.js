/** 강의 모집 인원 — 게이지·모집마감 UI 공통 */
;(function (global) {
  function meta(c) {
    const limit = Math.max(0, parseInt(c?.enrollment_limit, 10) || 0)
    const count = Math.max(0, parseInt(c?.enrollment_count ?? c?.student_count, 10) || 0)
    if (limit <= 0) {
      return { limit: 0, count, ratio: 0, full: !!c?.enrollment_full, hasLimit: false }
    }
    const ratio = Math.min(1, count / limit)
    return {
      limit,
      count,
      ratio,
      full: c?.enrollment_full != null ? !!c.enrollment_full : count >= limit,
      hasLimit: true,
    }
  }

  function gaugeColor(ratio) {
    const pct = Math.round(Math.min(1, Math.max(0, ratio)) * 100)
    if (pct <= 5) return '#2f6fed'
    if (pct <= 40) return '#22a055'
    if (pct <= 70) return '#d4a017'
    return '#e53935'
  }

  function gaugeFillStyle(ratio) {
    return `width:${Math.round(ratio * 100)}%;background:${gaugeColor(ratio)}`
  }

  function gaugeCapacityStyle(ratio) {
    return `color:${gaugeColor(ratio)}`
  }

  function catRowHtml(c, catClass) {
    const m = meta(c)
    const countHtml = m.hasLimit
      ? `<span class="enroll-capacity" style="${gaugeCapacityStyle(m.ratio)}" aria-label="신청 ${m.count}명, 모집 정원 ${m.limit}명">${m.count}<span class="enroll-capacity-sep">/</span>${m.limit}</span>`
      : ''
    const gauge = m.hasLimit
      ? `<span class="enroll-gauge" role="meter" aria-valuenow="${m.count}" aria-valuemin="0" aria-valuemax="${m.limit}" aria-label="모집 ${m.count}/${m.limit}">
          <span class="enroll-gauge-fill" style="${gaugeFillStyle(m.ratio)}"></span>
        </span>`
      : ''
    return `<div class="enroll-cat-row"><span class="${catClass}">${c.category || ''}</span>${countHtml}${gauge}</div>`
  }

  function isLiveEnded(c) {
    if (!c || c.course_type !== 'live') return false
    return c.live_status === 'ended'
      || c.live_ended === true
      || c.live_resources?.live_ended === true
  }

  function isCapacityClosed(c) {
    const m = meta(c)
    return m.full && m.hasLimit && !isLiveEnded(c)
  }

  function isCheckoutBlocked(c) {
    if (!c || c.course_type === 'live') return false
    if (Number(c.sale_price) === 0) return false
    return !!(c.checkout_closed || c.checkout_upcoming)
  }

  function closedPanelLabel(c) {
    if (c?.checkout_upcoming) return c.checkout_panel_label || '결제 전'
    if (c?.checkout_closed) return c.checkout_panel_label || '결제마감'
    if (isCapacityClosed(c)) return '모집마감'
    return ''
  }

  function enrollBtnLabel(c, liveStatusMap) {
    const isLive = c.course_type === 'live'
    if (isLive && isLiveEnded(c)) return '종료된 강의'
    const isFree = isLive || Number(c.sale_price) === 0
    if (isLive) {
      const status = liveStatusMap[c.live_status || 'upcoming'] || '신청 가능'
      return isFree ? `무료 · ${status}` : status
    }
    if (isFree) return '무료 · 강의 보기'
    return `₩${Number(c.sale_price).toLocaleString()} · 강의 보기`
  }

  function isClosedForCard(c) {
    return isCapacityClosed(c) || isCheckoutBlocked(c)
  }

  function isClosedForApply(c) {
    const replaySignup = c?.course_type === 'live'
      && isLiveEnded(c)
      && c?.live_resources?.replay_configured
      && !c?.enrolled
    if (replaySignup) return false
    return !c?.enrolled && (isLiveEnded(c) || isCapacityClosed(c) || isCheckoutBlocked(c))
  }

  /** 강의 상세 buy-card — 풀폭 신청 버튼 */
  function cardEnrollBtnHtml(c, liveStatusMap) {
    const isLive = c.course_type === 'live'
    const label = enrollBtnLabel(c, liveStatusMap)
    const ended = isLive && isLiveEnded(c)
    const baseClass = `card-enroll-btn${ended ? ' card-enroll-btn--muted' : ''}`
    return `<div class="${baseClass}"><span class="card-enroll-btn-label">${label}</span></div>`
  }

  /** 홈 카드 — 강의 상세 buy-card와 동일한 전체 패널 오버레이 */
  function catalogCardPanelClass(c) {
    return isClosedForCard(c) ? ' enrollment-closed-panel enrollment-closed-panel--catalog' : ''
  }

  function catalogCardPanelOpen(c) {
    return isClosedForCard(c) ? '<div class="enrollment-closed-panel__content">' : ''
  }

  function catalogCardPanelClose(c) {
    const label = closedPanelLabel(c)
    return label ? `</div><span class="enrollment-closed-panel__label">${label}</span>` : ''
  }

  /** 강의 상세 — buy-card 안 버튼 (패널 오버레이는 buy-card에 적용) */
  function wrapBlockButton(labelHtml, c, onclickAttr) {
    if (!isClosedForApply(c)) {
      return `<button type="button" class="btn-enroll" ${onclickAttr}>${labelHtml}</button>`
    }
    return `<div class="btn-enroll btn-enroll--underlay">${labelHtml}</div>`
  }

  function buyCardPanelClass(c) {
    return isClosedForCard(c) ? ' enrollment-closed-panel' : ''
  }

  function buyCardPanelOpen(c) {
    return isClosedForCard(c) ? '<div class="enrollment-closed-panel__content">' : ''
  }

  function buyCardPanelClose(c) {
    const label = closedPanelLabel(c)
    return label ? `</div><span class="enrollment-closed-panel__label">${label}</span>` : ''
  }

  global.CourseEnrollmentUI = {
    meta,
    gaugeColor,
    gaugeFillStyle,
    gaugeCapacityStyle,
    catRowHtml,
    isLiveEnded,
    cardEnrollBtnHtml,
    wrapBlockButton,
    isClosedForApply,
    isClosedForCard,
    catalogCardPanelClass,
    catalogCardPanelOpen,
    catalogCardPanelClose,
    buyCardPanelClass,
    buyCardPanelOpen,
    buyCardPanelClose,
  }
})(window)
