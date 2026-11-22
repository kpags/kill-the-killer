export const profileBarSize = 33
export const profileBars = 3
export const maxProfile = 100
export const hideTransitionMs = 1000
export const hideProfileRate = -5

const killRatings = [
  { rating: 'Warfreak', points: 50 },
  { rating: 'Brawler', points: 100 },
  { rating: 'Secret Agent', points: 200 },
  { rating: 'Hitman', points: 300 },
  { rating: 'Assassin', points: 400 },
]

export function adjustProfile(actor, amount) {
  const value = Math.max(0, Math.min(maxProfile, actor.profile + amount))
  actor.profile = Math.round(value * 1_000_000) / 1_000_000
}

export function profileFill(profile, index) {
  return Math.max(0, Math.min(1, (profile - index * profileBarSize) / profileBarSize))
}

export function profileKillAward(profile) {
  if (profile >= maxProfile) return killRatings[profileBars + 1]
  return killRatings[Math.floor(profile / profileBarSize)]
}
