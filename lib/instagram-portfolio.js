function decodeSocialImageUrl(url) {
  return String(url || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\\u0026/g, '&')
    .replace(/\\u003d/g, '=')
    .replace(/\\\//g, '/')
    .trim()
}

function normalizeInstagramProfileUrl(accountUrl) {
  const raw = String(accountUrl || '').trim()
  if (!raw) return ''
  const user = raw.match(/instagram\.com\/([^/?#]+)/i)
  if (user && !['p', 'reel', 'reels', 'stories', 'explore'].includes(user[1].toLowerCase())) {
    return `https://www.instagram.com/${user[1]}/`
  }
  try {
    const parsed = new URL(raw)
    if (parsed.hostname.replace(/^www\./, '') === 'instagram.com') {
      return raw.split(/[?#]/)[0] + (raw.endsWith('/') ? '' : '/')
    }
  } catch {
    return ''
  }
  return ''
}

function extractSocialAvatarFromHtml(html) {
  const patterns = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i,
    /"profile_pic_url_hd":"([^"]+)"/,
    /"profile_pic_url":"([^"]+)"/,
    /"avatar":\s*\{\s*"thumbnails":\s*\[\s*\{\s*"url":\s*"([^"]+)"/,
    /"profile_pic_url(?:_hd)?":"([^"]+)"/,
  ]
  for (const pattern of patterns) {
    const match = String(html || '').match(pattern)
    if (match?.[1]) {
      return decodeSocialImageUrl(match[1]).slice(0, 2000)
    }
  }
  return ''
}

async function resolveInstagramAvatarUrl(accountUrl) {
  const fetchUrl = normalizeInstagramProfileUrl(accountUrl)
  if (!fetchUrl) return ''
  try {
    const res = await fetch(fetchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return ''
    const html = await res.text()
    return extractSocialAvatarFromHtml(html)
  } catch {
    return ''
  }
}

async function fetchInstagramAvatarBuffer(imageUrl) {
  const decoded = decodeSocialImageUrl(imageUrl)
  if (!decoded) return null
  try {
    const res = await fetch(decoded, {
      headers: {
        Referer: 'https://www.instagram.com/',
        Origin: 'https://www.instagram.com',
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Sec-Fetch-Dest': 'image',
        'Sec-Fetch-Mode': 'no-cors',
        'Sec-Fetch-Site': 'cross-site',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return null
    const contentType = String(res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim()
    if (!/^image\//i.test(contentType)) return null
    const buffer = Buffer.from(await res.arrayBuffer())
    if (!buffer.length) return null
    return { buffer, contentType }
  } catch {
    return null
  }
}

function isInstagramCdnUrl(url) {
  return /cdninstagram\.com|fbcdn\.net/i.test(String(url || ''))
}

function isHostedPortfolioAvatar(url) {
  return /storage\.googleapis\.com/i.test(String(url || '')) && /portfolio\/instagram-avatars/i.test(String(url || ''))
}

function isAllowedProxyImageUrl(raw) {
  try {
    const parsed = new URL(raw)
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase()
    return host.endsWith('cdninstagram.com') || host.endsWith('fbcdn.net')
  } catch {
    return false
  }
}

async function serveInstagramAvatar(imageUrl, profileUrl = '') {
  const decoded = decodeSocialImageUrl(imageUrl)
  if (decoded && isAllowedProxyImageUrl(decoded)) {
    const direct = await fetchInstagramAvatarBuffer(decoded)
    if (direct) return direct
  }
  const profile = normalizeInstagramProfileUrl(profileUrl)
  if (!profile) return null
  const fresh = await resolveInstagramAvatarUrl(profile)
  if (!fresh) return null
  return fetchInstagramAvatarBuffer(fresh)
}

module.exports = {
  decodeSocialImageUrl,
  normalizeInstagramProfileUrl,
  extractSocialAvatarFromHtml,
  resolveInstagramAvatarUrl,
  fetchInstagramAvatarBuffer,
  isInstagramCdnUrl,
  isHostedPortfolioAvatar,
  isAllowedProxyImageUrl,
  serveInstagramAvatar,
}
