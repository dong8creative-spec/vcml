/**
 * 강사 포트폴리오 — 플랫폼 탭 · 공유 · 선택형 견적
 * Admin에서 업력·포트폴리오·견적서를 수정할 수 있습니다.
 */
;(function () {
  'use strict'

  // ── 폴백 정적 데이터 (API 실패 시) ─────────────────────
  let PORTFOLIO_DATA = {
    youtube: {
      intro: '유튜브 채널 기획·편집·운영을 맡아 성장시킨 채널입니다. 담당 기간과 성과를 확인해 보세요.',
      channels: [
        {
          id: 'yt-ch-1',
          name: 'Cloud Hospital',
          handle: '@CloudHospital',
          accountUrl: 'https://www.youtube.com/',
          role: '채널 편집 · 더빙 · 업로드 운영',
          startDate: '2022-01',
          endDate: '2023-06',
          ongoing: false,
          metrics: [
            { label: '구독자', before: '1.2만', after: '3.8만', growth: '약 3.2배' },
            { label: '쇼츠 평균 조회', before: '5,000', after: '2.1만', growth: '약 4.2배' },
          ],
          summary: '의료 정보 콘텐츠를 쇼츠 중심으로 재구성해 구독 전환율을 높인 사례입니다.',
          highlights: ['쇼츠·롱폼 병행 업로드', '더빙·자막 워크플로 정립'],
          sample: true,
        },
        {
          id: 'yt-ch-2',
          name: '1분닥터',
          handle: '@1minDoctor',
          accountUrl: 'https://www.youtube.com/',
          role: '영상 편집 · 썸네일 · 채널 운영 보조',
          startDate: '2022-03',
          endDate: '2023-12',
          ongoing: false,
          metrics: [
            { label: '구독자', before: '8,500', after: '2.4만', growth: '약 2.8배' },
            { label: '월 업로드', before: '4편', after: '12편', growth: '3배' },
          ],
          summary: '정기 업로드 루틴과 쇼츠 큐레이션으로 채널 활성도를 끌어올린 사례입니다.',
          highlights: ['주 3회 업로드 체계', '썸네일·제목 패턴 표준화'],
          sample: true,
        },
        {
          id: 'yt-ch-3',
          name: '가로세로연구소',
          handle: '@가로세로연구소',
          accountUrl: 'https://www.youtube.com/',
          role: '채널 편집 · 콘텐츠 기획',
          startDate: '2022-06',
          endDate: null,
          ongoing: true,
          metrics: [
            { label: '구독자', before: '5,200', after: '1.9만', growth: '약 3.7배' },
            { label: '평균 조회', before: '1.1만', after: '4.5만', growth: '약 4.1배' },
          ],
          summary: '정보형 콘텐츠 포맷을 고정해 꾸준한 조회수 성장을 만든 진행 중 프로젝트입니다.',
          highlights: ['에피소드형 시리즈 기획', '편집 템플릿 공유로 제작 속도 향상'],
          sample: true,
        },
      ],
      shorts: [
      {
        id: 'yt-1',
        title: '캡컷 3초 훅 편집',
        description: '첫 3초에 시선을 잡는 숏폼 훅 예시',
        url: 'https://www.youtube.com/shorts/sample-hook',
        sample: true,
      },
      {
        id: 'yt-2',
        title: '제품 언박싱 쇼츠',
        description: '제품 디테일을 빠르게 보여주는 편집',
        url: 'https://www.youtube.com/shorts/sample-unboxing',
        sample: true,
      },
      {
        id: 'yt-3',
        title: '브이로그 하이라이트',
        description: '하루 일상을 15초로 압축한 쇼츠',
        url: 'https://www.youtube.com/shorts/sample-vlog',
        sample: true,
      },
      ],
    },
    instagram: {
      intro: '릴스 기획·편집·운영을 맡아 성장시킨 인스타그램 계정입니다. 담당 기간과 성과를 확인해 보세요.',
      accounts: [
        {
          id: 'ig-1',
          name: '자영업자학교',
          handle: '@자영업자학교',
          accountUrl: 'https://www.instagram.com/',
          role: '릴스 기획 · 편집 · 업로드 운영',
          startDate: '2024-03',
          endDate: '2024-11',
          ongoing: false,
          metrics: [
            { label: '팔로워', before: '1,200', after: '8,500', growth: '약 7배' },
            { label: '릴스 평균 조회', before: '800', after: '1.2만', growth: '약 15배' },
          ],
          summary: '정보형 릴스 중심으로 콘텐츠 톤을 재정비하고, 업로드 주기를 고정해 계정 성장세를 만든 사례입니다.',
          highlights: ['월 8~12개 릴스 업로드', '저장·공유율 높은 정보형 포맷 정착'],
          sample: true,
        },
        {
          id: 'ig-2',
          name: '안리고택',
          handle: '@안리고택',
          accountUrl: 'https://www.instagram.com/',
          role: '브랜드 톤 정립 · 숏폼 편집',
          startDate: '2024-05',
          endDate: '2025-02',
          ongoing: false,
          metrics: [
            { label: '팔로워', before: '2,400', after: '6,800', growth: '약 2.8배' },
            { label: '릴스 최고 조회', before: '3,500', after: '4.8만', growth: '약 14배' },
          ],
          summary: '공간·체험 중심 브랜드 스토리를 9:16 숏폼으로 풀어내 관심 전환율을 높인 사례입니다.',
          highlights: ['공간 하이라이트 시리즈 기획', '예약 문의 연결 콘텐츠 강화'],
          sample: true,
        },
        {
          id: 'ig-3',
          name: '최선장',
          handle: '@최선장',
          accountUrl: 'https://www.instagram.com/',
          role: '릴스 편집 · 계정 운영 보조',
          startDate: '2024-08',
          endDate: null,
          ongoing: true,
          metrics: [
            { label: '팔로워', before: '900', after: '3,200', growth: '약 3.6배' },
            { label: '릴스 평균 조회', before: '1,100', after: '9,500', growth: '약 8.6배' },
          ],
          summary: '현장감 있는 촬영 소스를 빠른 편집 템플릿으로 정리해 꾸준한 업로드 체계를 만든 진행 중 프로젝트입니다.',
          highlights: ['주 2회 업로드 루틴 구축', '현장 촬영 → 당일 편집 워크플로'],
          sample: true,
        },
      ],
    },
    rednote: [
      {
        id: 'rn-1',
        title: '샤오홍슈 제품 리뷰',
        description: '중국 숏폼 톤에 맞춘 제품 예시',
        url: 'https://www.xiaohongshu.com/explore/sample-review',
        sample: true,
      },
      {
        id: 'rn-2',
        title: '생활 팁 숏폼',
        description: '정보형 콘텐츠 템플릿 작업',
        url: 'https://www.xiaohongshu.com/explore/sample-tips',
        sample: true,
      },
    ],
  }

  const QUOTE_FALLBACK = {
    section_title: '선택형 견적서',
    section_desc: '기획 · 촬영 · 편집 중 필요한 범위를 선택하면 예상 금액이 달라집니다.',
    scope_note: '견적은 선택하신 기획·촬영·편집 범위와 항목에 따라 달라집니다. 필요한 분류와 옵션만 골라 확인하세요.',
    summary_note: '부가세·출장비·수정 횟수에 따라 달라질 수 있습니다',
    disclaimer: '이 견적서는 참고용 초안입니다. 실제 금액은 작업 범위·분량·일정에 따라 달라지며, 문의·결제 기능은 포함되어 있지 않습니다.',
    groups: [],
  }

  let quoteConfig = { ...QUOTE_FALLBACK, groups: [] }

  // ── 유틸 ──────────────────────────────────────────────
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

  function toYoutubeEmbed(url) {
    if (!url) return null
    try {
      const u = new URL(url)
      if (u.hostname === 'youtu.be') {
        const id = u.pathname.replace(/^\//, '').split('/')[0]
        return id && !id.startsWith('sample') ? `https://www.youtube.com/embed/${id}` : null
      }
      if (u.hostname.includes('youtube.com')) {
        const v = u.searchParams.get('v')
        if (v) return `https://www.youtube.com/embed/${v}`
        const m = u.pathname.match(/\/(embed|shorts|live)\/([^/?]+)/)
        if (m && m[2] && !m[2].startsWith('sample')) {
          return `https://www.youtube.com/embed/${m[2]}`
        }
      }
    } catch (_) {}
    return null
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

  async function shareOrCopy({ title, text, url }) {
    if (navigator.share) {
      try {
        await navigator.share({ title, text, url })
        return
      } catch (err) {
        if (err && err.name === 'AbortError') return
      }
    }
    const ok = await copyText(url)
    notify(ok ? '링크를 복사했습니다.' : '복사에 실패했습니다. 주소를 직접 복사해 주세요.', ok ? 'success' : 'error')
  }

  // ── 플랫폼 렌더 ───────────────────────────────────────
  const MARQUEE_MIN_ITEMS = 3

  function buildYoutubeCard(item) {
    const embed = item.sample ? null : toYoutubeEmbed(item.url)
    const thumb = embed
      ? `<iframe src="${esc(embed)}" title="${esc(item.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe>`
      : `<div class="portfolio-media-card__placeholder">
           <i class="ti ti-brand-youtube" aria-hidden="true"></i>
           <span>${item.sample ? '샘플 링크<br>실제 Shorts URL로 교체' : '미리보기 준비 중'}</span>
         </div>`
    return `<article class="portfolio-media-card">
      <div class="portfolio-media-card__thumb">
        <span class="portfolio-media-card__badge">Shorts</span>
        ${thumb}
      </div>
      <div class="portfolio-media-card__body">
        <h3 class="portfolio-media-card__title">${esc(item.title)}</h3>
        <p class="portfolio-media-card__desc">${esc(item.description || '')}</p>
        <div class="portfolio-media-card__actions">
          <a class="portfolio-btn portfolio-btn--primary portfolio-btn--sm" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">원본 보기</a>
          <button type="button" class="portfolio-btn portfolio-btn--ghost portfolio-btn--sm" data-share-url="${esc(item.url)}" data-share-title="${esc(item.title)}">링크 복사</button>
        </div>
      </div>
    </article>`
  }

  function buildRednoteCard(item) {
    return `<article class="portfolio-media-card">
      <div class="portfolio-media-card__thumb">
        <span class="portfolio-media-card__badge">Rednote</span>
        <div class="portfolio-media-card__placeholder">
          <i class="ti ti-notebook" aria-hidden="true"></i>
          <span>${item.sample ? '샘플 링크<br>실제 게시물 URL로 교체' : '외부에서 보기'}</span>
        </div>
      </div>
      <div class="portfolio-media-card__body">
        <h3 class="portfolio-media-card__title">${esc(item.title)}</h3>
        <p class="portfolio-media-card__desc">${esc(item.description || '')}</p>
        <div class="portfolio-media-card__actions">
          <a class="portfolio-btn portfolio-btn--primary portfolio-btn--sm" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">원본 보기</a>
          <button type="button" class="portfolio-btn portfolio-btn--ghost portfolio-btn--sm" data-share-url="${esc(item.url)}" data-share-title="${esc(item.title)}">링크 복사</button>
        </div>
      </div>
    </article>`
  }

  function shouldUseMarquee(items, probeEl) {
    if (items.length >= MARQUEE_MIN_ITEMS) return true
    if (!probeEl) return false
    return probeEl.scrollWidth > probeEl.clientWidth + 4
  }

  function buildMarqueeHtml(cardsHtml) {
    return `<div class="portfolio-marquee" data-portfolio-marquee>
      <div class="portfolio-marquee__viewport">
        <div class="portfolio-marquee__track">
          <div class="portfolio-marquee__group">${cardsHtml}</div>
          <div class="portfolio-marquee__group" aria-hidden="true">${cardsHtml}</div>
        </div>
      </div>
    </div>`
  }

  function setupMarquee(marqueeEl) {
    if (!marqueeEl || marqueeEl.dataset.marqueeReady === '1') return

    const track = marqueeEl.querySelector('.portfolio-marquee__track')
    const group = marqueeEl.querySelector('.portfolio-marquee__group')
    if (!track || !group) return

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const groupWidth = group.getBoundingClientRect().width
    if (groupWidth <= 0) return

    const pxPerSecond = 42
    const duration = Math.max(groupWidth / pxPerSecond, 14)
    track.style.setProperty('--marquee-distance', `${groupWidth}px`)
    track.style.setProperty('--marquee-duration', `${duration}s`)

    if (!reducedMotion) {
      marqueeEl.classList.add('is-active')
      marqueeEl.addEventListener('mouseenter', () => marqueeEl.classList.add('is-paused'))
      marqueeEl.addEventListener('mouseleave', () => marqueeEl.classList.remove('is-paused'))
      marqueeEl.addEventListener('focusin', () => marqueeEl.classList.add('is-paused'))
      marqueeEl.addEventListener('focusout', () => marqueeEl.classList.remove('is-paused'))
    }

    marqueeEl.dataset.marqueeReady = '1'
  }

  function initMarqueesIn(root) {
    if (!root) return
    root.querySelectorAll('[data-portfolio-marquee]').forEach(setupMarquee)
  }

  function renderScrollingMediaList(container, items, buildCard, emptyMessage) {
    if (!items.length) {
      container.innerHTML = `<p class="portfolio-empty">${emptyMessage}</p>`
      return
    }

    const cardsHtml = items.map(buildCard).join('')
    container.innerHTML = `<div class="portfolio-grid portfolio-grid--probe">${cardsHtml}</div>`

    const probe = container.querySelector('.portfolio-grid--probe')
    const useMarquee = shouldUseMarquee(items, probe)

    if (!useMarquee) {
      probe.classList.remove('portfolio-grid--probe')
      return
    }

    container.innerHTML = buildMarqueeHtml(cardsHtml)
    if (container.offsetParent !== null) {
      initMarqueesIn(container)
    } else {
      container.dataset.marqueePending = '1'
    }
  }

  function normalizeYoutubeData(youtube) {
    if (Array.isArray(youtube)) {
      return { intro: '', channels: [], shorts: youtube }
    }
    return {
      intro: youtube?.intro || '',
      channels: youtube?.channels || [],
      shorts: youtube?.shorts || [],
    }
  }

  function renderChannelAccountCard(account, { iconClass, visitLabel, shareLabel, sampleNote }) {
    const period = formatPeriod(account.startDate, account.endDate, account.ongoing)
    const statusLabel = account.ongoing ? '진행 중' : '계약 종료'
    const statusClass = account.ongoing ? 'is-ongoing' : 'is-completed'
    const highlights = Array.isArray(account.highlights) && account.highlights.length
      ? `<ul class="ig-account-card__highlights">${account.highlights.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>`
      : ''

    return `<article class="ig-account-card">
      <div class="ig-account-card__head">
        <div class="ig-account-card__identity">
          <div class="ig-account-card__icon" aria-hidden="true"><i class="${iconClass}"></i></div>
          <div>
            <h3 class="ig-account-card__name">${esc(account.name)}</h3>
            <p class="ig-account-card__handle">${esc(account.handle)}</p>
          </div>
        </div>
        <span class="ig-account-card__status ${statusClass}">${statusLabel}</span>
      </div>

      <dl class="ig-account-card__meta">
        <div class="ig-account-card__meta-row">
          <dt>담당 기간</dt>
          <dd>${esc(period)}</dd>
        </div>
        ${account.role ? `
        <div class="ig-account-card__meta-row">
          <dt>담당 업무</dt>
          <dd>${esc(account.role)}</dd>
        </div>` : ''}
      </dl>

      ${renderMetricCards(account.metrics)}

      ${account.summary ? `<p class="ig-account-card__summary">${esc(account.summary)}</p>` : ''}
      ${highlights}

      ${account.sample ? `<p class="ig-account-card__sample">${esc(sampleNote)}</p>` : ''}

      <div class="ig-account-card__actions">
        <a class="portfolio-btn portfolio-btn--primary portfolio-btn--sm" href="${esc(account.accountUrl)}" target="_blank" rel="noopener noreferrer">${esc(visitLabel)}</a>
        <button type="button" class="portfolio-btn portfolio-btn--ghost portfolio-btn--sm" data-share-url="${esc(account.accountUrl)}" data-share-title="${esc(account.name)}">${esc(shareLabel)}</button>
      </div>
    </article>`
  }

  function renderChannelAccountsSection(intro, accounts, options) {
    if (!accounts.length) return ''
    const {
      sectionTitle = '채널 관리',
      iconClass = 'ti ti-brand-youtube',
      visitLabel = '채널 방문',
      shareLabel = '채널 링크 공유',
      sampleNote = '샘플 데이터 · 실제 채널 URL과 수치로 교체하세요',
    } = options
    return `
      <section class="platform-section">
        <h3 class="platform-section__title">${esc(sectionTitle)}</h3>
        ${intro ? `<p class="platform-section__desc">${esc(intro)}</p>` : ''}
        <div class="ig-account-list">
          ${accounts.map((account) => renderChannelAccountCard(account, {
            iconClass, visitLabel, shareLabel, sampleNote,
          })).join('')}
        </div>
      </section>
    `
  }

  function renderShortsSection(items, buildCard, emptyMessage) {
    const sectionOpen = `<section class="platform-section"><h3 class="platform-section__title">쇼츠 작업물</h3><div class="platform-section__media" data-shorts-list>`
    const sectionClose = `</div></section>`

    if (!items.length) {
      return `${sectionOpen}<p class="portfolio-empty">${emptyMessage}</p>${sectionClose}`
    }

    const cardsHtml = items.map(buildCard).join('')
    return `${sectionOpen}
      <div class="portfolio-grid portfolio-grid--probe">${cardsHtml}</div>
    ${sectionClose}`
  }

  function finalizeShortsSection(container) {
    const mediaWrap = container.querySelector('[data-shorts-list]')
    if (!mediaWrap) return

    const probe = mediaWrap.querySelector('.portfolio-grid--probe')
    if (!probe) return

    const items = probe.querySelectorAll('.portfolio-media-card')
    const useMarquee = shouldUseMarquee(Array.from(items), probe)

    if (!useMarquee) {
      probe.classList.remove('portfolio-grid--probe')
      return
    }

    const cardsHtml = probe.innerHTML
    mediaWrap.innerHTML = buildMarqueeHtml(cardsHtml)
    if (container.offsetParent !== null) {
      initMarqueesIn(mediaWrap)
    } else {
      container.dataset.marqueePending = '1'
    }
  }

  function renderYoutube(container) {
    const yt = normalizeYoutubeData(PORTFOLIO_DATA.youtube)
    const hasChannels = yt.channels.length > 0
    const hasShorts = yt.shorts.length > 0

    if (!hasChannels && !hasShorts) {
      container.innerHTML = '<p class="portfolio-empty">등록된 유튜브 콘텐츠가 없습니다.</p>'
      return
    }

    container.innerHTML = [
      hasChannels ? renderChannelAccountsSection(yt.intro, yt.channels, {
        sectionTitle: '채널 관리',
        iconClass: 'ti ti-brand-youtube',
        visitLabel: '채널 방문',
        shareLabel: '채널 링크 공유',
        sampleNote: '샘플 데이터 · 실제 채널 URL과 수치로 교체하세요',
      }) : '',
      hasShorts ? renderShortsSection(yt.shorts, buildYoutubeCard, '등록된 유튜브 쇼츠가 없습니다.') : '',
    ].join('')

    finalizeShortsSection(container)
  }

  function formatPeriod(startDate, endDate, ongoing) {
    const start = formatYearMonth(startDate)
    if (ongoing) return `${start} ~ 현재`
    const end = formatYearMonth(endDate)
    return end ? `${start} ~ ${end}` : start
  }

  function formatYearMonth(value) {
    if (!value) return ''
    const m = String(value).match(/^(\d{4})-(\d{1,2})$/)
    if (m) return `${m[1]}.${m[2].padStart(2, '0')}`
    return String(value)
  }

  function renderMetricCards(metrics) {
    if (!Array.isArray(metrics) || !metrics.length) return ''
    return `<div class="ig-account-card__metrics">${metrics.map((metric) => `
      <div class="ig-metric">
        <p class="ig-metric__label">${esc(metric.label)}</p>
        <p class="ig-metric__value">${esc(metric.before)} → ${esc(metric.after)}</p>
        ${metric.growth ? `<p class="ig-metric__growth">${esc(metric.growth)}</p>` : ''}
      </div>
    `).join('')}</div>`
  }

  function renderInstagram(container) {
    const ig = PORTFOLIO_DATA.instagram
    const accounts = ig?.accounts || []
    if (!accounts.length) {
      container.innerHTML = '<p class="portfolio-empty">등록된 인스타그램 계정 정보가 없습니다.</p>'
      return
    }

    container.innerHTML = renderChannelAccountsSection(ig.intro, accounts, {
      sectionTitle: '계정 관리',
      iconClass: 'ti ti-brand-instagram',
      visitLabel: '계정 방문',
      shareLabel: '계정 링크 공유',
      sampleNote: '샘플 데이터 · 실제 계정 URL과 수치로 교체하세요',
    })
  }

  function renderRednote(container) {
    renderScrollingMediaList(
      container,
      PORTFOLIO_DATA.rednote || [],
      buildRednoteCard,
      '등록된 샤오홍슈 영상이 없습니다.'
    )
  }

  function setPlatform(platform) {
    document.querySelectorAll('.portfolio-filter__btn').forEach((btn) => {
      const active = btn.dataset.platform === platform
      btn.classList.toggle('active', active)
      btn.setAttribute('aria-selected', active ? 'true' : 'false')
    })
    document.querySelectorAll('.portfolio-panel').forEach((panel) => {
      panel.hidden = panel.dataset.platform !== platform
    })
    const activePanel = document.querySelector(`.portfolio-panel[data-platform="${platform}"]`)
    if (activePanel) {
      if (activePanel.dataset.marqueePending === '1') delete activePanel.dataset.marqueePending
      initMarqueesIn(activePanel)
    }
  }

  function bindShareButtons(root) {
    root.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-share-url]')
      if (!btn) return
      const url = btn.getAttribute('data-share-url')
      const title = btn.getAttribute('data-share-title') || '포트폴리오'
      await shareOrCopy({ title, text: title, url })
    })
  }

  // ── 견적 ──────────────────────────────────────────────
  function applyQuoteMeta(config) {
    const titleEl = document.getElementById('quote-title')
    const descEl = document.getElementById('quote-section-desc')
    const scopeEl = document.getElementById('quote-scope-note')
    const summaryEl = document.getElementById('quote-summary-note')
    const disclaimerEl = document.getElementById('quote-disclaimer')

    if (titleEl && config.section_title) titleEl.textContent = config.section_title
    if (descEl && config.section_desc) descEl.textContent = config.section_desc
    if (scopeEl) scopeEl.textContent = config.scope_note || ''
    if (summaryEl && config.summary_note) summaryEl.textContent = config.summary_note
    if (disclaimerEl && config.disclaimer) disclaimerEl.textContent = config.disclaimer
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
    const activeGroups = new Set(selected.map(item => item.groupId))
    document.querySelectorAll('.quote-scope-tag').forEach((tag) => {
      tag.classList.toggle('is-active', activeGroups.has(tag.dataset.scopeGroup))
    })
  }

  async function loadWorksConfig() {
    try {
      const api = window.API || (typeof API !== 'undefined' ? API : null)
      if (api?.get) {
        const data = await api.get('/instructor-portfolio/works')
        if (data && (data.youtube || data.instagram || data.rednote)) {
          PORTFOLIO_DATA = {
            youtube: data.youtube || PORTFOLIO_DATA.youtube,
            instagram: data.instagram || PORTFOLIO_DATA.instagram,
            rednote: data.rednote || PORTFOLIO_DATA.rednote,
          }
        }
      }
    } catch (_) {}
    return PORTFOLIO_DATA
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
    if (!groups.length) {
      container.innerHTML = '<p class="portfolio-empty">등록된 견적 항목이 없습니다.</p>'
      return
    }
    container.innerHTML = groups.map((group) => `
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
      '[타닥클래스 강사 포트폴리오 예상 견적]',
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

  // ── 초기화 ────────────────────────────────────────────
  async function init() {
    const yt = document.getElementById('panel-youtube')
    const ig = document.getElementById('panel-instagram')
    const rn = document.getElementById('panel-rednote')
    const quoteGroups = document.getElementById('quote-groups')

    await loadWorksConfig()

    if (yt) renderYoutube(yt)
    if (ig) renderInstagram(ig)
    if (rn) renderRednote(rn)
    initMarqueesIn(document.getElementById('panel-youtube'))

    const quoteData = await loadQuoteConfig()
    applyQuoteMeta(quoteData)
    if (quoteGroups) renderQuoteGroups(quoteGroups, quoteData.groups || [])

    document.querySelectorAll('.portfolio-filter__btn').forEach((btn) => {
      btn.addEventListener('click', () => setPlatform(btn.dataset.platform))
    })

    const worksCard = document.querySelector('.portfolio-card[aria-labelledby="works-title"]')
    if (worksCard) bindShareButtons(worksCard)

    document.getElementById('share-page-btn')?.addEventListener('click', () => {
      shareOrCopy({
        title: '강사 포트폴리오 — 타닥클래스',
        text: '도각쌤 포트폴리오를 확인해 보세요',
        url: location.href,
      })
    })

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
