async function test(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
  })
  const html = await res.text()
  const m = html.match(/property=["']og:image["'][^>]+content=["']([^"']+)/i)
    || html.match(/content=["']([^"']+)["'][^>]+property=["']og:image/i)
  if (!m) {
    console.log('NO MATCH')
    return
  }
  const raw = m[1]
  const decoded = raw.replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  console.log('raw len', raw.length)
  console.log('decoded', decoded)
  const img = await fetch(decoded, {
    headers: {
      Referer: 'https://www.instagram.com/',
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
    },
  })
  console.log('img status', img.status, img.headers.get('content-type'))
}

test(process.argv[2] || 'https://www.instagram.com/instagram/').catch(console.error)
