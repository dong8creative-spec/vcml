/** 공용 DOM/문자열 유틸 */
;(function (global) {
  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  function escAttr(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  }

  function formatDate(iso) {
    if (!iso) return ''
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10)
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
  }

  function formatWon(n) {
    return '₩' + Number(n || 0).toLocaleString()
  }

  function fmtD(iso) {
    return iso ? String(iso).slice(0, 10) : '-'
  }

  global.DomUtils = { esc, escAttr, formatDate, formatWon, fmtD }
  global.esc = global.esc || esc
  global.escAttr = global.escAttr || escAttr
  global.formatDate = global.formatDate || formatDate
  global.formatWon = global.formatWon || formatWon
  global.fmtD = global.fmtD || fmtD
})(window)
