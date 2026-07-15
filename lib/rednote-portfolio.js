const { uploadImageBuffer } = require('../utils/storage')

const REDNOTE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const FETCH_TIMEOUT_MS = 12000
const GENERIC_THUMB_PATTERNS = [
  /fe-platform/i,
  /picasso-share/i,
  /default[_-]?share/i,
  /logo/i,
  /avatar/i,
  /placeholder/i,
  /\/sns\/avatar\//i,
]

function decodeJsonEscapes(value) {
  return String(value || '')
    .replace(/\\u0026/g, '&')
    .replace(/\\u003d/g, '=')
    .replace(/\\u002f/gi, '/')
    .replace(/\\\//g, '/')
    .trim()
}

function isRednoteHost(hostname) {
  const host = String(hostname || '').replace(/^www\./, '').toLowerCase()
  return host === 'xiaohongshu.com'
    || host === 'xhslink.com'
    || host.endsWith('.xiaohongshu.com')
    || host.endsWith('.xhslink.com')
}

function normalizeRednotePageUrl(url) {
  const raw = String(url || '').trim()
  if (!raw) return ''
  try {
    const parsed = new URL(raw)
    if (!isRednoteHost(parsed.hostname)) return ''
    if (parsed.hostname.replace(/^www\./, '') === 'xhslink.com') return raw
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return ''
  }
}

function isLikelyRednoteThumbnail(url) {
  const raw = decodeJsonEscapes(url)
  if (!raw || !/^https?:\/\//i.test(raw)) return false
  if (GENERIC_THUMB_PATTERNS.some((pattern) => pattern.test(raw))) return false
  try {
    const parsed = new URL(raw)
    const host = parsed.hostname.toLowerCase()
    if (host.includes('xhscdn') || host.includes('sns-img') || host.includes('sns-webpic')) return true
    return /\.(?:jpe?g|png|webp)(?:\?|$)/i.test(parsed.pathname)
  } catch {
    return false
  }
}

function pickBestThumbnail(candidates) {
  const unique = []
  for (const candidate of candidates) {
    const decoded = decodeJsonEscapes(candidate)
    if (!isLikelyRednoteThumbnail(decoded)) continue
    if (!unique.includes(decoded)) unique.push(decoded)
  }
  if (!unique.length) return ''

  const scored = unique.map((url) => {
    let score = 0
    if (/sns-webpic|sns-img|xhscdn/i.test(url)) score += 4
    if (/notes_pre_post|note_pre_post|spectrum/i.test(url)) score += 3
    if (/1080|1040|960|720/.test(url)) score += 2
    if (/!nc_n_webp_mw_1|format\/webp/.test(url)) score += 1
    return { url, score }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored[0]?.url || ''
}

function extractRednoteThumbnailFromHtml(html) {
  const source = String(html || '')
  const candidates = []

  const metaPatterns = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/gi,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/gi,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/gi,
  ]
  for (const pattern of metaPatterns) {
    for (const match of source.matchAll(pattern)) {
      if (match?.[1]) candidates.push(match[1])
    }
  }

  const jsonPatterns = [
    /"imageList"\s*:\s*\[[\s\S]*?"url"\s*:\s*"([^"]+)"/gi,
    /"cover"\s*:\s*\{[^}]*"url(?:Default)?"\s*:\s*"([^"]+)"/gi,
    /"urlDefault"\s*:\s*"(https?:[^"\\]+)"/gi,
    /"originUrl"\s*:\s*"(https?:[^"\\]+)"/gi,
    /"infoList"\s*:\s*\[[\s\S]*?"url"\s*:\s*"(https?:[^"\\]+)"/gi,
    /https?:\\\/\\\/sns-webpic[^"\\]+/gi,
    /https?:\\\/\\\/sns-img[^"\\]+/gi,
    /https?:\/\/sns-webpic[^\s"'<>]+/gi,
    /https?:\/\/sns-img[^\s"'<>]+/gi,
  ]
  for (const pattern of jsonPatterns) {
    for (const match of source.matchAll(pattern)) {
      const value = match?.[1] || match?.[0]
      if (value) candidates.push(value)
    }
  }

  return pickBestThumbnail(candidates)
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': REDNOTE_UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,ko;q=0.8,en;q=0.7',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) return { html: '', finalUrl: res.url || url }
  const html = await res.text()
  return { html, finalUrl: res.url || url }
}

async function resolveRednotePageUrl(url) {
  const normalized = normalizeRednotePageUrl(url)
  if (!normalized) return ''
  try {
    const parsed = new URL(normalized)
    if (parsed.hostname.replace(/^www\./, '') !== 'xhslink.com') return normalized
    const res = await fetch(normalized, {
      method: 'GET',
      headers: {
        'User-Agent': REDNOTE_UA,
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    return normalizeRednotePageUrl(res.url || normalized) || normalized
  } catch {
    return normalized
  }
}

async function maybeRehostRednoteThumbnail(imageUrl) {
  const directUrl = decodeJsonEscapes(imageUrl)
  if (!directUrl) return ''
  try {
    const res = await fetch(directUrl, {
      headers: {
        'User-Agent': REDNOTE_UA,
        Referer: 'https://www.xiaohongshu.com/',
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) return directUrl.slice(0, 400)
    const contentType = String(res.headers.get('content-type') || '').toLowerCase()
    if (!contentType.startsWith('image/')) return directUrl.slice(0, 400)
    const buffer = Buffer.from(await res.arrayBuffer())
    if (buffer.length < 400 || buffer.length > 8 * 1024 * 1024) return directUrl.slice(0, 400)
    const hosted = await uploadImageBuffer(buffer, {
      folder: 'instructor-portfolio/rednote-thumbs',
      contentType,
    })
    return String(hosted || directUrl).slice(0, 400)
  } catch {
    return directUrl.slice(0, 400)
  }
}

async function fetchRednoteThumbnail(noteUrl) {
  const pageUrl = await resolveRednotePageUrl(noteUrl)
  if (!pageUrl) return ''
  try {
    const { html } = await fetchHtml(pageUrl)
    const extracted = extractRednoteThumbnailFromHtml(html)
    if (!extracted) return ''
    return maybeRehostRednoteThumbnail(extracted)
  } catch {
    return ''
  }
}

async function enrichRednoteMediaItem(item, previousItem) {
  if (!item?.url) return false
  const thumb = String(item.thumbnailUrl || '').trim()
  const urlChanged = previousItem
    ? String(previousItem.url || '').trim() !== String(item.url || '').trim()
    : false
  if (thumb && !urlChanged) return false
  const thumbnailUrl = await fetchRednoteThumbnail(item.url)
  if (!thumbnailUrl) return false
  item.thumbnailUrl = thumbnailUrl
  return true
}

async function enrichPortfolioWorksRednoteThumbnails(works, previousWorks) {
  if (!Array.isArray(works?.rednote) || !works.rednote.length) return false
  let changed = false
  for (const item of works.rednote) {
    const prev = Array.isArray(previousWorks?.rednote)
      ? previousWorks.rednote.find((row) => row.id === item.id)
      : null
    const updated = await enrichRednoteMediaItem(item, prev)
    if (updated) changed = true
  }
  return changed
}

module.exports = {
  decodeJsonEscapes,
  extractRednoteThumbnailFromHtml,
  fetchRednoteThumbnail,
  enrichRednoteMediaItem,
  enrichPortfolioWorksRednoteThumbnails,
  normalizeRednotePageUrl,
  resolveRednotePageUrl,
}
