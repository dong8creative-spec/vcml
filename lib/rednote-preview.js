/**
 * 샤오홍슈(Rednote) 비공식 미리보기 추출
 * - HTML OG/초기상태 파싱 (베스트에포트)
 * - REDNOTE_PREVIEW_API 환경변수로 외부 스크래퍼 연동 가능
 *
 * 주의: 샤오홍슈 안티봇으로 실패할 수 있으며, 비공식 방식이라 언제든 깨질 수 있습니다.
 */
const REDNOTE_HOST_RE = /(^|\.)xiaohongshu\.com$|(^|\.)xhslink\.com$|(^|\.)xhscdn\.com$/i

function isRednoteUrl(raw) {
  try {
    const u = new URL(String(raw || '').trim())
    if (!/^https?:$/i.test(u.protocol)) return false
    return REDNOTE_HOST_RE.test(u.hostname.replace(/^www\./, ''))
      || /xiaohongshu\.com|xhslink\.com/i.test(u.hostname)
  } catch {
    return false
  }
}

function absolutizeUrl(maybe, base) {
  if (!maybe) return null
  const s = String(maybe).trim().replace(/^\/\//, 'https://')
  if (!s) return null
  try {
    return new URL(s, base || 'https://www.xiaohongshu.com').href
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
    if (m?.[1]) return m[1].replace(/&amp;/g, '&').trim()
  }
  return null
}

function extractJsonBlobs(html) {
  const blobs = []
  const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi
  let m
  while ((m = scriptRe.exec(html))) {
    const body = m[1] || ''
    if (body.length < 40) continue
    if (!/__INITIAL|noteDetail|originVideo|imageList|video|cover|ogImage/i.test(body)) continue
    blobs.push(body)
  }
  // window.__INITIAL_STATE__ = {...}
  const stateMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*(?:<\/script|;)/)
  if (stateMatch?.[1]) blobs.unshift(stateMatch[1])
  const ssrMatch = html.match(/window\.__INITIAL_SSR_STATE__\s*=\s*(\{[\s\S]*?\})\s*(?:<\/script|;)/)
  if (ssrMatch?.[1]) blobs.unshift(ssrMatch[1])
  return blobs
}

function deepFind(obj, pred, depth = 0, out = []) {
  if (!obj || depth > 12 || out.length > 40) return out
  if (Array.isArray(obj)) {
    for (const item of obj) deepFind(item, pred, depth + 1, out)
    return out
  }
  if (typeof obj === 'object') {
    if (pred(obj)) out.push(obj)
    for (const v of Object.values(obj)) deepFind(v, pred, depth + 1, out)
  }
  return out
}

function parseLooseJson(text) {
  let t = String(text || '').trim()
  // JS object with undefined → strip
  t = t.replace(/\bundefined\b/g, 'null')
  // trailing commas
  t = t.replace(/,\s*([}\]])/g, '$1')
  try {
    return JSON.parse(t)
  } catch {
    // try to extract first {...}
    const start = t.indexOf('{')
    const end = t.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(t.slice(start, end + 1).replace(/,\s*([}\]])/g, '$1'))
      } catch {
        return null
      }
    }
    return null
  }
}

function extractFromState(html, pageUrl) {
  const result = { title: null, description: null, coverUrl: null, videoUrl: null, images: [] }
  for (const blob of extractJsonBlobs(html)) {
    // direct regex hits in blob (even if JSON parse fails)
    const coverHit = blob.match(/"(?:cover(?:Url|Info)?|image|urlDefault|url)"\s*:\s*"(https?:[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i)
      || blob.match(/"(https?:\/\/sns-[^"]+\.xhscdn\.com[^"]+)"/i)
    if (coverHit?.[1] && !result.coverUrl) result.coverUrl = absolutizeUrl(coverHit[1].replace(/\\u002F/g, '/'), pageUrl)

    const videoHit = blob.match(/"(?:masterUrl|backupUrls?|mediaUrl|videoUrl|originVideoKey)"\s*:\s*"(https?:[^"]+)"/i)
      || blob.match(/"(https?:\/\/[^"]+\.mp4[^"]*)"/i)
    if (videoHit?.[1] && !result.videoUrl) {
      let v = videoHit[1].replace(/\\u002F/g, '/')
      // originVideoKey might be a key not full URL
      if (/^https?:/i.test(v)) result.videoUrl = absolutizeUrl(v, pageUrl)
    }

    const json = parseLooseJson(blob)
    if (!json) continue

    const notes = deepFind(json, (o) =>
      o && (o.noteId || o.note_id || o.title || o.displayTitle || o.desc || o.cover || o.imageList || o.video)
    )
    for (const note of notes) {
      if (!result.title) result.title = note.title || note.displayTitle || note.display_title || null
      if (!result.description) result.description = note.desc || note.description || note.ipLocation || null

      const cover =
        note.cover?.urlDefault || note.cover?.url || note.cover?.infoList?.[0]?.url
        || note.imageList?.[0]?.urlDefault || note.imageList?.[0]?.url
        || note.imagesList?.[0]?.url || note.coverUrl || note.ogImage
      if (cover && !result.coverUrl) result.coverUrl = absolutizeUrl(cover, pageUrl)

      if (Array.isArray(note.imageList)) {
        for (const img of note.imageList) {
          const u = absolutizeUrl(img?.urlDefault || img?.url, pageUrl)
          if (u) result.images.push(u)
        }
      }

      const media = note.video || note.videoInfo || note.media
      const stream = media?.media?.stream || media?.stream || media
      const master =
        stream?.h264?.[0]?.masterUrl
        || stream?.h265?.[0]?.masterUrl
        || stream?.av1?.[0]?.masterUrl
        || media?.url
        || media?.consumer?.originVideoKey
      if (master && /^https?:/i.test(String(master)) && !result.videoUrl) {
        result.videoUrl = absolutizeUrl(master, pageUrl)
      }
    }
  }
  if (!result.coverUrl && result.images[0]) result.coverUrl = result.images[0]
  return result
}

async function fetchHtml(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,ko;q=0.8,en;q=0.7',
        'Cache-Control': 'no-cache',
        Referer: 'https://www.xiaohongshu.com/',
      },
    })
    const html = await res.text()
    return { ok: res.ok, status: res.status, url: res.url, html }
  } finally {
    clearTimeout(timer)
  }
}

async function fetchExternalPreview(url) {
  const endpoint = String(process.env.REDNOTE_PREVIEW_API || '').trim()
  if (!endpoint) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  try {
    let target
    if (endpoint.includes('{url}')) {
      target = endpoint.replace('{url}', encodeURIComponent(url))
    } else {
      const u = new URL(endpoint)
      u.searchParams.set('url', url)
      target = u.toString()
    }
    const res = await fetch(target, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return null
    const data = await res.json()
    if (data?.status === false) return null
    const coverUrl =
      data.coverUrl || data.cover || data.ogImage
      || (Array.isArray(data.images) ? data.images[0] : null)
      || data.image
    const videoUrl =
      data.videoUrl || data.video
      || (Array.isArray(data.downloads) ? (data.downloads[0]?.url || data.downloads[0]) : null)
    return {
      title: data.title || null,
      description: data.desc || data.description || null,
      coverUrl: coverUrl ? String(coverUrl) : null,
      videoUrl: videoUrl && /^https?:/i.test(String(videoUrl)) ? String(videoUrl) : null,
      source: 'external',
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function fetchRednotePreview(rawUrl) {
  const url = String(rawUrl || '').trim()
  if (!isRednoteUrl(url)) {
    const err = new Error('샤오홍슈(또는 xhslink) URL만 지원합니다.')
    err.code = 'INVALID_URL'
    throw err
  }

  // 1) 외부 스크래퍼 우선 (설정된 경우)
  const external = await fetchExternalPreview(url)
  if (external?.coverUrl || external?.videoUrl) {
    return {
      url,
      title: external.title,
      description: external.description,
      coverUrl: external.coverUrl,
      videoUrl: external.videoUrl,
      source: 'external',
    }
  }

  // 2) 내장 HTML 스크래핑
  const page = await fetchHtml(url)
  const html = page.html || ''
  const blocked =
    /error_code=300031|暂无法浏览|当前笔记暂时无法浏览|verifyMsg|captcha/i.test(html)
    || /\/404\?source=/.test(page.url || '')

  const og = {
    title: pickMeta(html, 'og:title') || pickMeta(html, 'twitter:title'),
    description: pickMeta(html, 'og:description') || pickMeta(html, 'twitter:description'),
    coverUrl: pickMeta(html, 'og:image') || pickMeta(html, 'twitter:image'),
    videoUrl: pickMeta(html, 'og:video') || pickMeta(html, 'og:video:url') || pickMeta(html, 'twitter:player:stream'),
  }
  const state = extractFromState(html, page.url || url)

  const title = (og.title || state.title || '').replace(/\s*-\s*小红书\s*$/, '').trim() || null
  const description = (og.description || state.description || '').trim() || null
  const coverUrl = absolutizeUrl(og.coverUrl || state.coverUrl, page.url || url)
  const videoUrl = absolutizeUrl(og.videoUrl || state.videoUrl, page.url || url)

  if (!coverUrl && !videoUrl) {
    const err = new Error(
      blocked
        ? '샤오홍슈가 봇 접근을 차단했습니다. REDNOTE_PREVIEW_API를 설정하거나 커버 이미지 URL을 직접 입력하세요.'
        : '미리보기 정보를 추출하지 못했습니다. 커버 이미지 URL을 직접 입력하거나 REDNOTE_PREVIEW_API를 설정하세요.'
    )
    err.code = blocked ? 'BLOCKED' : 'EMPTY'
    err.finalUrl = page.url
    throw err
  }

  return {
    url: page.url || url,
    title,
    description,
    coverUrl,
    videoUrl,
    source: 'html',
  }
}

module.exports = {
  isRednoteUrl,
  fetchRednotePreview,
}
