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

  // ── 유틸 ──────────────────────────────────────────────
  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function renderHighlightsHtml(account) {
    const list = Array.isArray(account?.highlights) ? account.highlights : []
    if (!list.length) return ''
    const text = list.length === 1 ? list[0] : list.join(' ')
    if (!String(text).trim()) return ''
    return `<p class="ig-account-card__highlights-text">${esc(text)}</p>`
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
           <span>${item.sample ? '샘플 링크 · 실제 Shorts URL로 교체' : '미리보기 준비 중'}</span>
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

  function buildRednoteRowCard(item) {
    return `<article class="rednote-row-card">
      <div class="rednote-row-card__brand" aria-hidden="true">
        <div class="rednote-row-card__symbol">
          <i class="ti ti-book-2" aria-hidden="true"></i>
        </div>
        <span class="rednote-row-card__brand-label">小红书</span>
      </div>
      <div class="rednote-row-card__main">
        <div class="rednote-row-card__head">
          <span class="rednote-row-card__badge">샤오홍슈</span>
          <h3 class="rednote-row-card__title">${esc(item.title)}</h3>
        </div>
        ${item.description ? `<p class="rednote-row-card__desc">${esc(item.description)}</p>` : ''}
        ${renderGrowthMetricsGrid(item.metrics)}
      </div>
      <div class="rednote-row-card__actions">
        <a class="rednote-row-card__link" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">
          <span>게시물 보기</span>
          <i class="ti ti-arrow-up-right" aria-hidden="true"></i>
        </a>
      </div>
    </article>`
  }

  function renderRednoteSection(items, emptyMessage) {
    if (!items.length) {
      return `<p class="portfolio-empty">${emptyMessage}</p>`
    }
    return `
      <section class="platform-section platform-section--rednote">
        <h3 class="platform-section__title">영상 포트폴리오</h3>
        <p class="platform-section__desc">샤오홍슈 게시물 링크와 작업 요약입니다. 썸네일 미제공으로 브랜드 심볼로 표시합니다.</p>
        <div class="rednote-row-list">${items.map(buildRednoteRowCard).join('')}</div>
      </section>`
  }

  function buildRednoteCard(item) {
    const thumbUrl = String(item.thumbnailUrl || item.thumbnail_url || '').trim()
    const thumbHtml = thumbUrl
      ? `<img class="portfolio-media-card__cover" src="${esc(thumbUrl)}" alt="${esc(item.title)}" loading="lazy" decoding="async" onerror="this.remove();this.parentElement.classList.add('is-thumb-missing')" />`
      : ''
    const placeholderHtml = `<div class="portfolio-media-card__placeholder">
          <i class="ti ti-notebook" aria-hidden="true"></i>
          <span>${item.sample ? '샘플 링크 · 실제 게시물 URL로 교체' : thumbUrl ? '썸네일을 불러오지 못했습니다' : '썸네일 URL을 추가하세요'}</span>
        </div>`
    return `<article class="portfolio-media-card">
      <div class="portfolio-media-card__thumb${thumbUrl ? '' : ' is-thumb-missing'}">
        <span class="portfolio-media-card__badge">Rednote</span>
        ${thumbHtml}
        ${placeholderHtml}
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

  function normalizeVisitUrl(url, platform) {
    let raw = String(url || '').trim()
    if (!raw) return ''
    if (platform === 'youtube') {
      raw = raw
        .replace(/\/(shorts|videos|streams|playlists|community|about|featured|channels)(\/.*)?$/i, '')
        .replace(/[?&]list=[^&#]+/i, '')
        .replace(/\/+$/, '')
      if (/youtube\.com\/@[^/?#]+/i.test(raw)) {
        const handle = raw.match(/youtube\.com\/(@[^/?#]+)/i)
        if (handle) return `https://www.youtube.com/${handle[1]}`
      }
    }
    if (platform === 'instagram') {
      const user = raw.match(/instagram\.com\/([^/?#]+)/i)
      if (user && !['p', 'reel', 'reels', 'stories', 'explore'].includes(user[1].toLowerCase())) {
        return `https://www.instagram.com/${user[1]}/`
      }
    }
    return raw
  }

  function normalizePlaylistUrl(url) {
    const raw = String(url || '').trim()
    if (!raw) return ''
    const listMatch = raw.match(/[?&]list=([^&#]+)/i)
    if (listMatch) return `https://www.youtube.com/playlist?list=${listMatch[1]}`
    if (/youtube\.com\/playlist/i.test(raw)) return raw.split('#')[0]
    return ''
  }

  function formatViewCount(n) {
    const num = Number(n || 0)
    if (!Number.isFinite(num) || num <= 0) return '0'
    if (num >= 100000000) return `${(num / 100000000).toFixed(1).replace(/\.0$/, '')}억`
    if (num >= 10000) return `${(num / 10000).toFixed(1).replace(/\.0$/, '')}만`
    return num.toLocaleString('ko-KR')
  }

  function mergeAccountSummary(account) {
    const chunks = []
    const summary = String(account?.summary || '').trim()
    if (summary) chunks.push(summary)
    const highlights = Array.isArray(account?.highlights) ? account.highlights : []
    const hlText = highlights.map((item) => String(item || '').trim()).filter(Boolean).join(' ')
    if (hlText && !summary.includes(hlText)) chunks.push(hlText)
    const text = chunks.join(' ').trim()
    if (!text) return ''
    return `<p class="ig-account-card__summary">${esc(text)}</p>`
  }

  function renderAccountContextLine(period, role) {
    const parts = [period, role].map((value) => String(value || '').trim()).filter(Boolean)
    if (!parts.length) return ''
    return `<p class="account-card__context">${esc(parts.join(' · '))}</p>`
  }

  function renderGrowthMetricsGrid(metrics) {
    const list = Array.isArray(metrics)
      ? metrics.filter((metric) => String(metric?.label || metric?.before || metric?.after || metric?.growth || '').trim())
      : []
    if (!list.length) return ''
    return `<div class="yt-channel-card__stats yt-channel-card__stats--metrics">${list.map((metric) => `
      <div class="yt-channel-card__stat">
        <span class="yt-channel-card__stat-label">${esc(metric.label)}</span>
        <strong class="yt-channel-card__stat-value">${esc(metric.before)} → ${esc(metric.after)}</strong>
        ${metric.growth ? `<span class="yt-channel-card__stat-growth">${esc(metric.growth)}</span>` : ''}
      </div>
    `).join('')}</div>`
  }

  function renderPlaylistViewStats(viewStats) {
    const stats = viewStats || {}
    if (!stats.videoCount && !stats.totalViews && !stats.averageViews) return ''
    return `<div class="yt-channel-card__stats yt-channel-card__stats--views">
      <div class="yt-channel-card__stat">
        <span class="yt-channel-card__stat-label">평균 조회수</span>
        <strong class="yt-channel-card__stat-value">${formatViewCount(stats.averageViews)}</strong>
        <span class="yt-channel-card__stat-unit">회</span>
      </div>
      <div class="yt-channel-card__stat">
        <span class="yt-channel-card__stat-label">편집 영상</span>
        <strong class="yt-channel-card__stat-value">${formatViewCount(stats.videoCount)}</strong>
        <span class="yt-channel-card__stat-unit">개</span>
      </div>
      <div class="yt-channel-card__stat">
        <span class="yt-channel-card__stat-label">총 조회수</span>
        <strong class="yt-channel-card__stat-value">${formatViewCount(stats.totalViews)}</strong>
        <span class="yt-channel-card__stat-unit">회</span>
      </div>
    </div>`
  }

  function renderChannelMetricStats(metrics, viewStats = null) {
    const growthHtml = renderGrowthMetricsGrid(metrics)
    const viewsHtml = viewStats ? renderPlaylistViewStats(viewStats) : ''
    if (!growthHtml && !viewsHtml) {
      if (viewStats) {
        return '<p class="yt-channel-card__stats-empty">재생목록을 연결하면 편집 포트폴리오의 평균·총 조회수가 표시됩니다.</p>'
      }
      return '<p class="yt-channel-card__stats-empty">성과 지표를 입력하면 계정 운영 성과가 표시됩니다.</p>'
    }
    return `${growthHtml}${viewsHtml}`
  }

  function renderPlaylistActions(playlists, defaultLabel = '작업 영상 보기') {
    const items = (Array.isArray(playlists) ? playlists : [])
      .map((pl, index) => {
        const url = normalizePlaylistUrl(pl?.url || pl?.playlistUrl)
        if (!url) return null
        const label = String(pl?.label || pl?.playlistLabel || '').trim()
          || (playlists.length > 1 ? `재생목록 ${index + 1}` : defaultLabel)
        return { url, label }
      })
      .filter(Boolean)
    if (!items.length) return { primary: '', more: '' }

    const primary = items[0]
    const primaryHtml = `<a class="ig-account-card__playlist-btn" href="${esc(primary.url)}" target="_blank" rel="noopener noreferrer">
      <i class="ti ti-player-play" aria-hidden="true"></i>
      <span>${esc(items.length > 1 ? defaultLabel : primary.label)}</span>
      <i class="ti ti-arrow-up-right" aria-hidden="true"></i>
    </a>`

    if (items.length === 1) return { primary: primaryHtml, more: '' }

    const moreHtml = `<details class="account-card__playlist-more">
      <summary>재생목록 ${items.length}개</summary>
      <div class="account-card__playlist-more-list">${items.slice(1).map((item) => `
        <a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.label)}</a>
      `).join('')}</div>
    </details>`
    return { primary: primaryHtml, more: moreHtml }
  }

  function renderInstagramAccountCard(account, options) {
    const {
      visitLabel = '인스타그램 열기',
      sampleNote,
    } = options
    const visitUrl = normalizeVisitUrl(account.accountUrl, 'instagram')
    const avatarUrl = String(account.avatarUrl || account.avatar_url || account.profileImage || '').trim()
    const period = formatPeriod(account.startDate, account.endDate, account.ongoing)
    const statusLabel = account.ongoing ? '진행 중' : '계약 종료'
    const statusClass = account.ongoing ? 'is-ongoing' : 'is-completed'
    const metricsHtml = renderChannelMetricStats(account.metrics)
    const summaryHtml = mergeAccountSummary(account)

    const avatarHtml = avatarUrl
      ? `<img class="yt-channel-card__avatar" src="${esc(avatarUrl)}" alt="" loading="lazy" decoding="async" onerror="this.classList.add('is-hidden')" />
         <div class="yt-channel-card__avatar yt-channel-card__avatar--fallback" aria-hidden="true"><i class="ti ti-brand-instagram"></i></div>`
      : `<div class="yt-channel-card__avatar yt-channel-card__avatar--fallback" aria-hidden="true"><i class="ti ti-brand-instagram"></i></div>`

    const visitAction = visitUrl
      ? `<a class="ig-account-card__visit-btn" href="${esc(visitUrl)}" target="_blank" rel="noopener noreferrer">
          <i class="ti ti-brand-instagram" aria-hidden="true"></i>
          <span>${esc(visitLabel)}</span>
          <i class="ti ti-arrow-up-right" aria-hidden="true"></i>
        </a>`
      : ''

    return `<article class="yt-channel-card ig-account-card ig-account-card--instagram yt-channel-card--no-hero">
      <div class="yt-channel-card__main">
        <header class="yt-channel-card__header">
          <div class="yt-channel-card__avatar-wrap">${avatarHtml}</div>
          <div class="yt-channel-card__identity">
            <h3 class="yt-channel-card__name">${esc(account.name)}</h3>
            <p class="yt-channel-card__handle">${esc(account.handle)}</p>
          </div>
          <span class="ig-account-card__status ${statusClass}">${statusLabel}</span>
        </header>
        <div class="yt-channel-card__body">
          ${renderAccountContextLine(period, account.role)}
          ${metricsHtml}
          ${summaryHtml}
          ${account.sample ? `<p class="ig-account-card__sample">${esc(sampleNote)}</p>` : ''}

          ${visitAction ? `<div class="ig-account-card__actions">${visitAction}</div>` : ''}
        </div>
      </div>
    </article>`
  }

  function renderYoutubeChannelCard(account, options) {
    const {
      visitLabel = '유튜브 채널 열기',
      playlistLabel = '작업 영상 보기',
      sampleNote,
    } = options
    const visitUrl = normalizeVisitUrl(account.accountUrl, 'youtube')
    const bannerUrl = String(account.bannerUrl || account.banner_url || '').trim()
    const avatarUrl = String(account.avatarUrl || account.avatar_url || '').trim()
    const playlists = (Array.isArray(account.playlists) ? account.playlists : [])
      .filter((pl) => normalizePlaylistUrl(pl?.url || pl?.playlistUrl))
    const stats = account.viewStats || {}
    const period = formatPeriod(account.startDate, account.endDate, account.ongoing)
    const statusLabel = account.ongoing ? '진행 중' : '계약 종료'
    const statusClass = account.ongoing ? 'is-ongoing' : 'is-completed'
    const summaryHtml = mergeAccountSummary(account)

    const bannerHtml = bannerUrl
      ? `<img class="yt-channel-card__banner" src="${esc(bannerUrl)}" alt="" loading="lazy" decoding="async" />`
      : `<div class="yt-channel-card__banner yt-channel-card__banner--empty" aria-hidden="true"><i class="ti ti-brand-youtube"></i></div>`

    const avatarHtml = avatarUrl
      ? `<img class="yt-channel-card__avatar" src="${esc(avatarUrl)}" alt="" loading="lazy" decoding="async" onerror="this.classList.add('is-hidden')" />
         <div class="yt-channel-card__avatar yt-channel-card__avatar--fallback" aria-hidden="true"><i class="ti ti-brand-youtube"></i></div>`
      : `<div class="yt-channel-card__avatar yt-channel-card__avatar--fallback" aria-hidden="true"><i class="ti ti-brand-youtube"></i></div>`

    const statsHtml = renderChannelMetricStats(account.metrics, stats)

    const playlistActions = renderPlaylistActions(playlists, playlistLabel)

    const visitAction = visitUrl
      ? `<a class="ig-account-card__visit-btn" href="${esc(visitUrl)}" target="_blank" rel="noopener noreferrer">
          <i class="ti ti-brand-youtube" aria-hidden="true"></i>
          <span>${esc(visitLabel)}</span>
          <i class="ti ti-arrow-up-right" aria-hidden="true"></i>
        </a>`
      : ''

    const hasActions = visitUrl || playlistActions.primary

    return `<article class="yt-channel-card ig-account-card ig-account-card--youtube">
      <div class="yt-channel-card__hero">
        ${bannerHtml}
      </div>
      <div class="yt-channel-card__main">
        <header class="yt-channel-card__header">
          <div class="yt-channel-card__avatar-wrap">${avatarHtml}</div>
          <div class="yt-channel-card__identity">
            <h3 class="yt-channel-card__name">${esc(account.name)}</h3>
            <p class="yt-channel-card__handle">${esc(account.handle)}</p>
          </div>
          <span class="ig-account-card__status ${statusClass}">${statusLabel}</span>
        </header>
        <div class="yt-channel-card__body">
        ${renderAccountContextLine(period, account.role)}
        ${statsHtml}
        ${summaryHtml}
        ${account.sample ? `<p class="ig-account-card__sample">${esc(sampleNote)}</p>` : ''}

        ${hasActions ? `<div class="ig-account-card__actions${playlistActions.primary ? ' ig-account-card__actions--split' : ''}">
          ${visitAction}
          ${playlistActions.primary}
        </div>${playlistActions.more}` : ''}
        </div>
      </div>
    </article>`
  }

  function renderAccountAvatar(account, iconClass) {
    const avatarUrl = String(account?.avatarUrl || account?.avatar_url || account?.profileImage || '').trim()
    if (!avatarUrl) {
      return `<div class="ig-account-card__icon" aria-hidden="true"><i class="${iconClass}"></i></div>`
    }
    return `<div class="ig-account-card__avatar-wrap">
      <img class="ig-account-card__avatar" src="${esc(avatarUrl)}" alt="" loading="lazy" decoding="async" onerror="this.remove()" />
      <div class="ig-account-card__icon ig-account-card__icon--fallback" aria-hidden="true"><i class="${iconClass}"></i></div>
    </div>`
  }

  function renderChannelAccountCard(account, options) {
    if (options.platform === 'youtube') {
      return renderYoutubeChannelCard(account, options)
    }
    if (options.platform === 'instagram') {
      return renderInstagramAccountCard(account, options)
    }

    const {
      iconClass,
      visitLabel,
      playlistLabel = '작업 영상 보기',
      shareLabel,
      sampleNote,
      platform = 'youtube',
    } = options
    const visitUrl = normalizeVisitUrl(account.accountUrl, platform)
    const playlistUrl = ''
    const playlistBtnLabel = playlistLabel
    const period = formatPeriod(account.startDate, account.endDate, account.ongoing)
    const statusLabel = account.ongoing ? '진행 중' : '계약 종료'
    const statusClass = account.ongoing ? 'is-ongoing' : 'is-completed'
    const highlights = renderHighlightsHtml(account)

    const visitAction = visitUrl
      ? `<a class="ig-account-card__visit-btn" href="${esc(visitUrl)}" target="_blank" rel="noopener noreferrer">
          <i class="${iconClass}" aria-hidden="true"></i>
          <span>${esc(visitLabel)}</span>
          <i class="ti ti-arrow-up-right" aria-hidden="true"></i>
        </a>`
      : ''

    const playlistAction = playlistUrl
      ? `<a class="ig-account-card__playlist-btn" href="${esc(playlistUrl)}" target="_blank" rel="noopener noreferrer">
          <i class="ti ti-list-details" aria-hidden="true"></i>
          <span>${esc(playlistBtnLabel)}</span>
          <i class="ti ti-arrow-up-right" aria-hidden="true"></i>
        </a>`
      : ''

    const hasActions = visitUrl || playlistUrl

    return `<article class="ig-account-card ig-account-card--${platform}">
      <div class="ig-account-card__head">
        <div class="ig-account-card__identity">
          ${renderAccountAvatar(account, iconClass)}
          <div class="ig-account-card__identity-text">
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

      ${hasActions ? `<div class="ig-account-card__actions${playlistUrl ? ' ig-account-card__actions--split' : ''}">
        ${visitAction}
        ${playlistAction}
        ${visitUrl ? `<button type="button" class="ig-account-card__share-btn" data-share-url="${esc(visitUrl)}" data-share-title="${esc(account.name)}" aria-label="${esc(shareLabel)}">
          <i class="ti ti-share-2" aria-hidden="true"></i>
          <span>${esc(shareLabel)}</span>
        </button>` : ''}
      </div>` : ''}
    </article>`
  }

  function renderChannelAccountsSection(intro, accounts, options) {
    if (!accounts.length) return ''
    const {
      sectionTitle = '채널 관리',
      iconClass = 'ti ti-brand-youtube',
      visitLabel = '유튜브 채널 열기',
      playlistLabel = '작업 영상 보기',
      shareLabel = '링크 복사',
      sampleNote = '샘플 데이터 · 실제 채널 URL과 수치로 교체하세요',
      platform = 'youtube',
    } = options
    return `
      <section class="platform-section">
        <h3 class="platform-section__title">${esc(sectionTitle)}</h3>
        ${intro ? `<p class="platform-section__desc">${esc(intro)}</p>` : ''}
        <div class="ig-account-list${platform === 'youtube' || platform === 'instagram' ? ' yt-channel-list' : ''}">
          ${accounts.map((account) => renderChannelAccountCard(account, {
            iconClass, visitLabel, playlistLabel, shareLabel, sampleNote, platform,
          })).join('')}
        </div>
      </section>
    `
  }

  function renderShortsSection(items, buildCard, emptyMessage) {
    const sectionOpen = `<section class="platform-section"><h3 class="platform-section__title">쇼츠 포트폴리오</h3><div class="platform-section__media" data-shorts-list>`
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
      container.innerHTML = '<p class="portfolio-empty">등록된 유튜브 포트폴리오가 없습니다.</p>'
      return
    }

    container.innerHTML = [
      hasChannels ? renderChannelAccountsSection(yt.intro, yt.channels, {
        sectionTitle: '채널 관리',
        iconClass: 'ti ti-brand-youtube',
        visitLabel: '유튜브 채널 열기',
        playlistLabel: '작업 영상 보기',
        shareLabel: '링크 복사',
        sampleNote: '샘플 데이터 · 실제 채널 URL과 수치로 교체하세요',
        platform: 'youtube',
      }) : '',
      hasShorts ? renderShortsSection(yt.shorts, buildYoutubeCard, '등록된 쇼츠 포트폴리오가 없습니다.') : '',
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
    return renderGrowthMetricsGrid(metrics)
  }

  function renderInstagram(container) {
    const ig = PORTFOLIO_DATA.instagram
    const accounts = ig?.accounts || []
    if (!accounts.length) {
      container.innerHTML = '<p class="portfolio-empty">등록된 인스타그램 포트폴리오가 없습니다.</p>'
      return
    }

    container.innerHTML = renderChannelAccountsSection(ig.intro, accounts, {
      sectionTitle: '계정 관리',
      iconClass: 'ti ti-brand-instagram',
      visitLabel: '인스타그램 열기',
      shareLabel: '링크 복사',
      sampleNote: '샘플 데이터 · 실제 계정 URL과 수치로 교체하세요',
      platform: 'instagram',
    })
  }

  function renderRednote(container) {
    const items = PORTFOLIO_DATA.rednote || []
    container.innerHTML = renderRednoteSection(items, '등록된 샤오홍슈 포트폴리오가 없습니다.')
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

  // ── 초기화 ────────────────────────────────────────────
  async function init() {
    const yt = document.getElementById('panel-youtube')
    const ig = document.getElementById('panel-instagram')
    const rn = document.getElementById('panel-rednote')

    await loadWorksConfig()

    if (yt) renderYoutube(yt)
    if (ig) renderInstagram(ig)
    if (rn) renderRednote(rn)
    initMarqueesIn(document.getElementById('panel-youtube'))

    document.querySelectorAll('.portfolio-filter__btn').forEach((btn) => {
      btn.addEventListener('click', () => setPlatform(btn.dataset.platform))
    })

    const worksCard = document.querySelector('.portfolio-card[aria-labelledby="portfolio-works-title"]')
    if (worksCard) bindShareButtons(worksCard)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
