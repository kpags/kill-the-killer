import { computed, onMounted, onUnmounted, watch } from 'vue'
import { areas } from '../shared/park.js'
import { npcPenaltyMs } from '../shared/combat.js'
import { fireworksSceneTime } from './parkFireworks.js'
import clickUrl from '../assets/sounds/menu/buttons/click.mp3'
import hoverUrl from '../assets/sounds/menu/buttons/hover.mp3'
import firstTrack from '../assets/musics/menu/one.mp3'
import secondTrack from '../assets/musics/menu/two.mp3'
import thirdTrack from '../assets/musics/menu/three.mp3'

const playgroundTracks = Object.values(import.meta.glob('../assets/maps/park/4_playground/musics/*.mp3',
  { eager: true, import: 'default', query: '?url' }))
const victoryTracks = Object.values(import.meta.glob('../assets/musics/in_game/victory/*.mp3',
  { eager: true, import: 'default', query: '?url' }))
const ambienceAssets = import.meta.glob('../assets/maps/park/*/sounds/*.{mp3,ogg,wav,m4a}',
  { eager: true, import: 'default', query: '?url' })
const ambienceTracks = new Map()
const fireworksClips = new Map()
for (const [path, url] of Object.entries(ambienceAssets)) {
  const [area, , filename] = path.split('/').slice(-3)
  if (!ambienceTracks.has(area)) ambienceTracks.set(area, [])
  ambienceTracks.get(area).push(url)
  if (area === '5_fireworks') fireworksClips.set(url, filename)
}
const ambienceVolume = 0.15
const combatAssets = import.meta.glob('../assets/sounds/in_game/**/*.mp3',
  { eager: true, import: 'default', query: '?url' })
const smokeAffectedUrl = combatAssets['../assets/sounds/in_game/items/smoke/affected.mp3']
const combatDirectories = {
  kill: 'kill',
  'pre-stun': 'pre_stun',
  'full-stun': 'stun/full_stun',
  'quick-stun': 'stun/quick_stun',
  'crowd-reaction': 'crowd_reaction',
  penalty: 'penalty',
}
const combatTracks = Object.fromEntries(Object.entries(combatDirectories).map(([kind, directory]) => [
  kind,
  Object.keys(combatAssets).sort()
    .filter((path) => path.startsWith(`../assets/sounds/in_game/${directory}/`))
    .map((path) => combatAssets[path]),
]))
const singleEffects = {
  heartbeat: 'misc/heartbeat.mp3',
  'blowgun-damage': 'items/poisoned_blowgun/damage.mp3',
  'blowgun-death': 'items/poisoned_blowgun/death.mp3',
  'blowgun-not-target': 'items/poisoned_blowgun/not_target.mp3',
  'blowgun-used': 'items/poisoned_blowgun/used.mp3',
  'smoke-used': 'items/smoke/used.mp3',
  'rock-used': 'items/rock/used.mp3',
  'rock-hit': 'items/rock/hit.mp3',
}
for (const [kind, file] of Object.entries(singleEffects)) {
  combatTracks[kind] = [combatAssets[`../assets/sounds/in_game/${file}`]]
}

function trackFor(kind, variant) {
  const tracks = combatTracks[kind] ?? []
  return tracks[Math.floor(variant * tracks.length)]
}

function effectRate(duration, maxDurationMs) {
  return maxDurationMs && Number.isFinite(duration) ? Math.max(1, duration * 1000 / maxDurationMs) : 1
}

function takeNextTrack(playlist) {
  if (!playlist.queue.length) playlist.queue = [...playlist.tracks]
  const choices = playlist.queue.length > 1 ? playlist.queue.filter((track) => track !== playlist.current) : playlist.queue
  playlist.current = choices[Math.floor(Math.random() * choices.length)]
  playlist.queue.splice(playlist.queue.indexOf(playlist.current), 1)
  return playlist.current
}

export function useGameAudio(settings, menuActive, park) {
  const parkArea = computed(() => menuActive.value ? null : park.value?.area)
  const winnerVisible = computed(() => !menuActive.value && Boolean(park.value?.result))
  const inSmoke = computed(() => !menuActive.value && Boolean(park.value?.smokeObscured))
  const ambienceSilenced = computed(() => winnerVisible.value || Boolean(park.value?.penaltyUntil || park.value?.crowdReacting))
  const click = new Audio(clickUrl)
  const hover = new Audio(hoverUrl)
  const smokeAffected = new Audio(smokeAffectedUrl)
  const music = new Audio()
  const ambience = new Audio()
  const menu = { tracks: [firstTrack, secondTrack, thirdTrack], queue: [], current: null, time: 0 }
  const playground = { tracks: playgroundTracks, queue: [], current: null, time: 0 }
  const victory = { current: null, time: 0 }
  const effectBuffers = new Map()
  const activeEffects = new Set()
  const fallbackEffects = new Set()
  const penaltyEffects = new Map()
  click.preload = 'auto'
  hover.preload = 'auto'
  smokeAffected.preload = 'auto'
  smokeAffected.loop = true
  let context
  let musicGain
  let effectsGain
  let ambienceGain
  let activated = false
  let playlist
  let ambienceArea
  let ambiencePlaylist
  let audioScope = 0

  function setVolume() {
    const { sfx, music: musicLevel } = settings.value
    const areaLevel = Math.min(ambienceVolume, sfx / 100)
    if (context) {
      effectsGain.gain.value = sfx / 100
      musicGain.gain.value = musicLevel / 100
      ambienceGain.gain.value = areaLevel
    } else {
      click.volume = sfx / 100
      hover.volume = sfx / 100
      smokeAffected.volume = sfx / 100
      music.volume = musicLevel / 100
      ambience.volume = areaLevel
      for (const clip of fallbackEffects) clip.volume = sfx / 100
      for (const { clip } of penaltyEffects.values()) {
        if (clip) clip.volume = sfx / 100
      }
    }
  }

  function startNextTrack() {
    if (!playlist) return
    takeNextTrack(playlist)
    playlist.time = 0
    loadTrack()
  }

  function loadTrack() {
    music.src = playlist.current
    if (playlist.time) music.currentTime = playlist.time
    playMusic()
  }

  function playMusic() {
    if (playlist && activated && music.paused && !music.ended) music.play().catch(() => {})
  }

  function musicEnded() {
    if (!music.ended) return
    if (playlist === victory) {
      victory.current = null
      selectPlaylist()
    } else {
      startNextTrack()
    }
  }

  function syncAmbience() {
    const area = areas[parkArea.value]?.art
    if (area !== ambienceArea) {
      ambience.pause()
      if (ambience.hasAttribute('src')) {
        ambience.removeAttribute('src')
        ambience.load()
      }
      const tracks = ambienceTracks.get(area)
      ambiencePlaylist = tracks && { tracks, queue: [], current: null }
      ambienceArea = area
    }
    if (!activated || !ambiencePlaylist || ambienceSilenced.value) {
      ambience.pause()
      return
    }
    if (!ambiencePlaylist.current || ambience.ended) ambience.src = takeNextTrack(ambiencePlaylist)
    if (ambience.paused) ambience.play().catch(() => {})
  }

  function getFireworksSceneTime() {
    const clip = fireworksClips.get(ambiencePlaylist?.current)
    return clip && !ambience.paused ? fireworksSceneTime(clip, ambience.currentTime * 1000) : null
  }

  function stopCombatSounds() {
    audioScope++
    for (const source of activeEffects) source.stop()
    for (const clip of fallbackEffects) clip.pause()
    activeEffects.clear()
    fallbackEffects.clear()
  }

  function selectPlaylist() {
    stopCombatSounds()
    if (!menuActive.value) preloadCombatSounds()
    const inPlayground = areas[parkArea.value]?.id === 'playground' && playground.tracks.length > 0
    const background = menuActive.value ? menu : inPlayground && !winnerVisible.value ? playground : null
    const next = victory.current ? victory : background
    if (next === playlist) return
    if (playlist === menu) {
      hover.pause()
      menu.time = music.currentTime
    }
    if (playlist === playground) {
      playground.current = null
      playground.queue = []
    }
    music.pause()
    playlist = next
    if (playlist?.current) {
      loadTrack()
    } else if (activated && playlist) {
      startNextTrack()
    } else if (music.hasAttribute('src')) {
      music.removeAttribute('src')
      music.load()
    }
  }

  function syncPlaylist([inMenu, , showingWinner], [wasInMenu, , wasShowingWinner]) {
    // Let the cue finish on Home, and clear it when a new match begins.
    if (inMenu !== wasInMenu && (!inMenu || !activated)) victory.current = null
    if (showingWinner && !wasShowingWinner && victoryTracks.length) {
      victory.current = victoryTracks[Math.floor(Math.random() * victoryTracks.length)]
    }
    selectPlaylist()
  }

  function loadEffectBuffer(url) {
    if (!effectBuffers.has(url)) {
      const buffer = fetch(url).then((response) => {
        if (!response.ok) throw new Error('Could not load combat sound.')
        return response.arrayBuffer()
      }).then((data) => context.decodeAudioData(data)).catch((error) => {
        effectBuffers.delete(url)
        throw error
      })
      effectBuffers.set(url, buffer)
    }
    return effectBuffers.get(url)
  }

  function preloadCombatSounds() {
    if (!context || parkArea.value == null) return
    for (const tracks of Object.values(combatTracks)) {
      for (const url of tracks) loadEffectBuffer(url).catch(() => {})
    }
  }

  function stopPenaltySound(id) {
    const effect = penaltyEffects.get(id)
    if (!effect) return
    penaltyEffects.delete(id)
    clearTimeout(effect.timer)
    effect.stop?.()
  }

  function startPenaltySound({ id, variant, expiresAt }, serverTime) {
    const url = trackFor('penalty', variant)
    const remaining = expiresAt - serverTime
    if (!url || remaining <= 0) return
    const end = performance.now() + remaining
    const effect = { timer: setTimeout(() => effect.stop?.(), remaining) }
    penaltyEffects.set(id, effect)
    const offset = (duration) => Math.max(0, (npcPenaltyMs - (end - performance.now())) / 1000) % duration
    if (context) {
      loadEffectBuffer(url).then((buffer) => {
        const secondsLeft = (end - performance.now()) / 1000
        if (penaltyEffects.get(id) !== effect || secondsLeft <= 0) return
        const source = context.createBufferSource()
        effect.stop = () => source.stop()
        source.buffer = buffer
        source.loop = true
        source.connect(effectsGain)
        source.onended = () => {
          effect.stop = undefined
          source.disconnect()
        }
        const start = context.currentTime
        source.start(start, offset(buffer.duration))
        source.stop(start + secondsLeft)
      }).catch(() => {})
      return
    }
    const clip = new Audio(url)
    effect.clip = clip
    effect.stop = () => clip.pause()
    clip.volume = settings.value.sfx / 100
    clip.loop = true
    clip.addEventListener('loadedmetadata', () => {
      if (penaltyEffects.get(id) === effect && clip.duration > 0) clip.currentTime = offset(clip.duration)
    }, { once: true })
    clip.play().catch(() => {})
  }

  function syncPenaltySounds() {
    if (!activated) return
    const state = menuActive.value ? null : park.value
    const sounds = state?.penaltySounds ?? []
    for (const id of penaltyEffects.keys()) {
      if (!sounds.some((sound) => sound.id === id)) stopPenaltySound(id)
    }
    for (const sound of sounds) {
      if (!penaltyEffects.has(sound.id)) startPenaltySound(sound, state.serverTime)
    }
  }

  function syncSmokeSound() {
    if (!activated) return
    if (inSmoke.value) {
      if (smokeAffected.paused) smokeAffected.play().catch(() => {})
    } else if (!smokeAffected.paused) {
      smokeAffected.pause()
      smokeAffected.currentTime = 0
    }
  }

  function playCombatSounds(sounds) {
    if (!activated || menuActive.value || !settings.value.sfx) return
    const effects = sounds.map(({ kind, variant = 0, maxDurationMs }) => ({ url: trackFor(kind, variant), maxDurationMs }))
      .filter(({ url }) => url)
    if (context) {
      const scope = audioScope
      Promise.all(effects.map(({ url }) => loadEffectBuffer(url).catch(() => null))).then((buffers) => {
        if (scope !== audioScope || !settings.value.sfx || context.state !== 'running') return
        const startAt = context.currentTime
        for (const [index, buffer] of buffers.entries()) {
          if (!buffer) continue
          const source = context.createBufferSource()
          source.buffer = buffer
          source.playbackRate.value = effectRate(buffer.duration, effects[index].maxDurationMs)
          source.connect(effectsGain)
          activeEffects.add(source)
          source.onended = () => {
            activeEffects.delete(source)
            source.disconnect()
          }
          source.start(startAt)
        }
      })
      return
    }
    for (const { url, maxDurationMs } of effects) {
      const clip = new Audio(url)
      clip.volume = settings.value.sfx / 100
      if (maxDurationMs) {
        const setRate = () => { clip.playbackRate = effectRate(clip.duration, maxDurationMs) }
        if (clip.readyState) setRate()
        else clip.addEventListener('loadedmetadata', setRate, { once: true })
      }
      fallbackEffects.add(clip)
      const cleanup = () => fallbackEffects.delete(clip)
      clip.addEventListener('ended', cleanup, { once: true })
      clip.play().catch(cleanup)
    }
  }

  function activate(event) {
    if (!event.isTrusted) return
    if (!activated && window.AudioContext) {
      context = new AudioContext()
      effectsGain = context.createGain()
      musicGain = context.createGain()
      ambienceGain = context.createGain()
      effectsGain.connect(context.destination)
      musicGain.connect(context.destination)
      ambienceGain.connect(context.destination)
      context.createMediaElementSource(click).connect(effectsGain)
      context.createMediaElementSource(hover).connect(effectsGain)
      context.createMediaElementSource(smokeAffected).connect(effectsGain)
      context.createMediaElementSource(music).connect(musicGain)
      context.createMediaElementSource(ambience).connect(ambienceGain)
    }
    if (!activated) {
      setVolume()
      activated = true
      if (!menuActive.value) preloadCombatSounds()
      syncPenaltySounds()
    }
    if (context && context.state !== 'running') context.resume().catch(() => {})
    syncSmokeSound()
    syncAmbience()
    if (playlist?.current) playMusic()
    else startNextTrack()
  }

  function playEffect(audio) {
    if (!activated || !settings.value.sfx) return
    audio.currentTime = 0
    audio.play().catch(() => {})
  }

  function playHover(event) {
    if (!menuActive.value || !event.isTrusted || event.pointerType === 'touch') return
    const button = event.target.closest?.('button:not(:disabled)')
    if (button && !button.contains(event.relatedTarget)) playEffect(hover)
  }

  function playClick(event) {
    activate(event)
    if (!menuActive.value || !event.isTrusted) return
    if (event.target.closest?.('button:not(:disabled)')) playEffect(click)
  }

  watch(settings, () => { if (activated) setVolume() }, { flush: 'sync' })
  watch([menuActive, parkArea, winnerVisible], syncPlaylist, { immediate: true, flush: 'sync' })
  watch([menuActive, park], syncPenaltySounds, { flush: 'sync' })
  watch(inSmoke, syncSmokeSound, { flush: 'sync' })
  watch([parkArea, ambienceSilenced], syncAmbience, { flush: 'sync' })

  onMounted(() => {
    music.addEventListener('ended', musicEnded)
    ambience.addEventListener('ended', syncAmbience)
    document.addEventListener('pointerdown', activate, true)
    document.addEventListener('keydown', activate, true)
    document.addEventListener('pointerover', playHover)
    document.addEventListener('click', playClick, true)
  })

  onUnmounted(() => {
    music.removeEventListener('ended', musicEnded)
    ambience.removeEventListener('ended', syncAmbience)
    document.removeEventListener('pointerdown', activate, true)
    document.removeEventListener('keydown', activate, true)
    document.removeEventListener('pointerover', playHover)
    document.removeEventListener('click', playClick, true)
    stopCombatSounds()
    for (const id of penaltyEffects.keys()) stopPenaltySound(id)
    for (const audio of [click, hover, music, smokeAffected, ambience]) audio.pause()
    context?.close().catch(() => {})
  })

  return { playCombatSounds, getFireworksSceneTime }
}
