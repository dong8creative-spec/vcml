/** 홈/무료 페이지 강의 카드 렌더 */
;(function (global) {
  function courseCard(c) {
    const UI = global.CourseEnrollmentUI
    const isLive = c.course_type === 'live'
    const isFree = isLive || c.sale_price === 0
    const rating = parseFloat(c.rating) || 0
    const reviewCount = Number(c.review_count) || 0
    const stars = reviewCount > 0
      ? '★'.repeat(Math.round(rating)) + '☆'.repeat(5 - Math.round(rating))
      : ''
    const liveStatusMap = { upcoming: '신청 가능', live: '진행 중', ended: '종료' }
    const uiCourse = isLive && UI?.isLiveEnded?.(c)
      ? { ...c, live_status: 'ended' }
      : c
    const thumbImg = c.thumbnail_url || c.thumbnail_image
    const thumbInner = thumbImg
      ? `<img src="${String(thumbImg).replace(/"/g, '&quot;')}" alt="" loading="lazy" decoding="async" />`
      : `<i class="ti ${c.thumbnail_icon || 'ti-video'}"></i>`
    const meetBadge = typeof global.googleMeetBadgeHtml === 'function'
      ? global.googleMeetBadgeHtml('badge-live')
      : '<span class="badge-live">LIVE</span>'
    return `
  <a href="/courses/${c.slug}" class="ccard${UI?.catalogCardPanelClass?.(uiCourse) || ''}">
    ${UI?.catalogCardPanelOpen?.(uiCourse) || ''}
    <div class="ccard-thumb ${c.thumb_style === 'dark' ? 'td' : 'tl'}">
      ${isLive ? meetBadge : (c.badge ? `<span class="badge-${String(c.badge).toLowerCase()}">${c.badge}</span>` : '')}
      ${thumbInner}
    </div>
    <div class="ccard-body">
      ${UI?.catRowHtml?.(uiCourse, 'ccard-cat') || ''}
      <div class="ccard-title">${c.title}</div>
      ${isLive
        ? `<div class="ccard-schedule"><i class="ti ti-calendar"></i> ${c.live_schedule || '일정 공지 예정'}</div>`
        : (reviewCount > 0
            ? `<div class="ccard-rating"><span class="ccard-stars">${stars}</span><span class="ccard-rnum">${rating} (${reviewCount.toLocaleString()})</span></div>`
            : `<div class="ccard-rating"><span class="ccard-rnum" style="color:#aaa;font-size:13px">후기 없음</span></div>`)}
      <div class="ccard-price-row">
        ${isLive || (c.enrollment_has_limit && c.enrollment_full)
          ? (UI?.cardEnrollBtnHtml?.(uiCourse, liveStatusMap) || '')
          : (isFree
              ? `<span class="price-free">무료</span>`
              : `${c.price !== c.sale_price ? `<span class="price-ori">₩${Number(c.price).toLocaleString()}</span>` : ''}
                 <span class="price-sale">₩${Number(c.sale_price).toLocaleString()}</span>
                 ${c.price !== c.sale_price ? `<span class="disc-badge">${Math.round((1 - c.sale_price / c.price) * 100)}%</span>` : ''}`)}
      </div>
    </div>
    ${UI?.catalogCardPanelClose?.(uiCourse) || ''}
  </a>`
  }

  function freeCourseCard(c) {
    const UI = global.CourseEnrollmentUI
    const isLive = c.course_type === 'live'
    const rating = parseFloat(c.rating) || 0
    const reviewCount = Number(c.review_count) || 0
    const stars = reviewCount > 0
      ? '★'.repeat(Math.round(rating)) + '☆'.repeat(5 - Math.round(rating))
      : ''
    const liveStatusMap = { upcoming: '신청 가능', live: '진행 중', ended: '종료' }
    const uiCourse = isLive && UI?.isLiveEnded?.(c)
      ? { ...c, live_status: 'ended' }
      : c
    const thumbImg = c.thumbnail_url || c.thumbnail_image
    const thumbInner = thumbImg
      ? `<img src="${String(thumbImg).replace(/"/g, '&quot;')}" alt="" loading="lazy" decoding="async" />`
      : `<i class="ti ${c.thumbnail_icon || 'ti-video'}"></i>`
    const meetBadge = typeof global.googleMeetBadgeHtml === 'function'
      ? global.googleMeetBadgeHtml('badge-live')
      : '<span class="badge-live">LIVE</span>'
    return `
  <a href="/courses/${c.slug}" class="fcard${UI?.catalogCardPanelClass?.(uiCourse) || ''}">
    ${UI?.catalogCardPanelOpen?.(uiCourse) || ''}
    <div class="fcard-thumb ${c.thumb_style === 'dark' ? 'td' : 'tl'}">
      ${isLive ? meetBadge : (c.badge ? `<span class="badge-${String(c.badge).toLowerCase()}">${c.badge}</span>` : '')}
      ${thumbInner}
    </div>
    <div class="fcard-body">
      ${UI?.catRowHtml?.(uiCourse, 'fcard-cat') || ''}
      <div class="fcard-title">${c.title}</div>
      ${isLive
        ? `<div class="fcard-schedule"><i class="ti ti-calendar"></i> ${c.live_schedule || '일정 공지 예정'}</div>`
        : (reviewCount > 0
            ? `<div class="fcard-rating"><span class="fcard-stars">${stars}</span><span class="fcard-rnum">${rating} (${reviewCount.toLocaleString()})</span></div>`
            : `<div class="fcard-rating"><span class="fcard-rnum fcard-rnum--muted">후기 없음</span></div>`)}
      <div class="fcard-foot fcard-foot--btn">
        ${UI?.cardEnrollBtnHtml?.(uiCourse, liveStatusMap) || ''}
      </div>
    </div>
    ${UI?.catalogCardPanelClose?.(uiCourse) || ''}
  </a>`
  }

  function renderCourseGrid332(courses, orderCoursesFn) {
    const orderCourses = orderCoursesFn || global.orderCourses || ((list) => list)
    const ordered = orderCourses(courses)
    if (!ordered.length) {
      return '<p class="empty">해당 카테고리 강의가 없습니다.</p>'
    }
    const rows = []
    for (let i = 0; i < ordered.length; i += 3) {
      rows.push(ordered.slice(i, i + 3))
    }
    return rows.map((row, i) => {
      const isLast = i === rows.length - 1 && row.length === 2
      return `<div class="course-grid-row${isLast ? ' course-grid-row-last' : ''}">${row.map(courseCard).join('')}</div>`
    }).join('')
  }

  global.CatalogCards = { courseCard, freeCourseCard, renderCourseGrid332 }
  global.courseCard = courseCard
  global.freeCourseCard = freeCourseCard
  global.renderCourseGrid332 = global.renderCourseGrid332 || function (courses) {
    return renderCourseGrid332(courses, global.orderCourses)
  }
})(window)
