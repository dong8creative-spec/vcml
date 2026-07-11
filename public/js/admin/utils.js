/** Admin 공용 유틸 */
;(function (global) {
  const Dom = global.DomUtils || {}
  function esc(s) {
    return Dom.esc ? Dom.esc(s) : String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }
  function escAttr(s) {
    return Dom.escAttr
      ? Dom.escAttr(s)
      : String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
  }
  function fmtD(iso) {
    return Dom.fmtD ? Dom.fmtD(iso) : (iso ? String(iso).slice(0, 10) : '-')
  }

  global.AdminUtils = { esc, escAttr, fmtD }
  global.esc = esc
  global.escAttr = escAttr
  global.fmtD = fmtD
})(window)
