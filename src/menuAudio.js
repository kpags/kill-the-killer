import { computed, onMounted, onUnmounted, watch } from 'vue'
import { areas } from '../shared/park.js'
import { npcPenaltyMs } from '../shared/combat.js'
import clickUrl from '../assets/sounds/menu/buttons/click.mp3'
import hoverUrl from '../assets/sounds/menu/buttons/hover.mp3'
import firstTrack from '../assets/musics/menu/one.mp3'
import secondTrack from '../assets/musics/menu/two.mp3'
import thirdTrack from '../assets/musics/menu/three.mp3'

const playgroundTracks = Object.values(import.meta.glob('../assets/maps/park/4_playground/musics/*.mp3',
  { eager: true, import: 'default', query: '?url' }))
const combatAssets = import.meta.glob('../assets/sounds/in_game/**/*.mp3',
  { eager: true, import: 'default', query: '?url' })
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

function trackFor(kind, variant) {
  const tracks = combatTracks[kind] ?? []
  return tracks[Math.floor(variant * tracks.length)]
}

export function useGameAudio(settings, menuActive, park) {
  const parkArea = computed(() => menuActive.value ? null : park.value?.area)
  const click = new Audio(clickUrl)
  const hover = new Audio(hoverUrl)
  const music = new Audio()
  const menu = { tracks: [firstTrack, secondTrack, thirdTrack], queue: [], current: null, time: 0 }
  const playground = { tracks: playgroundTracks, queue: [], current: null, time: 0 }
  const effectBuffers = new Map()
  const activeEffects = new Set()
  const fallbackEffects = new Set()
  const penaltyEffects = new Map()
  click.preload = 'auto'
  hover.preload = 'auto'
  let context
  let musicGain
  let effectsGain
  let activated = false
  let playlist
  let audioScope = 0

  function setVolume() {
    const { sfx, music: musicLevel } = settings.value
    if (context) {
      effectsGain.gain.value = sfx / 100
      musicGain.gain.value = musicLevel / 100
    } else {
      click.volume = sfx / 100
      hover.volume = sfx / 100
      music.volume = musicLevel / 100
      for (const clip of fallbackEffects) clip.volume = sfx / 100
      for (const { clip } of penaltyEffects.values()) {
        if (clip) clip.volume = sfx / 100
      }
    }
  }

  function startNextTrack() {
    if (!playlist) return
    if (!playlist.queue.length) playlist.queue = [...playlist.tracks]
    const choices = playlist.queue.length > 1 ? playlist.queue.filter((track) => track !== playlist.current) : playlist.queue
    playlist.current = choices[Math.floor(Math.random() * choices.length)]
    playlist.queue.splice(playlist.queue.indexOf(playlist.current), 1)
    playlist.time = 0
    loadTrack()
  }

  function loadTrack() {
    music.src = playlist.current
    if (playlist.time) music.currentTime = playlist.time
    playMusic()
  }

  function playMusic() {
    if (playlist && activated && music.paused) music.play().catch(() => {})
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
    const next = menuActive.value ? menu : inPlayground ? playground : null
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
    if (activated && playlist) {
      if (playlist.current) loadTrack()
      else startNextTrack()
    } else if (music.hasAttribute('src')) {
      music.removeAttribute('src')
      music.load()
    }
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

  function playCombatSounds(sounds) {
    if (!activated || menuActive.value || !settings.value.sfx) return
    const urls = sounds.map(({ kind, variant }) => trackFor(kind, variant)).filter(Boolean)
    if (context) {
      const scope = audioScope
      Promise.all(urls.map((url) => loadEffectBuffer(url).catch(() => null))).then((buffers) => {
        if (scope !== audioScope || !settings.value.sfx || context.state !== 'running') return
        const startAt = context.currentTime
        for (const buffer of buffers.filter(Boolean)) {
          const source = context.createBufferSource()
          source.buffer = buffer
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
    for (const url of urls) {
      const clip = new Audio(url)
      clip.volume = settings.value.sfx / 100
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
      effectsGain.connect(context.destination)
      musicGain.connect(context.destination)
      context.createMediaElementSource(click).connect(effectsGain)
      context.createMediaElementSource(hover).connect(effectsGain)
      context.createMediaElementSource(music).connect(musicGain)
    }
    if (!activated) {
      setVolume()
      activated = true
      if (!menuActive.value) preloadCombatSounds()
      syncPenaltySounds()
    }
    if (context && context.state !== 'running') context.resume().catch(() => {})
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
  watch([menuActive, parkArea], selectPlaylist, { immediate: true, flush: 'sync' })
  watch([menuActive, park], syncPenaltySounds, { flush: 'sync' })

  onMounted(() => {
    music.addEventListener('ended', startNextTrack)
    document.addEventListener('pointerdown', activate, true)
    document.addEventListener('keydown', activate, true)
    document.addEventListener('pointerover', playHover)
    document.addEventListener('click', playClick, true)
  })

  onUnmounted(() => {
    music.removeEventListener('ended', startNextTrack)
    document.removeEventListener('pointerdown', activate, true)
    document.removeEventListener('keydown', activate, true)
    document.removeEventListener('pointerover', playHover)
    document.removeEventListener('click', playClick, true)
    stopCombatSounds()
    for (const id of penaltyEffects.keys()) stopPenaltySound(id)
    for (const audio of [click, hover, music]) audio.pause()
    context?.close().catch(() => {})
  })

  return playCombatSounds
}
