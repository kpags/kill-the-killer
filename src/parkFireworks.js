// Main explosion onsets in the supplied recordings, in milliseconds.
const burstTimes = {
  'one.mp3': [400, 2020, 4140],
  'two.mp3': [3020],
  'three.mp3': [2900],
}

// Times in the GIF atlas for the quiet sky and its two launch sequences.
const quietSky = 900
const launches = [{ start: 0, end: quietSky }, { start: 1080, end: 1620 }]
const launchLeadMs = 180

export function fireworksSceneTime(track, elapsedMs) {
  const bursts = burstTimes[track]
  if (!bursts) return null

  for (const [index, burstAt] of bursts.entries()) {
    const { start, end } = launches[index % launches.length]
    const time = start + elapsedMs - burstAt + launchLeadMs
    if (time >= start && time < end) return time
  }
  return quietSky
}
