/** Admin 강사 포트폴리오(채널·쇼츠·인스타·샤오홍슈) 편집 모듈 */
;(function (global) {
  const esc = (...args) => (global.esc || global.AdminUtils?.esc || ((s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')))(...args)

  let _worksLoaded = false
  let _works = null

  function emptyPlaylist() {
    return { id: '', url: '', label: '' }
  }

  function formatViewCount(n) {
    const num = Number(n || 0)
    if (!Number.isFinite(num) || num <= 0) return '0'
    if (num >= 100000000) return `${(num / 100000000).toFixed(1).replace(/\.0$/, '')}억`
    if (num >= 10000) return `${(num / 10000).toFixed(1).replace(/\.0$/, '')}만`
    return num.toLocaleString('ko-KR')
  }

  function viewStatsHtml(account = {}) {
    const stats = account.viewStats || {}
    if (!stats.videoCount && !stats.totalViews) {
      return '<p class="pf-view-stats pf-view-stats--empty">재생목록 URL을 추가하고 저장하면 조회수가 자동 계산됩니다.</p>'
    }
    return `<div class="pf-view-stats">
      <span><strong>평균 조회</strong> ${formatViewCount(stats.averageViews)}회</span>
      <span><strong>영상 수</strong> ${stats.videoCount || 0}개</span>
      <span><strong>총 조회</strong> ${formatViewCount(stats.totalViews)}회</span>
      ${stats.updatedAt ? `<span class="pf-view-stats__updated">갱신 ${esc(String(stats.updatedAt).slice(0, 16).replace('T', ' '))}</span>` : ''}
    </div>`
  }

  function playlistRowsHtml(playlists = []) {
    return (playlists || []).map((pl) => `
      <div class="pf-playlist-item" data-pf-playlist>
        <input type="url" data-pl-url placeholder="재생목록 URL" value="${esc(pl.url || '')}" />
        <input type="text" data-pl-label placeholder="버튼 문구 (선택)" value="${esc(pl.label || '')}" />
        <span class="pf-playlist-stat">${pl.videoCount ? `영상 ${pl.videoCount}개 · 평균 ${formatViewCount(pl.averageViews)}회` : '저장 후 자동 계산'}</span>
        <button type="button" class="btn-sm-danger" data-remove-playlist>삭제</button>
        <input type="hidden" data-pl-id value="${esc(pl.id || '')}" />
      </div>
    `).join('')
  }

  function emptyAccount() {
    return {
      id: '',
      name: '',
      handle: '',
      accountUrl: '',
      avatarUrl: '',
      bannerUrl: '',
      playlists: [],
      role: '',
      startDate: '',
      endDate: '',
      ongoing: false,
      metrics: [],
      summary: '',
      highlights: [],
      viewStats: {},
    }
  }

  function emptyMedia() {
    return { id: '', title: '', description: '', url: '', thumbnailUrl: '' }
  }

  function metricRowsHtml(metrics) {
    return (metrics || []).map((m) => `
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
    const isChannel = kind === 'channel'
    return `<div class="pf-account-card${isChannel ? ' pf-account-card--channel' : ''}" data-pf-account>
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
      <div class="pf-avatar-row">
        <img class="pf-avatar-preview" data-a-avatar-preview src="${esc(account.avatarUrl || '')}" alt="" ${account.avatarUrl ? '' : 'hidden'} />
        <input type="url" data-a-avatar placeholder="프로필 사진 URL (비우면 자동)" value="${esc(account.avatarUrl || '')}" />
      </div>
      ${isChannel ? `<input type="url" data-a-banner placeholder="채널 배너 URL (비우면 자동)" value="${esc(account.bannerUrl || '')}" />
      <div class="pf-playlists" data-a-playlists>
        <div class="pf-playlists__head">
          <strong>편집 작업 재생목록</strong>
          <button type="button" class="btn-sm" data-add-playlist>+ 재생목록</button>
        </div>
        ${playlistRowsHtml(account.playlists || [])}
      </div>
      ${viewStatsHtml(account)}` : ''}
      <textarea data-a-summary rows="2" placeholder="성과 요약" style="width:100%;font-family:inherit;font-size:13px;padding:8px 10px;border:1px solid var(--adm-border,#ddd);border-radius:7px;resize:vertical">${esc(account.summary || '')}</textarea>
      <textarea data-a-highlights rows="2" placeholder="하이라이트 (줄바꿈으로 항목 구분)" style="width:100%;font-family:inherit;font-size:13px;padding:8px 10px;border:1px solid var(--adm-border,#ddd);border-radius:7px;resize:vertical">${esc((account.highlights || []).join('\n'))}</textarea>
      ${isChannel ? '' : `<div class="pf-metrics" data-a-metrics>${metricRowsHtml(account.metrics)}</div>
      <button type="button" class="btn-sm" data-add-metric style="margin-top:6px">+ 지표 추가</button>`}
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

  function rednoteMediaRowHtml(item = emptyMedia()) {
    const thumb = String(item.thumbnailUrl || item.thumbnail_url || '').trim()
    return `<div class="pf-media-row pf-media-row--rednote" data-pf-media>
      <div class="pf-media-row__fields">
        <input type="text" data-m-title placeholder="제목" value="${esc(item.title || '')}" />
        <input type="text" data-m-desc placeholder="설명" value="${esc(item.description || '')}" />
        <input type="text" data-m-url placeholder="게시물 URL" value="${esc(item.url || '')}" />
        <button type="button" class="btn-sm-danger" data-remove-media>삭제</button>
      </div>
      <div class="pf-media-thumb-row">
        <img class="pf-media-thumb-preview" data-m-thumb-preview src="${esc(thumb)}" alt="" ${thumb ? '' : 'hidden'} />
        <input type="url" data-m-thumb placeholder="썸네일 이미지 URL (9:16 권장)" value="${esc(thumb)}" />
      </div>
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
      const kind = card.querySelector('[data-a-kind]')?.value || 'channel'
      const playlists = kind === 'channel'
        ? [...card.querySelectorAll('[data-pf-playlist]')].map((row) => ({
          id: row.querySelector('[data-pl-id]')?.value || '',
          url: row.querySelector('[data-pl-url]')?.value.trim() || '',
          label: row.querySelector('[data-pl-label]')?.value.trim() || '',
        })).filter((pl) => pl.url)
        : []
      return {
        id: card.querySelector('[data-a-id]')?.value || '',
        name: card.querySelector('[data-a-name]')?.value.trim() || '',
        handle: card.querySelector('[data-a-handle]')?.value.trim() || '',
        accountUrl: card.querySelector('[data-a-url]')?.value.trim() || '',
        avatarUrl: card.querySelector('[data-a-avatar]')?.value.trim() || '',
        bannerUrl: card.querySelector('[data-a-banner]')?.value.trim() || '',
        playlists,
        role: card.querySelector('[data-a-role]')?.value.trim() || '',
        startDate: card.querySelector('[data-a-start]')?.value || '',
        endDate: card.querySelector('[data-a-ongoing]')?.checked
          ? ''
          : (card.querySelector('[data-a-end]')?.value || ''),
        ongoing: !!card.querySelector('[data-a-ongoing]')?.checked,
        summary: card.querySelector('[data-a-summary]')?.value.trim() || '',
        highlights: highlightsRaw.split(/\n/).map((s) => s.trim()).filter(Boolean),
        metrics: kind === 'channel' ? [] : metrics,
      }
    }).filter((a) => a.name || a.handle)
  }

  function readMedia(container) {
    if (!container) return []
    return [...container.querySelectorAll('[data-pf-media]')].map((row) => {
      const item = {
        id: row.querySelector('[data-m-id]')?.value || '',
        title: row.querySelector('[data-m-title]')?.value.trim() || '',
        description: row.querySelector('[data-m-desc]')?.value.trim() || '',
        url: row.querySelector('[data-m-url]')?.value.trim() || '',
      }
      const thumbEl = row.querySelector('[data-m-thumb]')
      if (thumbEl) item.thumbnailUrl = thumbEl.value.trim() || ''
      return item
    }).filter((m) => m.title || m.url)
  }

  function fillWorksEditor(cfg) {
    _works = cfg
    document.getElementById('pf-yt-intro').value = cfg.youtube?.intro || ''
    document.getElementById('pf-ig-intro').value = cfg.instagram?.intro || ''

    const ytChannels = document.getElementById('pf-yt-channels')
    const ytShorts = document.getElementById('pf-yt-shorts')
    const igAccounts = document.getElementById('pf-ig-accounts')
    const rnItems = document.getElementById('pf-rn-items')

    ytChannels.innerHTML = (cfg.youtube?.channels || []).map((c) => accountCardHtml(c, 'channel')).join('')
    ytShorts.innerHTML = (cfg.youtube?.shorts || []).map(mediaRowHtml).join('')
    igAccounts.innerHTML = (cfg.instagram?.accounts || []).map((a) => accountCardHtml(a, 'account')).join('')
    rnItems.innerHTML = (cfg.rednote || []).map(rednoteMediaRowHtml).join('')
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
        e.target.closest('[data-pf-account]')?.remove()
        return
      }
      if (e.target.closest('[data-add-metric]')) {
        const metrics = e.target.closest('[data-pf-account]')?.querySelector('[data-a-metrics]')
        metrics?.insertAdjacentHTML('beforeend', metricRowsHtml([{ label: '', before: '', after: '', growth: '' }]))
        return
      }
      if (e.target.closest('[data-remove-metric]')) {
        e.target.closest('.pf-metric-row')?.remove()
        return
      }
      if (kind === 'channel' && e.target.closest('[data-add-playlist]')) {
        const wrap = e.target.closest('[data-pf-account]')?.querySelector('[data-a-playlists]')
        wrap?.insertAdjacentHTML('beforeend', playlistRowsHtml([emptyPlaylist()]))
        return
      }
      if (kind === 'channel' && e.target.closest('[data-remove-playlist]')) {
        e.target.closest('[data-pf-playlist]')?.remove()
      }
    })
    container?.addEventListener('change', (e) => {
      const ongoing = e.target.closest('[data-a-ongoing]')
      if (!ongoing) return
      const end = ongoing.closest('[data-pf-account]')?.querySelector('[data-a-end]')
      if (end) end.disabled = ongoing.checked
    })
    container?.addEventListener('input', (e) => {
      const avatarInput = e.target.closest('[data-a-avatar]')
      if (!avatarInput) return
      const card = avatarInput.closest('[data-pf-account]')
      const preview = card?.querySelector('[data-a-avatar-preview]')
      if (!preview) return
      const url = avatarInput.value.trim()
      if (url) {
        preview.src = url
        preview.hidden = false
      } else {
        preview.removeAttribute('src')
        preview.hidden = true
      }
    })
  }

  function bindMediaContainer(container, addBtnId, options = {}) {
    const { rowHtml = mediaRowHtml } = options
    document.getElementById(addBtnId)?.addEventListener('click', () => {
      container.insertAdjacentHTML('beforeend', rowHtml())
    })
    container?.addEventListener('click', (e) => {
      if (!e.target.closest('[data-remove-media]')) return
      e.target.closest('[data-pf-media]')?.remove()
    })
    container?.addEventListener('input', (e) => {
      const thumbInput = e.target.closest('[data-m-thumb]')
      if (!thumbInput) return
      const row = thumbInput.closest('[data-pf-media]')
      const preview = row?.querySelector('[data-m-thumb-preview]')
      if (!preview) return
      const url = thumbInput.value.trim()
      if (url) {
        preview.src = url
        preview.hidden = false
      } else {
        preview.removeAttribute('src')
        preview.hidden = true
      }
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
    bindMediaContainer(document.getElementById('pf-rn-items'), 'pf-rn-item-add', { rowHtml: rednoteMediaRowHtml })

    document.getElementById('portfolio-works-save')?.addEventListener('click', async () => {
      const statusEl = document.getElementById('portfolio-works-status')
      const btn = document.getElementById('portfolio-works-save')
      try {
        btn.disabled = true
        if (statusEl) statusEl.textContent = '저장 및 재생목록 조회수 계산 중…'
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

    document.getElementById('portfolio-works-refresh-stats')?.addEventListener('click', async () => {
      const statusEl = document.getElementById('portfolio-works-status')
      const btn = document.getElementById('portfolio-works-refresh-stats')
      try {
        btn.disabled = true
        if (statusEl) statusEl.textContent = '유튜브 재생목록 조회수 갱신 중…'
        const result = await API.post('/admin/instructor-portfolio-works/refresh-youtube-stats')
        fillWorksEditor(result)
        _worksLoaded = true
        if (statusEl) {
          statusEl.textContent = '조회수가 갱신되었습니다.' + (result.updated_at ? ' (' + result.updated_at.slice(0, 16).replace('T', ' ') + ')' : '')
        }
      } catch (e) {
        alert(e.message || '조회수 갱신 실패')
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
