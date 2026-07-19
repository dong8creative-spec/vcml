/**
 * 유튜브 채널 비공식 미리보기 (프로필 사진·이름)
 * 채널 페이지 HTML의 og/meta 및 ytInitialData에서 추출
 */
const YT_HOST_RE = /(^|\.)youtube\.com$|(^|\.)youtu\.be$|(^|\.)youtube-nocookie\.com$/i

function isYoutubeChannelUrl(raw) {
  try {
    const u = new URL(String(raw || '').trim())
    if (!/^https?:$/i.test(u.protocol)) return false
    if (!YT_HOST_RE.test(u.hostname.replace(/^www\./, ''))) return false
    const path = u.pathname || '/'
    // 영상/쇼츠 URL은 제외 — 채널·핸들·커스텀 URL만
    if (/^\/(watch|shorts|embed|live|playlist)/i.test(path)) return false
    if (u.hostname.includes('youtu.be')) return false
    return (
      /^\/@/.test(path)
      || /^\/(c|channel|user)\//i.test(path)
      || path === '/'
      || /^\/[^/]+\/?$/.test(path)
    )
  } catch {
    return false
  }
}

function absolutizeUrl(maybe, base) {
  if (!maybe) return null
  const s = String(maybe).trim().replace(/^\/\//, 'https://')
  if (!s) return null
  try {
    return new URL(s, base || 'https://www.youtube.com').href
  } catch {
    return null
  }
}

function pickMeta(html, prop) {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${prop}["']`, 'i'),
    new RegExp(`<meta[^>]+name=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${prop}["']`, 'i'),
  ]
  for (const re of patterns) {
    const m = html.match(re)
    if (m?.[1]) return m[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'").trim()
  }
  return null
}

function pickLink(html, rel) {
  const re = new RegExp(`<link[^>]+rel=["']${rel}["'][^>]+href=["']([^"']+)["']`, 'i')
  const m = html.match(re)
  return m?.[1] ? m[1].replace(/&amp;/g, '&').trim() : null
}

function extractYtInitialData(html) {
  const patterns = [
    /var\s+ytInitialData\s*=\s*(\{[\s\S]*?\})\s*;\s*<\/script>/,
    /window\["ytInitialData"\]\s*=\s*(\{[\s\S]*?\})\s*;/,
    /ytInitialData\s*=\s*(\{[\s\S]*?\})\s*;/,
  ]
  for (const re of patterns) {
    const m = html.match(re)
    if (!m?.[1]) continue
    try {
      return JSON.parse(m[1])
    } catch {
      /* continue */
    }
  }
  return null
}

function deepFindAvatar(obj, depth = 0, out = []) {
  if (!obj || depth > 14 || out.length > 20) return out
  if (Array.isArray(obj)) {
    for (const item of obj) deepFindAvatar(item, depth + 1, out)
    return out
  }
  if (typeof obj === 'object') {
    if (obj.avatar && obj.avatar.thumbnails) out.push(obj.avatar)
    if (obj.channelMetadataRenderer?.avatar?.thumbnails) {
      out.push(obj.channelMetadataRenderer.avatar)
    }
    for (const v of Object.values(obj)) deepFindAvatar(v, depth + 1, out)
  }
  return out
}

function bestThumbnail(thumbnails) {
  if (!Array.isArray(thumbnails) || !thumbnails.length) return null
  const sorted = [...thumbnails].sort((a, b) => (b.width || 0) - (a.width || 0))
  return sorted[0]?.url || null
}

function extractFromInitialData(data) {
  if (!data) return { title: null, avatarUrl: null, handle: null }
  const meta = data.metadata?.channelMetadataRenderer
    || data.header?.c4TabbedHeaderRenderer
    || null

  let title = meta?.title || data.metadata?.channelMetadataRenderer?.title || null
  let handle = meta?.ownerUrls?.[0]
    || meta?.vanityChannelUrl
    || data.metadata?.channelMetadataRenderer?.vanityChannelUrl
    || null
  if (handle) {
    try {
      const u = new URL(handle, 'https://www.youtube.com')
      const m = u.pathname.match(/^\/(@[^/]+)/)
      if (m) handle = m[1]
      else handle = u.pathname.replace(/\/$/, '') || handle
    } catch {
      /* keep */
    }
  }

  let avatarUrl = bestThumbnail(meta?.avatar?.thumbnails)
  if (!avatarUrl) {
    const avatars = deepFindAvatar(data)
    for (const a of avatars) {
      const url = bestThumbnail(a.thumbnails)
      if (url) {
        avatarUrl = url
        break
      }
    }
  }

  return { title, avatarUrl, handle }
}

async function fetchHtml(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12000)
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        Accept: 'text/html,application/xhtml+xml',
      },
    })
    const html = await res.text()
    return { html, url: res.url || url, ok: res.ok, status: res.status }
  } finally {
    clearTimeout(timer)
  }
}

async function fetchYoutubeChannelPreview(rawUrl) {
  const url = String(rawUrl || '').trim()
  if (!isYoutubeChannelUrl(url)) {
    const err = new Error('유튜브 채널 URL만 지원합니다. (@핸들, /channel/, /c/ 등)')
    err.code = 'INVALID_URL'
    throw err
  }

  const page = await fetchHtml(url)
  const html = page.html || ''

  const og = {
    title: pickMeta(html, 'og:title') || pickMeta(html, 'twitter:title'),
    avatarUrl: pickMeta(html, 'og:image') || pickMeta(html, 'twitter:image') || pickLink(html, 'image_src'),
  }
  const fromData = extractFromInitialData(extractYtInitialData(html))

  let title = (fromData.title || og.title || '').replace(/\s*-\s*YouTube\s*$/i, '').trim() || null
  let avatarUrl = absolutizeUrl(fromData.avatarUrl || og.avatarUrl, page.url || url)
  let handle = fromData.handle || null

  // 고해상도 아바타 선호 (s88 → s240 등)
  if (avatarUrl && /yt3\.(ggpht|googleusercontent)\.com/i.test(avatarUrl)) {
    avatarUrl = avatarUrl
      .replace(/=s\d+[^&=]*/i, '=s240-c-k-c0x00ffffff-no-rj')
      .replace(/=w\d+-h\d+[^&=]*/i, '=s240-c-k-c0x00ffffff-no-rj')
  }

  if (!avatarUrl && !title) {
    const err = new Error('채널 프로필 정보를 가져오지 못했습니다. URL을 확인하거나 프로필 사진 URL을 직접 입력하세요.')
    err.code = 'EMPTY'
    err.finalUrl = page.url
    throw err
  }

  return {
    url: page.url || url,
    title,
    handle,
    avatarUrl,
    source: 'html',
  }
}

module.exports = {
  isYoutubeChannelUrl,
  fetchYoutubeChannelPreview,
}
