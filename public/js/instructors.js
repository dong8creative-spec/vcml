/**
 * 강사 소개 페이지 — /api/instructors 동적 렌더
 */
;(function () {
  'use strict'

  const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

  const MAX_IMAGE_LEN = 500000

  function isValidImageSrc(src) {
    const v = String(src || '').trim()
    if (!v || v.length > MAX_IMAGE_LEN) return false
    if (/^https?:\/\/.+/i.test(v)) return true
    if (!/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(v)) return false
    const payload = v.split(',')[1] || ''
    return payload.length >= 100 && /^[A-Za-z0-9+/=\s]+$/.test(payload)
  }

  function formatMultiline(text) {
    return esc(text).replace(/\n/g, '<br>')
  }

  function profileInitial(name) {
    const trimmed = String(name || '').trim()
    if (!trimmed) return '?'
    const parts = trimmed.split(/[\s/]+/).filter(Boolean)
    return parts[parts.length - 1]?.charAt(0) || trimmed.charAt(0) || '?'
  }

  function renderProfilePhoto(instructor) {
    const name = instructor?.name || '강사'
    const initial = profileInitial(name)
    if (isValidImageSrc(instructor?.profile_image)) {
      return `<div class="instructor-profile__photo">
        <img src="${esc(instructor.profile_image)}" alt="${esc(name)}" loading="lazy" decoding="async"
          onerror="this.onerror=null;this.parentElement.classList.add('instructor-profile__photo--placeholder');this.parentElement.textContent='${esc(initial)}';this.remove();" />
      </div>`
    }
    return `<div class="instructor-profile__photo instructor-profile__photo--placeholder">${esc(initial)}</div>`
  }

  function renderProfile(instructor) {
    if (!instructor) return ''
    const tags = Array.isArray(instructor.tags) && instructor.tags.length
      ? `<div class="instructor-profile__tags">${instructor.tags.map((t) => `<span>${esc(t)}</span>`).join('')}</div>`
      : ''
    return `<section class="instructor-profile">
      ${renderProfilePhoto(instructor)}
      <div class="instructor-profile__body">
        <h2 class="instructor-profile__name">${esc(instructor.name)}</h2>
        ${instructor.role_title ? `<p class="instructor-profile__role">${esc(instructor.role_title)}</p>` : ''}
        ${tags}
        ${instructor.bio ? `<p class="instructor-profile__bio">${esc(instructor.bio)}</p>` : ''}
        <div class="instructor-profile__actions">
          <a href="/instructor-portfolio.html" class="instructor-profile__cta">포트폴리오 보기</a>
        </div>
      </div>
    </section>`
  }

  function renderGreeting(intro, instructor) {
    const body = intro?.greeting_body || ''
    if (!body && !intro?.greeting_heading) return ''
    const signName = instructor?.name || ''
    const signRole = instructor?.role_title || ''
    return `<section class="instructor-greeting">
      <p class="instructor-section-eyebrow">${esc(intro?.greeting_eyebrow || 'Message')}</p>
      <h2 class="instructor-section-title">${esc(intro?.greeting_heading || '인사말')}</h2>
      ${body ? `<div class="instructor-greeting__body">${formatMultiline(body)}</div>` : ''}
      ${signName ? `<div class="instructor-greeting__sign">
        <div class="instructor-greeting__sign-name">${esc(signName)}</div>
        ${signRole ? `<div class="instructor-greeting__sign-role">${esc(signRole)}</div>` : ''}
      </div>` : ''}
    </section>`
  }

  function renderTimelineScope(scope) {
    const label = String(scope || '').trim()
    if (!label) return ''
    return `<span class="instructor-timeline__scope">${esc(label)}</span>`
  }

  function renderTimelineItem(item, index, prevYear) {
    const year = String(item?.year || '').trim()
    const showYear = year && year !== prevYear
    const yearCell = showYear
      ? `<div class="instructor-timeline__year">${esc(year)}</div>`
      : `<div class="instructor-timeline__year instructor-timeline__year--repeat" aria-hidden="true"></div>`
    const achievements = Array.isArray(item?.achievements) && item.achievements.length
      ? `<ul class="instructor-timeline__achievements">${item.achievements.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>`
      : ''
    const currentClass = index === 0 ? ' is-current' : ''
    return `<li class="instructor-timeline__item${currentClass}">
      ${yearCell}
      <div class="instructor-timeline__track" aria-hidden="true"><span class="instructor-timeline__dot"></span></div>
      <article class="instructor-timeline__card">
        ${showYear ? `<time class="instructor-timeline__year-mobile">${esc(year)}</time>` : ''}
        <div class="instructor-timeline__card-head">
          ${item?.title ? `<h3 class="instructor-timeline__title">${esc(item.title)}</h3>` : ''}
          ${renderTimelineScope(item?.scope)}
        </div>
        ${item?.description ? `<p class="instructor-timeline__desc">${esc(item.description)}</p>` : ''}
        ${achievements}
      </article>
    </li>`
  }

  function renderHistory(intro) {
    const timeline = Array.isArray(intro?.timeline) ? intro.timeline : []
    if (!timeline.length) return ''
    let prevYear = ''
    const items = timeline.map((item, index) => {
      const year = String(item?.year || '').trim()
      const html = renderTimelineItem(item, index, prevYear)
      if (year) prevYear = year
      return html
    }).join('')
    return `<section class="instructor-history">
      <div class="instructor-history__head">
        <p class="instructor-section-eyebrow">History</p>
        <h2 class="instructor-section-title instructor-section-title--flush">${esc(intro?.timeline_heading || '주요 경력')}</h2>
      </div>
      <ol class="instructor-timeline">${items}</ol>
      <div class="instructor-history__footer">
        <a href="/instructor-portfolio.html" class="instructor-history__portfolio-link">
          <i class="ti ti-briefcase" aria-hidden="true"></i>
          <span>포트폴리오에서 상세 사례 보기</span>
          <i class="ti ti-arrow-up-right" aria-hidden="true"></i>
        </a>
      </div>
    </section>`
  }

  function applyHero(intro) {
    const title = document.querySelector('.instructor-hero-title')
    const subtitle = document.querySelector('.instructor-hero-subtitle')
    const lead = document.querySelector('.instructor-hero-lead')
    if (title && intro?.section_title) title.textContent = intro.section_title
    if (subtitle && intro?.section_subtitle) subtitle.textContent = intro.section_subtitle
    if (lead && intro?.page_intro) lead.textContent = intro.page_intro
    if (intro?.section_title) document.title = `${intro.section_title} — 타닥클래스`
  }

  async function init() {
    const main = document.getElementById('instructor-main')
    if (!main) return
    try {
      const data = await API.get('/instructors')
      const intro = data?.intro || {}
      const instructors = Array.isArray(data?.instructors) ? data.instructors : []
      const primary = instructors[0] || null
      applyHero(intro)
      main.innerHTML = [
        renderProfile(primary),
        renderGreeting(intro, primary),
        renderHistory(intro),
      ].join('')
    } catch (e) {
      console.error(e)
      main.innerHTML = '<p class="instructor-loading instructor-loading--error">강사 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p>'
    }
  }

  init()
})()
