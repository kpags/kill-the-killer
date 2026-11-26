import inventory from '../data/inventory.json' with { type: 'json' }

export const smokeItem = 'smoke'
export const smokeDurationMs = 10_000
export const smokeFadeMs = 3000
export const smokeViewTransitionMs = 300
export const smokePlaybackRate = 2
export const smokeWidth = Number.parseFloat(inventory.smoke.width)
export const smokeHeight = Number.parseFloat(inventory.smoke.height)
