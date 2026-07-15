/** 강사 포트폴리오 — 선택형 견적서 전용 페이지 */
;(function () {
  'use strict'

  const QUOTE_FALLBACK = {
    section_title: '선택형 견적서',
    section_desc: '기획 · 촬영 · 편집 중 필요한 범위를 선택하면 예상 금액이 달라집니다.',
    scope_note: '견적은 선택하신 기획·촬영·편집 범위와 항목에 따라 달라집니다. 필요한 분류와 옵션만 골라 확인하세요.',
    summary_note: '부가세·출장비·수정 횟수에 따라 달라질 수 있습니다',
    disclaimer: '이 견적서는 참고용 초안입니다. 실제 금액은 작업 범위·분량·일정에 따라 달라지며, 문의·결제 기능은 포함되어 있지 않습니다.',
    groups: [],
  }

  let quoteConfig = { ...QUOTE_FALLBACK, groups: [] }

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function formatWon(n) {
    return '₩' + Number(n || 0).toLocaleString('ko-KR')
  }

  function notify(msg, type) {
    if (typeof toast === 'function') toast(msg, type || 'success')
    else alert(msg)
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text)
        return true
      } catch (_) {}
    }
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    let ok = false
    try { ok = document.execCommand('copy') } catch (_) {}
    document.body.removeChild(ta)
    return ok
  }

  function applyQuoteMeta(config) {
    const titleEl = document.getElementById('quote-title')
    const descEl = document.getElementById('quote-section-desc')
    const scopeEl = document.getElementById('quote-scope-note')
    const summaryEl = document.getElementById('quote-summary-note')
    const disclaimerEl = document.getElementById('quote-disclaimer')
    const heroTitle = document.querySelector('.portfolio-hero-title')
    const heroLead = document.querySelector('.portfolio-hero-lead')

    if (titleEl && config.section_title) titleEl.textContent = config.section_title
    if (descEl && config.section_desc) descEl.textContent = config.section_desc
    if (scopeEl) scopeEl.textContent = config.scope_note || ''
    if (summaryEl && config.summary_note) summaryEl.textContent = config.summary_note
    if (disclaimerEl && config.disclaimer) disclaimerEl.textContent = config.disclaimer
    if (heroTitle && config.section_title) heroTitle.textContent = config.section_title
    if (heroLead && config.section_desc) heroLead.textContent = config.section_desc
    if (config.section_title) document.title = `${config.section_title} — 타닥클래스`
    renderScopeTags(config.groups || [])
  }

  function renderScopeTags(groups) {
    const tagsEl = document.getElementById('quote-scope-tags')
    if (!tagsEl) return
    if (!groups.length) {
      tagsEl.hidden = true
      tagsEl.innerHTML = ''
      return
    }
    tagsEl.hidden = false
    tagsEl.innerHTML = groups.map((group) => `
      <span class="quote-scope-tag" data-scope-group="${esc(group.id)}">${esc(group.title)}</span>
    `).join('')
  }

  function updateScopeTags(selected) {
    const activeGroups = new Set(selected.map((item) => item.groupId))
    document.querySelectorAll('.quote-scope-tag').forEach((tag) => {
      tag.classList.toggle('is-active', activeGroups.has(tag.dataset.scopeGroup))
    })
  }

  async function loadQuoteConfig() {
    try {
      const api = window.API || (typeof API !== 'undefined' ? API : null)
      if (api?.get) {
        const data = await api.get('/instructor-portfolio/quote')
        if (data?.groups?.length) {
          quoteConfig = data
          return quoteConfig
        }
      }
    } catch (_) {}
    quoteConfig = { ...QUOTE_FALLBACK }
    return quoteConfig
  }

  function renderQuoteGroups(container, groups) {
    const visibleGroups = (groups || []).filter((group) => group.items?.length)
    if (!visibleGroups.length) {
      container.innerHTML = '<p class="portfolio-empty">등록된 견적 항목이 없습니다.</p>'
      return
    }
    container.innerHTML = visibleGroups.map((group) => `
      <div class="quote-group" data-group="${esc(group.id)}">
        <h3 class="quote-group__title">${esc(group.title)}</h3>
        ${group.description ? `<p class="quote-group__desc">${esc(group.description)}</p>` : ''}
        <div class="quote-options">
          ${group.items.map((item) => `
            <label class="quote-option" data-option-id="${esc(item.id)}">
              <input type="checkbox" value="${esc(item.id)}" data-price="${item.price}" data-label="${esc(item.label)}" data-group="${esc(group.title)}" data-group-id="${esc(group.id)}" />
              <div class="quote-option__body">
                <div class="quote-option__top">
                  <span class="quote-option__label">${esc(item.label)}</span>
                  <span class="quote-option__price">${formatWon(item.price)}</span>
                </div>
                <p class="quote-option__desc">${esc(item.desc)}</p>
              </div>
            </label>
          `).join('')}
        </div>
      </div>
    `).join('')
  }

  function getSelectedOptions() {
    return [...document.querySelectorAll('#quote-groups input[type="checkbox"]:checked')].map((el) => ({
      id: el.value,
      label: el.dataset.label,
      group: el.dataset.group,
      groupId: el.dataset.groupId,
      price: Number(el.dataset.price || 0),
    }))
  }

  function updateQuoteSummary() {
    const selected = getSelectedOptions()
    const total = selected.reduce((sum, item) => sum + item.price, 0)
    const countEl = document.getElementById('quote-count')
    const totalEl = document.getElementById('quote-total')
    const listEl = document.getElementById('quote-selected-list')
    const emptyEl = document.getElementById('quote-empty')

    if (countEl) countEl.textContent = `선택 ${selected.length}개`
    if (totalEl) totalEl.textContent = formatWon(total)
    updateScopeTags(selected)

    document.querySelectorAll('.quote-option').forEach((label) => {
      const input = label.querySelector('input')
      label.classList.toggle('is-checked', !!(input && input.checked))
    })

    if (!selected.length) {
      if (listEl) {
        listEl.hidden = true
        listEl.innerHTML = ''
      }
      if (emptyEl) emptyEl.hidden = false
      return
    }

    if (emptyEl) emptyEl.hidden = true
    if (listEl) {
      listEl.hidden = false
      listEl.innerHTML = selected.map((item) => `
        <li><span>${esc(item.group)} · ${esc(item.label)}</span><span>${formatWon(item.price)}</span></li>
      `).join('')
    }
  }

  function buildQuoteText() {
    const selected = getSelectedOptions()
    const total = selected.reduce((sum, item) => sum + item.price, 0)
    const lines = [
      '[타닥클래스 선택형 견적서]',
      `작성일: ${new Date().toLocaleDateString('ko-KR')}`,
      '',
    ]
    if (quoteConfig.scope_note) {
      lines.push(quoteConfig.scope_note, '')
    }
    if (!selected.length) {
      lines.push('선택된 항목이 없습니다.')
    } else {
      const byGroup = {}
      selected.forEach((item) => {
        if (!byGroup[item.group]) byGroup[item.group] = []
        byGroup[item.group].push(item)
      })
      Object.keys(byGroup).forEach((group) => {
        lines.push(`■ ${group}`)
        byGroup[group].forEach((item) => {
          lines.push(`- ${item.label}: ${formatWon(item.price)}`)
        })
        lines.push('')
      })
      lines.push(`합계: ${formatWon(total)}`)
      lines.push('(참고용 초안 단가 · 실제 금액은 협의 후 확정)')
    }
    lines.push('', `페이지: ${location.href}`)
    return lines.join('\n')
  }

  async function copyQuote() {
    const text = buildQuoteText()
    const ok = await copyText(text)
    notify(ok ? '견적 내용을 복사했습니다.' : '복사에 실패했습니다.', ok ? 'success' : 'error')
  }

  function resetQuote() {
    document.querySelectorAll('#quote-groups input[type="checkbox"]').forEach((el) => {
      el.checked = false
    })
    updateQuoteSummary()
    notify('선택을 초기화했습니다.', 'info')
  }

  async function init() {
    const quoteGroups = document.getElementById('quote-groups')
    const quoteData = await loadQuoteConfig()
    applyQuoteMeta(quoteData)
    if (quoteGroups) renderQuoteGroups(quoteGroups, quoteData.groups || [])

    quoteGroups?.addEventListener('change', (e) => {
      if (e.target.matches('input[type="checkbox"]')) updateQuoteSummary()
    })

    document.getElementById('quote-copy-btn')?.addEventListener('click', copyQuote)
    document.getElementById('quote-reset-btn')?.addEventListener('click', resetQuote)

    updateQuoteSummary()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
