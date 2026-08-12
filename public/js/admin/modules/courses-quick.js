/** 강의 빠른 등록 — 단일 폼으로 공개·상세·스마트스토어·일정·정원·이미지 설정 */
;(function (global) {
  const OVERLAY_ID = 'quick-course-overlay'
  const MAX_DETAIL_IMAGES = 30

  /** @type {{ file?: File, preview: string, url?: string } | null} */
  let thumbState = null
  /** @type {{ file?: File, preview: string, url?: string }[]} */
  let detailImages = []

  function $(id) {
    return document.getElementById(id)
  }

  function setVisible(id, show) {
    const el = $(id)
    if (el) el.style.display = show ? '' : 'none'
  }

  function syncKindFields() {
    const kind = $('qc-kind')?.value || 'live'
    const isLive = kind === 'live'
    setVisible('qc-live-fields', isLive)
    const starts = $('qc-live-starts')
    if (starts) starts.required = isLive
  }

  function syncPaidFields() {
    const sale = parseInt($('qc-sale-price')?.value, 10)
    const price = parseInt($('qc-price')?.value, 10) || 0
    const paid = Number.isFinite(sale) ? sale > 0 : price > 0
    setVisible('qc-paid-fields', paid)
    const store = $('qc-store-url')
    if (store) store.required = paid && !!$('qc-publish')?.checked
  }

  function renderThumbPreview() {
    const box = $('qc-thumb-preview')
    const clearBtn = $('qc-thumb-clear')
    if (!box) return
    const src = thumbState?.preview || $('qc-thumb-url')?.value.trim() || ''
    if (src) {
      box.textContent = ''
      box.style.backgroundImage = `url("${src.replace(/"/g, '%22')}")`
      box.classList.add('has-image')
    } else {
      box.textContent = '미리보기'
      box.style.backgroundImage = ''
      box.classList.remove('has-image')
    }
    if (clearBtn) clearBtn.style.display = src ? '' : 'none'
  }

  function renderDetailImages() {
    const list = $('qc-detail-images')
    if (!list) return
    if (!detailImages.length) {
      list.innerHTML = '<p class="qc-detail-empty">아직 추가된 이미지가 없습니다.</p>'
      return
    }
    list.innerHTML = detailImages.map((item, i) => `
      <div class="qc-detail-row" data-idx="${i}">
        <div class="qc-detail-preview" style="background-image:url('${String(item.preview).replace(/'/g, '%27')}')"></div>
        <div class="qc-detail-meta">
          <span>${item.file ? item.file.name : '이미지'}</span>
          <button type="button" class="btn-sm qc-detail-remove" data-idx="${i}">삭제</button>
        </div>
      </div>
    `).join('')
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => reject(new Error('파일을 읽을 수 없습니다.'))
      reader.readAsDataURL(file)
    })
  }

  function dataUrlToBlob(dataUrl) {
    const parts = String(dataUrl || '').split(',')
    const header = parts[0] || ''
    const data = parts[1] || ''
    const mime = (header.match(/data:([^;]+)/) || [])[1] || 'image/jpeg'
    const bin = atob(data)
    const arr = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
    return new Blob([arr], { type: mime })
  }

  async function uploadBlob(blob, kind, courseId) {
    const ext = blob.type === 'image/webp' ? 'webp' : blob.type === 'image/png' ? 'png' : 'jpg'
    const file = blob instanceof File ? blob : new File([blob], `upload.${ext}`, { type: blob.type || 'image/jpeg' })
    const data = await API.upload('/admin/uploads', file, { kind, course_id: courseId || 'draft' })
    return data.url
  }

  async function prepareThumbnailUrl(courseId) {
    if (thumbState?.file) {
      const dataUrl = await AdminImages.resizeUploadImage(thumbState.file, {
        maxWidth: 1200,
        maxHeight: 1200,
        maxBase64Len: 450000,
      })
      try {
        return await uploadBlob(dataUrlToBlob(dataUrl), 'thumbnail', courseId)
      } catch (err) {
        console.warn('썸네일 Storage 업로드 실패, data URL 사용:', err?.message || err)
        return dataUrl
      }
    }
    const url = $('qc-thumb-url')?.value.trim() || ''
    return url || null
  }

  async function prepareDetailImageUrls(courseId) {
    const urls = []
    for (const item of detailImages) {
      if (item.url) {
        urls.push(item.url)
        continue
      }
      if (!item.file) continue
      const dataUrl = await AdminImages.resizeCanvasImageToWebpFromSource(item.file, {
        maxWidth: 1000,
        maxHeight: 5000,
        maxBase64Len: 950000,
      })
      try {
        urls.push(await uploadBlob(dataUrlToBlob(dataUrl), 'detail-intro', courseId))
      } catch (err) {
        console.warn('상세 이미지 Storage 업로드 실패, data URL 사용:', err?.message || err)
        urls.push(dataUrl)
      }
    }
    return urls
  }

  function resetForm() {
    ;['qc-title', 'qc-desc', 'qc-detail', 'qc-price', 'qc-sale-price',
      'qc-store-url', 'qc-enrollment-limit', 'qc-live-starts', 'qc-live-ends',
      'qc-live-schedule', 'qc-checkout-starts', 'qc-checkout-ends', 'qc-thumb-url'].forEach((id) => {
      const el = $(id)
      if (el) el.value = ''
    })
    if ($('qc-thumb-file')) $('qc-thumb-file').value = ''
    if ($('qc-kind')) $('qc-kind').value = 'live'
    if ($('qc-category')) $('qc-category').value = '캡컷 PRO'
    if ($('qc-publish')) $('qc-publish').checked = true
    thumbState = null
    detailImages = []
    renderThumbPreview()
    renderDetailImages()
    syncKindFields()
    syncPaidFields()
  }

  function openQuickCourseModal(preset) {
    resetForm()
    if (preset === 'vod' && $('qc-kind')) $('qc-kind').value = 'vod'
    syncKindFields()
    const overlay = $(OVERLAY_ID)
    if (overlay) overlay.style.display = 'flex'
    $('qc-title')?.focus()
  }

  function closeQuickCourseModal() {
    const overlay = $(OVERLAY_ID)
    if (overlay) overlay.style.display = 'none'
  }

  function toIsoFromLocal(value) {
    if (!value) return null
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return null
    return d.toISOString()
  }

  async function submitQuickCourseForm() {
    const kind = $('qc-kind')?.value || 'live'
    const isLive = kind === 'live'
    const title = $('qc-title')?.value.trim() || ''
    const category = $('qc-category')?.value.trim() || ''
    const description = $('qc-desc')?.value.trim() || ''
    const detail_intro_text = $('qc-detail')?.value.trim() || ''
    const price = parseInt($('qc-price')?.value, 10) || 0
    const saleRaw = parseInt($('qc-sale-price')?.value, 10)
    const sale = Number.isFinite(saleRaw) ? saleRaw : price
    const is_published = $('qc-publish')?.checked ? 1 : 0
    const enrollment_limit = parseInt($('qc-enrollment-limit')?.value, 10) || 0
    const storeUrl = $('qc-store-url')?.value.trim() || ''
    const liveStartsVal = $('qc-live-starts')?.value || ''
    const liveEndsVal = $('qc-live-ends')?.value || ''
    const liveScheduleText = $('qc-live-schedule')?.value.trim() || ''

    if (!title) { alert('강의 제목을 입력해 주세요.'); return }
    if (!category) { alert('카테고리를 입력해 주세요.'); return }
    if (isLive && !liveStartsVal) { alert('강의 시작 일시를 입력해 주세요.'); return }
    if (sale > 0 && is_published && !storeUrl) {
      alert('유료 강의를 바로 공개하려면 스마트스토어 결제 링크가 필요합니다.')
      return
    }

    const payload = {
      title,
      category,
      description,
      detail_intro_text,
      price,
      sale_price: sale,
      is_published,
      enrollment_limit,
      checkout_provider: sale > 0 ? 'smartstore' : 'site',
      delivery_mode: isLive ? 'live_first' : 'vod_only',
      course_type: isLive ? (sale === 0 ? 'live' : 'recorded') : 'recorded',
      checkout_starts_at: toIsoFromLocal($('qc-checkout-starts')?.value),
      checkout_ends_at: toIsoFromLocal($('qc-checkout-ends')?.value),
    }

    if (storeUrl) payload.store_checkout_url = storeUrl

    if (isLive) {
      payload.live_starts_at = toIsoFromLocal(liveStartsVal)
      payload.live_ends_at = toIsoFromLocal(liveEndsVal)
      payload.live_schedule = liveScheduleText
        || new Date(liveStartsVal).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
    }

    const btn = $('qc-submit-btn')
    if (btn) {
      btn.disabled = true
      btn.textContent = '등록 중…'
    }

    try {
      if (btn) btn.textContent = '이미지 준비 중…'
      // 먼저 draft로 업로드해 URL을 만든 뒤 생성 시 함께 저장
      const [thumbnail_url, detail_intro_images] = await Promise.all([
        prepareThumbnailUrl('draft'),
        prepareDetailImageUrls('draft'),
      ])
      if (thumbnail_url) payload.thumbnail_url = thumbnail_url
      if (detail_intro_images.length) payload.detail_intro_images = detail_intro_images

      if (btn) btn.textContent = '등록 중…'
      const res = await API.post('/admin/courses', payload)
      const course = res.course || {}
      const slug = course.slug ? `/courses/${course.slug}` : ''
      alert(
        is_published
          ? `강의가 등록되어 바로 공개되었습니다.${slug ? `\n상세: ${slug}` : ''}`
          : '강의가 등록되었습니다. (비공개 — 목록에서 공개 전환 가능)'
      )
      closeQuickCourseModal()
      if (typeof global.loadCourses === 'function') await global.loadCourses()
      if (course.id && isLive && typeof global.openLivePanel === 'function') {
        global.openLivePanel(course.id)
      } else if (course.id && !isLive) {
        localStorage.setItem('admin_curriculum_course', course.id)
        if (global.AdminRouter?.showSection) global.AdminRouter.showSection('curriculum')
      }
    } catch (e) {
      alert(e.message || '등록 중 오류가 발생했습니다.')
    } finally {
      if (btn) {
        btn.disabled = false
        btn.textContent = '등록하고 공개하기'
      }
    }
  }

  function bindQuickCourseForm() {
    $('qc-kind')?.addEventListener('change', syncKindFields)
    $('qc-price')?.addEventListener('input', syncPaidFields)
    $('qc-sale-price')?.addEventListener('input', syncPaidFields)
    $('qc-publish')?.addEventListener('change', syncPaidFields)
    $('qc-submit-btn')?.addEventListener('click', () => { submitQuickCourseForm().catch(() => {}) })
    $(OVERLAY_ID)?.addEventListener('click', (e) => {
      if (e.target.id === OVERLAY_ID) closeQuickCourseModal()
    })

    $('qc-thumb-file')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file) return
      if (!/^image\/(jpeg|jpg|png|webp)$/i.test(file.type)) {
        alert('JPEG, PNG, WebP만 사용할 수 있습니다.')
        return
      }
      try {
        const preview = await readFileAsDataUrl(file)
        thumbState = { file, preview }
        if ($('qc-thumb-url')) $('qc-thumb-url').value = ''
        renderThumbPreview()
      } catch (err) {
        alert(err.message || '썸네일을 불러오지 못했습니다.')
      }
    })

    $('qc-thumb-url')?.addEventListener('input', () => {
      const url = $('qc-thumb-url').value.trim()
      if (url) thumbState = { preview: url, url }
      else if (!thumbState?.file) thumbState = null
      renderThumbPreview()
    })

    $('qc-thumb-clear')?.addEventListener('click', () => {
      thumbState = null
      if ($('qc-thumb-url')) $('qc-thumb-url').value = ''
      if ($('qc-thumb-file')) $('qc-thumb-file').value = ''
      renderThumbPreview()
    })

    $('qc-detail-add')?.addEventListener('click', () => {
      if (detailImages.length >= MAX_DETAIL_IMAGES) {
        alert(`상세 이미지는 최대 ${MAX_DETAIL_IMAGES}장까지 등록할 수 있습니다.`)
        return
      }
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/jpeg,image/png,image/webp'
      input.multiple = true
      input.onchange = async () => {
        const files = [...(input.files || [])]
        for (const file of files) {
          if (detailImages.length >= MAX_DETAIL_IMAGES) break
          if (!/^image\/(jpeg|jpg|png|webp)$/i.test(file.type)) {
            alert(`${file.name}: JPEG, PNG, WebP만 사용할 수 있습니다.`)
            continue
          }
          try {
            const preview = await readFileAsDataUrl(file)
            detailImages.push({ file, preview })
          } catch (err) {
            alert(err.message || `${file.name}을(를) 불러오지 못했습니다.`)
          }
        }
        renderDetailImages()
      }
      input.click()
    })

    $('qc-detail-images')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.qc-detail-remove')
      if (!btn) return
      const idx = parseInt(btn.dataset.idx, 10)
      if (Number.isNaN(idx)) return
      detailImages.splice(idx, 1)
      renderDetailImages()
    })

    renderThumbPreview()
    renderDetailImages()
  }

  global.openQuickCourseModal = openQuickCourseModal
  global.closeQuickCourseModal = closeQuickCourseModal
  global.openCourseCreateModal = () => openQuickCourseModal('live')
  global.openVodCreateModal = () => openQuickCourseModal('vod')
  global.closeCourseCreateModal = closeQuickCourseModal
  global.closeVodCreateModal = closeQuickCourseModal
  global.createQuickCourseFromForm = submitQuickCourseForm

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindQuickCourseForm)
  } else {
    bindQuickCourseForm()
  }
})(window)
