/** Admin 강사 포트폴리오(채널·쇼츠·인스타·샤오홍슈) 편집 모듈 */
;(function (global) {
  const esc = (...args) => (global.esc || global.AdminUtils?.esc || ((s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')))(...args)

  let _worksLoaded = false
  let _works = null

  function emptyAccount() {
    return {
      id: '',
      name: '',
      handle: '',
      accountUrl: '',
      role: '',
      startDate: '',
      endDate: '',
      ongoing: false,
      metrics: [{ label: '', before: '', after: '', growth: '' }],
      summary: '',
      highlights: [],
    }
  }

  function emptyMedia() {
    return { id: '', title: '', description: '', url: '' }
  }

  function metricRowsHtml(metrics) {
    const list = metrics?.length ? metrics : [{ label: '', before: '', after: '', growth: '' }]
    return list.map((m) => `
      <div class="pf-metric-row">
        <input type="text" data-m-label placeholder="지표명" value="${esc(m.label || '')}" />
        <input type="text" data-m-before placeholder="이전" value="${esc(m.before || '')}" />
        <input type="text" data-m-after placeholder="이후" value="${esc(m.after || '')}" />
        <input type="text" data-m-growth placeholder="성장" value="${esc(m.growth || '')}" />
        <button type="button" class="btn-sm-danger" data-remove-metric>삭제</button>
      </div>
    `).join('')
  }

  function accountCardHtml(account = emptyAccount(), kind = 'channel') {
    return `<div class="pf-account-card" data-pf-account>
      <div class="pf-account-head">
        <input type="text" data-a-name placeholder="이름" value="${esc(account.name || '')}" />
        <input type="text" data-a-handle placeholder="@핸들" value="${esc(account.handle || '')}" />
        <label class="pf-ongoing"><input type="checkbox" data-a-ongoing ${account.ongoing ? 'checked' : ''} /> 진행 중</label>
        <button type="button" class="btn-sm-danger" data-remove-account>삭제</button>
      </div>
      <div class="pf-account-grid">
        <input type="text" data-a-url placeholder="계정/채널 URL" value="${esc(account.accountUrl || '')}" />
        <input type="text" data-a-role placeholder="담당 업무" value="${esc(account.role || '')}" />
        <input type="month" data-a-start value="${esc((account.startDate || '').slice(0, 7))}" title="시작" />
        <input type="month" data-a-end value="${esc((account.endDate || '').slice(0, 7))}" title="종료" ${account.ongoing ? 'disabled' : ''} />
      </div>
      <textarea data-a-summary rows="2" placeholder="성과 요약" style="width:100%;font-family:inherit;font-size:13px;padding:8px 10px;border:1px solid var(--adm-border,#ddd);border-radius:7px;resize:vertical">${esc(account.summary || '')}</textarea>
      <input type="text" data-a-highlights placeholder="하이라이트 (쉼표로 구분)" value="${esc((account.highlights || []).join(', '))}" />
      <div class="pf-metrics" data-a-metrics>${metricRowsHtml(account.metrics)}</div>
      <button type="button" class="btn-sm" data-add-metric style="margin-top:6px">+ 지표 추가</button>
      <input type="hidden" data-a-id value="${esc(account.id || '')}" />
      <input type="hidden" data-a-kind value="${esc(kind)}" />
    </div>`
  }

  function mediaRowHtml(item = emptyMedia()) {
    return `<div class="pf-media-row" data-pf-media>
      <input type="text" data-m-title placeholder="제목" value="${esc(item.title || '')}" />
      <input type="text" data-m-desc placeholder="설명" value="${esc(item.description || '')}" />
      <input type="text" data-m-url placeholder="URL" value="${esc(item.url || '')}" />
      <button type="button" class="btn-sm-danger" data-remove-media>삭제</button>
      <input type="hidden" data-m-id value="${esc(item.id || '')}" />
    </div>`
  }

  function readAccounts(container) {
    if (!container) return []
    return [...container.querySelectorAll('[data-pf-account]')].map((card) => {
      const metrics = [...card.querySelectorAll('.pf-metric-row')].map((row) => ({
        label: row.querySelector('[data-m-label]')?.value.trim() || '',
        before: row.querySelector('[data-m-before]')?.value.trim() || '',
        after: row.querySelector('[data-m-after]')?.value.trim() || '',
        growth: row.querySelector('[data-m-growth]')?.value.trim() || '',
      })).filter((m) => m.label || m.before || m.after)
      const highlightsRaw = card.querySelector('[data-a-highlights]')?.value || ''
      return {
        id: card.querySelector('[data-a-id]')?.value || '',
        name: card.querySelector('[data-a-name]')?.value.trim() || '',
        handle: card.querySelector('[data-a-handle]')?.value.trim() || '',
        accountUrl: card.querySelector('[data-a-url]')?.value.trim() || '',
        role: card.querySelector('[data-a-role]')?.value.trim() || '',
        startDate: card.querySelector('[data-a-start]')?.value || '',
        endDate: card.querySelector('[data-a-ongoing]')?.checked
          ? ''
          : (card.querySelector('[data-a-end]')?.value || ''),
        ongoing: !!card.querySelector('[data-a-ongoing]')?.checked,
        summary: card.querySelector('[data-a-summary]')?.value.trim() || '',
        highlights: highlightsRaw.split(/[,·]/).map((s) => s.trim()).filter(Boolean),
        metrics,
      }
    }).filter((a) => a.name || a.handle)
  }

  function readMedia(container) {
    if (!container) return []
    return [...container.querySelectorAll('[data-pf-media]')].map((row) => ({
      id: row.querySelector('[data-m-id]')?.value || '',
      title: row.querySelector('[data-m-title]')?.value.trim() || '',
      description: row.querySelector('[data-m-desc]')?.value.trim() || '',
      url: row.querySelector('[data-m-url]')?.value.trim() || '',
    })).filter((m) => m.title || m.url)
  }

  function fillWorksEditor(cfg) {
    _works = cfg
    document.getElementById('pf-yt-intro').value = cfg.youtube?.intro || ''
    document.getElementById('pf-ig-intro').value = cfg.instagram?.intro || ''

    const ytChannels = document.getElementById('pf-yt-channels')
    const ytShorts = document.getElementById('pf-yt-shorts')
    const igAccounts = document.getElementById('pf-ig-accounts')
    const rnItems = document.getElementById('pf-rn-items')

    const channels = cfg.youtube?.channels?.length ? cfg.youtube.channels : [emptyAccount()]
    ytChannels.innerHTML = channels.map((c) => accountCardHtml(c, 'channel')).join('')

    const shorts = cfg.youtube?.shorts?.length ? cfg.youtube.shorts : [emptyMedia()]
    ytShorts.innerHTML = shorts.map(mediaRowHtml).join('')

    const accounts = cfg.instagram?.accounts?.length ? cfg.instagram.accounts : [emptyAccount()]
    igAccounts.innerHTML = accounts.map((a) => accountCardHtml(a, 'account')).join('')

    const rednote = cfg.rednote?.length ? cfg.rednote : [emptyMedia()]
    rnItems.innerHTML = rednote.map(mediaRowHtml).join('')
  }

  function readWorksForm() {
    return {
      youtube: {
        intro: document.getElementById('pf-yt-intro')?.value.trim() || '',
        channels: readAccounts(document.getElementById('pf-yt-channels')),
        shorts: readMedia(document.getElementById('pf-yt-shorts')),
      },
      instagram: {
        intro: document.getElementById('pf-ig-intro')?.value.trim() || '',
        accounts: readAccounts(document.getElementById('pf-ig-accounts')),
      },
      rednote: readMedia(document.getElementById('pf-rn-items')),
    }
  }

  async function loadPortfolioWorksSettings(force = false) {
    if (_worksLoaded && !force) return
    try {
      const cfg = await API.get('/admin/instructor-portfolio-works')
      fillWorksEditor(cfg)
      _worksLoaded = true
    } catch (e) {
      console.error(e)
    }
  }

  function switchInstructorTab(tab) {
    document.querySelectorAll('[data-instructor-tab]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.instructorTab === tab)
    })
    document.querySelectorAll('[data-instructor-panel]').forEach((panel) => {
      panel.classList.toggle('active', panel.dataset.instructorPanel === tab)
    })
    if (tab === 'portfolio') loadPortfolioWorksSettings()
  }

  function switchPfSubtab(name) {
    document.querySelectorAll('.pf-subtab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.pfSubtab === name)
    })
    document.querySelectorAll('[data-pf-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.pfPanel !== name
    })
  }

  function bindAccountContainer(container, addBtnId, kind) {
    document.getElementById(addBtnId)?.addEventListener('click', () => {
      container.insertAdjacentHTML('beforeend', accountCardHtml(emptyAccount(), kind))
    })
    container?.addEventListener('click', (e) => {
      if (e.target.closest('[data-remove-account]')) {
        const cards = container.querySelectorAll('[data-pf-account]')
        if (cards.length <= 1) {
          alert('최소 1개 항목이 필요합니다.')
          return
        }
        e.target.closest('[data-pf-account]')?.remove()
        return
      }
      if (e.target.closest('[data-add-metric]')) {
        const metrics = e.target.closest('[data-pf-account]')?.querySelector('[data-a-metrics]')
        metrics?.insertAdjacentHTML('beforeend', metricRowsHtml([{ label: '', before: '', after: '', growth: '' }]))
        return
      }
      if (e.target.closest('[data-remove-metric]')) {
        const wrap = e.target.closest('[data-a-metrics]')
        const rows = wrap?.querySelectorAll('.pf-metric-row') || []
        if (rows.length <= 1) {
          alert('최소 1개 지표 행이 필요합니다.')
          return
        }
        e.target.closest('.pf-metric-row')?.remove()
      }
    })
    container?.addEventListener('change', (e) => {
      const ongoing = e.target.closest('[data-a-ongoing]')
      if (!ongoing) return
      const end = ongoing.closest('[data-pf-account]')?.querySelector('[data-a-end]')
      if (end) end.disabled = ongoing.checked
    })
  }

  function bindMediaContainer(container, addBtnId) {
    document.getElementById(addBtnId)?.addEventListener('click', () => {
      container.insertAdjacentHTML('beforeend', mediaRowHtml())
    })
    container?.addEventListener('click', (e) => {
      if (!e.target.closest('[data-remove-media]')) return
      const rows = container.querySelectorAll('[data-pf-media]')
      if (rows.length <= 1) {
        alert('최소 1개 항목이 필요합니다.')
        return
      }
      e.target.closest('[data-pf-media]')?.remove()
    })
  }

  function bind() {
    document.querySelectorAll('[data-instructor-tab]').forEach((btn) => {
      btn.addEventListener('click', () => switchInstructorTab(btn.dataset.instructorTab))
    })
    document.querySelectorAll('.pf-subtab').forEach((btn) => {
      btn.addEventListener('click', () => switchPfSubtab(btn.dataset.pfSubtab))
    })

    bindAccountContainer(document.getElementById('pf-yt-channels'), 'pf-yt-channel-add', 'channel')
    bindAccountContainer(document.getElementById('pf-ig-accounts'), 'pf-ig-account-add', 'account')
    bindMediaContainer(document.getElementById('pf-yt-shorts'), 'pf-yt-short-add')
    bindMediaContainer(document.getElementById('pf-rn-items'), 'pf-rn-item-add')

    document.getElementById('portfolio-works-save')?.addEventListener('click', async () => {
      const statusEl = document.getElementById('portfolio-works-status')
      const btn = document.getElementById('portfolio-works-save')
      try {
        btn.disabled = true
        const payload = readWorksForm()
        const result = await API.patch('/admin/instructor-portfolio-works', payload)
        fillWorksEditor(result)
        _worksLoaded = true
        if (statusEl) {
          statusEl.textContent = '저장되었습니다.' + (result.updated_at ? ' (' + result.updated_at.slice(0, 16).replace('T', ' ') + ')' : '')
        }
      } catch (e) {
        alert(e.message || '저장 실패')
      } finally {
        btn.disabled = false
      }
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind)
  } else {
    bind()
  }

  global.AdminInstructorPortfolio = {
    load: loadPortfolioWorksSettings,
    switchTab: switchInstructorTab,
  }
})(typeof window !== 'undefined' ? window : global)
