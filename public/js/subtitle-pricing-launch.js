/**
 * 타닥싱크 요금 정책 공개 시각 — db/schema.js SUBTITLE_PRICING_LAUNCH_ISO 와 동기화
 */
(function (global) {
  const LAUNCH_AT = '2026-08-01T00:00:00+09:00'
  const LAUNCH_LABEL = '2026년 8월 1일'
  const LAUNCH_LABEL_SHORT = '8/1'

  function isLaunched(now) {
    return (now || new Date()).getTime() >= new Date(LAUNCH_AT).getTime()
  }

  function syncHtmlClass() {
    const launched = isLaunched()
    const root = document.documentElement
    root.classList.toggle('st-pricing-launched', launched)
    root.classList.toggle('st-pricing-prelaunch', !launched)
    if (document.body) {
      document.body.dataset.stPricingLaunched = launched ? '1' : '0'
    }
    return launched
  }

  function applyGates(root) {
    syncHtmlClass()
    const scope = root || document
    scope.querySelectorAll('[data-pricing-launch-label]').forEach((el) => {
      el.textContent = LAUNCH_LABEL
    })
    scope.querySelectorAll('[data-pricing-launch-label-short]').forEach((el) => {
      el.textContent = LAUNCH_LABEL_SHORT
    })
    return isLaunched()
  }

  global.SubtitlePricingLaunch = {
    LAUNCH_AT,
    LAUNCH_LABEL,
    LAUNCH_LABEL_SHORT,
    isLaunched,
    applyGates,
    syncHtmlClass,
  }

  syncHtmlClass()
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => applyGates())
  } else {
    applyGates()
  }
})(typeof window !== 'undefined' ? window : globalThis)
