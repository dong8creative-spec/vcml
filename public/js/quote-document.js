/**
 * 업체 발행용 견적서 양식 — 로컬 편집 · 인쇄/PDF · 초안 저장
 */
;(function () {
  const STORAGE_KEY = 'vcml-business-quote-draft'

  const ISSUER_DEFAULT = {
    company: '블루필드매뉴얼픽쳐스',
    brand: '타닥클래스',
    representative: '이동헌',
    bizNo: '640-50-00860',
    address: '부산광역시 부산진구 가야대로 707-2(당감동)',
    phone: '010-4850-6946',
    email: 'dong8creative@gmail.com',
  }

  const DEFAULT_ROWS = [
    { item: '영상 기획 · 콘티', spec: '콘셉트 · 타깃 · 촬영/편집 방향 설계', qty: 1, unit: '식', price: 120000 },
    { item: '영상 편집', spec: '컷 편집 · BGM · 자막 (분량 협의)', qty: 1, unit: '건', price: 350000 },
    { item: '수정·피드백 반영', spec: '기본 2회 포함', qty: 1, unit: '식', price: 0 },
  ]

  const DEFAULT_NOTES = [
    '· 본 견적은 부가가치세 별도 금액입니다.',
    '· 작업 범위·분량·일정 확정 후 최종 견적이 조정될 수 있습니다.',
    '· 원본 소스 미제공 시 추가 비용이 발생할 수 있습니다.',
  ].join('\n')

  const els = {}

  function $(id) {
    return document.getElementById(id)
  }

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function parseNum(v) {
    const n = Number(String(v || '').replace(/,/g, '').trim())
    return Number.isFinite(n) ? n : 0
  }

  function formatWon(n) {
    const rounded = Math.round(Number(n) || 0)
    if (rounded === 0) return '0'
    if (rounded < 0) return `-${Math.abs(rounded).toLocaleString('ko-KR')}`
    return rounded.toLocaleString('ko-KR')
  }

  function formatSignedWon(n, { prefix = false } = {}) {
    const text = formatWon(n)
    if (!prefix) return text
    const rounded = Math.round(Number(n) || 0)
    if (rounded === 0) return '₩0'
    if (rounded < 0) return `-₩${formatWon(Math.abs(rounded))}`
    return `₩${text}`
  }

  function todayStr() {
    const d = new Date()
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  function validUntilStr(days = 14) {
    const d = new Date()
    d.setDate(d.getDate() + days)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  function makeQuoteNo() {
    const d = new Date()
    const stamp = [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0'),
    ].join('')
    const suffix = String(Math.floor(Math.random() * 900) + 100)
    return `Q-${stamp}-${suffix}`
  }

  function rowHtml(row = {}, index = 0) {
    const qty = row.qty ?? 1
    const price = row.price ?? 0
    const amount = parseNum(qty) * parseNum(price)
    const negClass = amount < 0 ? ' is-negative' : ''
    const priceVal = price !== 0 && price !== '' ? formatWon(price) : ''
    return `<tr data-quote-row class="${negClass.trim()}">
      <td class="col-no">${index + 1}</td>
      <td class="col-item"><input type="text" data-field="item" value="${esc(row.item || '')}" placeholder="품목 · 작업 내용" /></td>
      <td class="col-item"><input type="text" data-field="spec" value="${esc(row.spec || '')}" placeholder="규격 · 상세 (할인·차감 시 -금액)" /></td>
      <td class="col-qty qty-cell"><input type="text" data-field="qty" inputmode="decimal" value="${qty !== '' && qty != null ? qty : ''}" placeholder="1" /></td>
      <td class="col-unit"><input type="text" data-field="unit" value="${esc(row.unit || '식')}" /></td>
      <td class="col-price price-cell"><input type="text" data-field="price" inputmode="numeric" value="${esc(priceVal)}" placeholder="0 또는 -0" /></td>
      <td class="col-amount amount-cell${amount < 0 ? ' is-negative' : ''}" data-amount>${formatWon(amount)}</td>
      <td class="col-action no-print"><button type="button" class="quote-doc-row-remove" data-remove-row title="행 삭제" aria-label="행 삭제">×</button></td>
    </tr>`
  }

  function readRows() {
    return [...document.querySelectorAll('[data-quote-row]')].map((tr) => {
      const get = (name) => tr.querySelector(`[data-field="${name}"]`)?.value?.trim() || ''
      return {
        item: get('item'),
        spec: get('spec'),
        qty: get('qty'),
        unit: get('unit'),
        price: get('price'),
      }
    })
  }

  function renumberRows() {
    document.querySelectorAll('[data-quote-row]').forEach((tr, i) => {
      const no = tr.querySelector('.col-no')
      if (no) no.textContent = String(i + 1)
    })
  }

  function setTotalCell(el, amount) {
    if (!el) return
    el.textContent = formatSignedWon(amount, { prefix: true })
    el.classList.toggle('is-negative', amount < 0)
  }

  function recalc() {
    let supply = 0
    document.querySelectorAll('[data-quote-row]').forEach((tr) => {
      const qty = parseNum(tr.querySelector('[data-field="qty"]')?.value)
      const price = parseNum(tr.querySelector('[data-field="price"]')?.value)
      const amount = qty * price
      supply += amount
      tr.classList.toggle('is-negative', amount < 0)
      const cell = tr.querySelector('[data-amount]')
      if (cell) {
        cell.textContent = formatWon(amount)
        cell.classList.toggle('is-negative', amount < 0)
      }
    })

    const includeVat = els.vatToggle?.checked !== false
    const vat = includeVat ? Math.round(supply * 0.1) : 0
    const total = supply + vat

    setTotalCell(els.supplyTotal, supply)
    if (els.vatTotal) {
      els.vatTotal.textContent = includeVat ? formatSignedWon(vat, { prefix: true }) : '—'
      els.vatTotal.classList.toggle('is-negative', includeVat && vat < 0)
    }
    setTotalCell(els.grandTotal, total)

    const vatRow = $('qd-vat-row')
    if (vatRow) vatRow.hidden = !includeVat
  }

  function formatPriceInputs() {
    document.querySelectorAll('[data-field="price"]').forEach((input) => {
      const n = parseNum(input.value)
      if (n !== 0) input.value = formatWon(n)
      else if (!String(input.value || '').trim()) input.value = ''
    })
    document.querySelectorAll('[data-field="qty"]').forEach((input) => {
      const raw = String(input.value || '').trim()
      if (!raw) return
      const n = parseNum(raw)
      input.value = String(n)
    })
    recalc()
  }

  function addRow(row = {}) {
    const tbody = els.tbody
    if (!tbody) return
    const index = tbody.querySelectorAll('[data-quote-row]').length
    tbody.insertAdjacentHTML('beforeend', rowHtml(row, index))
    renumberRows()
    recalc()
  }

  function collectForm() {
    return {
      quoteNo: els.quoteNo?.value?.trim() || '',
      quoteDate: els.quoteDate?.value || '',
      validUntil: els.validUntil?.value || '',
      project: els.project?.value?.trim() || '',
      clientCompany: els.clientCompany?.value?.trim() || '',
      clientName: els.clientName?.value?.trim() || '',
      clientEmail: els.clientEmail?.value?.trim() || '',
      clientPhone: els.clientPhone?.value?.trim() || '',
      issuerCompany: els.issuerCompany?.value?.trim() || '',
      issuerBrand: els.issuerBrand?.value?.trim() || '',
      issuerRep: els.issuerRep?.value?.trim() || '',
      issuerBizNo: els.issuerBizNo?.value?.trim() || '',
      issuerAddress: els.issuerAddress?.value?.trim() || '',
      issuerPhone: els.issuerPhone?.value?.trim() || '',
      issuerEmail: els.issuerEmail?.value?.trim() || '',
      paymentTerms: els.paymentTerms?.value?.trim() || '',
      deliveryDate: els.deliveryDate?.value?.trim() || '',
      notes: els.notes?.value?.trim() || '',
      includeVat: els.vatToggle?.checked !== false,
      rows: readRows(),
    }
  }

  function applyForm(data = {}) {
    const set = (el, val) => { if (el) el.value = val ?? '' }

    set(els.quoteNo, data.quoteNo || makeQuoteNo())
    set(els.quoteDate, data.quoteDate || todayStr())
    set(els.validUntil, data.validUntil || validUntilStr())
    set(els.project, data.project || '')
    set(els.clientCompany, data.clientCompany || '')
    set(els.clientName, data.clientName || '')
    set(els.clientEmail, data.clientEmail || '')
    set(els.clientPhone, data.clientPhone || '')
    set(els.issuerCompany, data.issuerCompany || ISSUER_DEFAULT.company)
    set(els.issuerBrand, data.issuerBrand || ISSUER_DEFAULT.brand)
    set(els.issuerRep, data.issuerRep || ISSUER_DEFAULT.representative)
    set(els.issuerBizNo, data.issuerBizNo || ISSUER_DEFAULT.bizNo)
    set(els.issuerAddress, data.issuerAddress || ISSUER_DEFAULT.address)
    set(els.issuerPhone, data.issuerPhone || ISSUER_DEFAULT.phone)
    set(els.issuerEmail, data.issuerEmail || ISSUER_DEFAULT.email)
    set(els.paymentTerms, data.paymentTerms || '작업 착수 전 50% 선금, 잔금 납품 시')
    set(els.deliveryDate, data.deliveryDate || '착수 후 협의 (영업일 기준)')
    set(els.notes, data.notes || DEFAULT_NOTES)
    if (els.vatToggle) els.vatToggle.checked = data.includeVat !== false

    if (els.tbody) {
      const rows = Array.isArray(data.rows) && data.rows.length ? data.rows : DEFAULT_ROWS
      els.tbody.innerHTML = rows.map((row, i) => rowHtml(row, i)).join('')
    }

    formatPriceInputs()
  }

  function saveDraft() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(collectForm()))
      flashStatus('초안이 이 브라우저에 저장되었습니다.')
    } catch {
      flashStatus('저장에 실패했습니다.', true)
    }
  }

  function loadDraft() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) {
        flashStatus('저장된 초안이 없습니다.', true)
        return
      }
      applyForm(JSON.parse(raw))
      flashStatus('저장된 초안을 불러왔습니다.')
    } catch {
      flashStatus('불러오기에 실패했습니다.', true)
    }
  }

  function newQuote() {
    if (!confirm('현재 내용을 지우고 새 견적서를 만드시겠습니까?')) return
    applyForm({ rows: DEFAULT_ROWS })
    flashStatus('새 견적서가 준비되었습니다.')
  }

  function flashStatus(msg, isError = false) {
    if (!els.status) return
    els.status.textContent = msg
    els.status.style.color = isError ? '#faa' : '#8a8'
    clearTimeout(flashStatus._t)
    flashStatus._t = setTimeout(() => { els.status.textContent = '' }, 2800)
  }

  function bindEvents() {
    document.getElementById('qd-print-btn')?.addEventListener('click', () => window.print())
    document.getElementById('qd-save-btn')?.addEventListener('click', saveDraft)
    document.getElementById('qd-load-btn')?.addEventListener('click', loadDraft)
    document.getElementById('qd-new-btn')?.addEventListener('click', newQuote)
    document.getElementById('qd-add-row')?.addEventListener('click', () => addRow())

    els.tbody?.addEventListener('input', (e) => {
      const field = e.target?.dataset?.field
      if (field === 'price' || field === 'qty') recalc()
    })

    els.tbody?.addEventListener('blur', (e) => {
      const field = e.target?.dataset?.field
      if (field === 'price') {
        const n = parseNum(e.target.value)
        e.target.value = n !== 0 ? formatWon(n) : ''
        recalc()
      }
      if (field === 'qty') {
        const raw = String(e.target.value || '').trim()
        if (!raw) return
        e.target.value = String(parseNum(raw))
        recalc()
      }
    }, true)

    els.tbody?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove-row]')
      if (!btn) return
      const rows = els.tbody.querySelectorAll('[data-quote-row]')
      if (rows.length <= 1) {
        flashStatus('최소 1개 항목은 필요합니다.', true)
        return
      }
      btn.closest('[data-quote-row]')?.remove()
      renumberRows()
      recalc()
    })

    els.vatToggle?.addEventListener('change', recalc)

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') return
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        saveDraft()
      }
    })
  }

  function init() {
    els.quoteNo = $('qd-quote-no')
    els.quoteDate = $('qd-quote-date')
    els.validUntil = $('qd-valid-until')
    els.project = $('qd-project')
    els.clientCompany = $('qd-client-company')
    els.clientName = $('qd-client-name')
    els.clientEmail = $('qd-client-email')
    els.clientPhone = $('qd-client-phone')
    els.issuerCompany = $('qd-issuer-company')
    els.issuerBrand = $('qd-issuer-brand')
    els.issuerRep = $('qd-issuer-rep')
    els.issuerBizNo = $('qd-issuer-bizno')
    els.issuerAddress = $('qd-issuer-address')
    els.issuerPhone = $('qd-issuer-phone')
    els.issuerEmail = $('qd-issuer-email')
    els.paymentTerms = $('qd-payment-terms')
    els.deliveryDate = $('qd-delivery-date')
    els.notes = $('qd-notes')
    els.tbody = $('qd-items-body')
    els.supplyTotal = $('qd-supply-total')
    els.vatTotal = $('qd-vat-total')
    els.grandTotal = $('qd-grand-total')
    els.vatToggle = $('qd-vat-toggle')
    els.status = $('qd-status')

    applyForm()
    bindEvents()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
