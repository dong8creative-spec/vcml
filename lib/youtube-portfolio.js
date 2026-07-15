const INNERTUBE_TTL_MS = 60 * 60 * 1000
const MAX_PLAYLIST_VIDEOS = 80
const MAX_PLAYER_CONCURRENCY = 6

let _innertubeCache = null
let _innertubeCachedAt = 0

async function getInnertubeConfig() {
  if (_innertubeCache && Date.now() - _innertubeCachedAt < INNERTUBE_TTL_MS) {
    return _innertubeCache
  }
  const res = await fetch('https://www.youtube.com/', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept-Language': 'ko-KR,ko;q=0.9',
    },
    signal: AbortSignal.timeout(12000),
  })
  if (!res.ok) throw new Error('YouTube 설정을 가져오지 못했습니다.')
  const html = await res.text()
  const key = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1]
  const version = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1]
  if (!key || !version) throw new Error('YouTube API 키를 찾지 못했습니다.')
  _innertubeCache = { key, version }
  _innertubeCachedAt = Date.now()
  return _innertubeCache
}

async function innertubePost(endpoint, body) {
  const { key, version } = await getInnertubeConfig()
  const payload = {
    ...body,
    context: {
      client: {
        hl: 'ko',
        gl: 'KR',
        clientName: 'WEB',
        clientVersion: version,
      },
    },
  }
  const res = await fetch(`https://www.youtube.com/youtubei/v1/${endpoint}?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`YouTube ${endpoint} 요청 실패 (${res.status}) ${err.slice(0, 120)}`)
  }
  return res.json()
}

function extractPlaylistId(url) {
  const raw = String(url || '').trim()
  if (!raw) return ''
  const m = raw.match(/[?&]list=([^&#]+)/i)
  return m?.[1] || ''
}

function normalizePlaylistUrl(url) {
  const id = extractPlaylistId(url)
  return id ? `https://www.youtube.com/playlist?list=${id}` : ''
}

function extractVideoIdsFromBrowse(data) {
  const flat = JSON.stringify(data)
  return [...new Set([...flat.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"/g)].map(m => m[1]))]
}

function extractContinuationToken(data) {
  const flat = JSON.stringify(data)
  const m = flat.match(/"continuationCommand":\{[^}]*"token":"([^"]+)"/)
    || flat.match(/"token":"(Eg[^"]{20,})"/)
  return m?.[1] || ''
}

async function fetchPlaylistVideoIds(playlistUrl, maxVideos = MAX_PLAYLIST_VIDEOS) {
  const listId = extractPlaylistId(playlistUrl)
  if (!listId) return []
  const ids = []
  let continuation = null

  for (let page = 0; page < 8 && ids.length < maxVideos; page += 1) {
    const data = continuation
      ? await innertubePost('browse', { continuation })
      : await innertubePost('browse', { browseId: `VL${listId}`, params: 'wgYCCAA%3D' })
    const pageIds = extractVideoIdsFromBrowse(data)
    for (const id of pageIds) {
      if (!ids.includes(id)) ids.push(id)
      if (ids.length >= maxVideos) break
    }
    continuation = extractContinuationToken(data)
    if (!continuation || !pageIds.length) break
  }

  return ids.slice(0, maxVideos)
}

async function fetchVideoViewCount(videoId) {
  const data = await innertubePost('player', { videoId })
  const count = Number(data?.videoDetails?.viewCount || 0)
  const title = String(data?.videoDetails?.title || '').trim()
  return { videoId, title, viewCount: Number.isFinite(count) ? count : 0 }
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length)
  let index = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const i = index
      index += 1
      results[i] = await mapper(items[i], i)
    }
  })
  await Promise.all(workers)
  return results
}

function formatViewCount(n) {
  const num = Number(n || 0)
  if (!Number.isFinite(num) || num <= 0) return '0'
  if (num >= 100000000) return `${(num / 100000000).toFixed(1).replace(/\.0$/, '')}억`
  if (num >= 10000) return `${(num / 10000).toFixed(1).replace(/\.0$/, '')}만`
  return num.toLocaleString('ko-KR')
}

async function fetchPlaylistStats(playlistUrl) {
  const url = normalizePlaylistUrl(playlistUrl)
  const listId = extractPlaylistId(url)
  if (!listId) {
    return { url: '', listId: '', videoCount: 0, totalViews: 0, averageViews: 0, videos: [] }
  }

  const videoIds = await fetchPlaylistVideoIds(url)
  const videos = await mapWithConcurrency(videoIds, MAX_PLAYER_CONCURRENCY, (videoId) => fetchVideoViewCount(videoId))
  const totalViews = videos.reduce((sum, v) => sum + (v.viewCount || 0), 0)
  const videoCount = videos.length
  const averageViews = videoCount ? Math.round(totalViews / videoCount) : 0

  return {
    url,
    listId,
    videoCount,
    totalViews,
    averageViews,
    videos,
    statsUpdatedAt: new Date().toISOString(),
  }
}

function extractBannerFromHtml(html) {
  const patterns = [
    /"banner"\s*:\s*\{[^}]*"thumbnails"\s*:\s*\[\s*\{[^}]*"url"\s*:\s*"([^"]+)"/,
    /"imageBannerViewModel"\s*:\s*\{[^}]*"image"\s*:\s*\{[^}]*"sources"\s*:\s*\[\s*\{[^}]*"url"\s*:\s*"([^"]+)"/,
    /"channelBannerUrl"\s*:\s*"([^"]+)"/,
  ]
  for (const pattern of patterns) {
    const match = String(html || '').match(pattern)
    if (match?.[1]) {
      return match[1]
        .replace(/\\u0026/g, '&')
        .replace(/\\\//g, '/')
        .trim()
    }
  }
  return ''
}

function extractAvatarFromHtml(html) {
  const patterns = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
    /"avatar":\s*\{\s*"thumbnails":\s*\[\s*\{\s*"url":\s*"([^"]+)"/,
  ]
  for (const pattern of patterns) {
    const match = String(html || '').match(pattern)
    if (match?.[1]) {
      return match[1]
        .replace(/\\u0026/g, '&')
        .replace(/\\\//g, '/')
        .trim()
    }
  }
  return ''
}

function normalizeChannelFetchUrl(accountUrl) {
  const raw = String(accountUrl || '').trim()
  if (!raw) return ''
  const handle = raw.match(/youtube\.com\/(@[^/?#]+)/i)
  if (handle) return `https://www.youtube.com/${handle[1]}`
  const channel = raw.match(/youtube\.com\/channel\/([^/?#]+)/i)
  if (channel) return `https://www.youtube.com/channel/${channel[1]}`
  return raw.split(/[?#]/)[0]
}

async function fetchChannelVisuals(accountUrl) {
  const fetchUrl = normalizeChannelFetchUrl(accountUrl)
  if (!fetchUrl) return { avatarUrl: '', bannerUrl: '' }
  try {
    const res = await fetch(fetchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'ko-KR,ko;q=0.9',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return { avatarUrl: '', bannerUrl: '' }
    const html = await res.text()
    return {
      avatarUrl: extractAvatarFromHtml(html).slice(0, 400),
      bannerUrl: extractBannerFromHtml(html).slice(0, 400),
    }
  } catch {
    return { avatarUrl: '', bannerUrl: '' }
  }
}

function aggregateViewStats(playlists) {
  const list = Array.isArray(playlists) ? playlists : []
  const videoCount = list.reduce((sum, pl) => sum + (Number(pl.videoCount) || 0), 0)
  const totalViews = list.reduce((sum, pl) => sum + (Number(pl.totalViews) || 0), 0)
  const averageViews = videoCount ? Math.round(totalViews / videoCount) : 0
  return { videoCount, totalViews, averageViews }
}

module.exports = {
  extractPlaylistId,
  normalizePlaylistUrl,
  fetchPlaylistStats,
  fetchChannelVisuals,
  aggregateViewStats,
  formatViewCount,
}
