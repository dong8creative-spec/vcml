const { fetchPlaylistStats, fetchChannelVisuals, formatViewCount } = require('../lib/youtube-portfolio')

;(async () => {
  const visuals = await fetchChannelVisuals('https://www.youtube.com/@CloudHospitalTV')
  console.log('visuals', visuals)
  const stats = await fetchPlaylistStats('https://www.youtube.com/playlist?list=PLDFVA5BZ0YD_EAFKtvfenBH1TXy_wW6S4')
  console.log('stats', {
    videoCount: stats.videoCount,
    totalViews: stats.totalViews,
    averageViews: stats.averageViews,
    averageFormatted: formatViewCount(stats.averageViews),
  })
})().catch(console.error)
