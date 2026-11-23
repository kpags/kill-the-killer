import { onMounted, onUnmounted, watch } from 'vue'
import clickUrl from '../assets/sounds/menu/buttons/click.mp3'
import hoverUrl from '../assets/sounds/menu/buttons/hover.mp3'
import firstTrack from '../assets/musics/menu/one.mp3'
import secondTrack from '../assets/musics/menu/two.mp3'
import thirdTrack from '../assets/musics/menu/three.mp3'

const tracks = [firstTrack, secondTrack, thirdTrack]

export function useMenuAudio(settings, menuActive) {
  const click = new Audio(clickUrl)
  const hover = new Audio(hoverUrl)
  const music = new Audio()
  click.preload = 'auto'
  hover.preload = 'auto'
  let context
  let musicGain
  let effectsGain
  let activated = false
  let currentTrack
  let queue = []

  function setVolume() {
    const { sfx, music: musicLevel } = settings.value
    if (context) {
      effectsGain.gain.value = sfx / 100
      musicGain.gain.value = musicLevel / 100
    } else {
      click.volume = sfx / 100
      hover.volume = sfx / 100
      music.volume = musicLevel / 100
    }
  }

  function startNextTrack() {
    if (!queue.length) queue = [...tracks]
    const choices = queue.filter((track) => track !== currentTrack)
    currentTrack = choices[Math.floor(Math.random() * choices.length)]
    queue.splice(queue.indexOf(currentTrack), 1)
    music.src = currentTrack
    playMusic()
  }

  function playMusic() {
    if (menuActive.value && activated && music.paused) music.play().catch(() => {})
  }

  function activate(event) {
    if (!menuActive.value || !event.isTrusted) return
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
    if (!activated) setVolume()
    activated = true
    if (context && context.state !== 'running') context.resume().catch(() => {})
    if (currentTrack) playMusic()
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
    if (!menuActive.value || !event.isTrusted) return
    activate(event)
    if (event.target.closest?.('button:not(:disabled)')) playEffect(click)
  }

  watch(settings, () => { if (activated) setVolume() }, { flush: 'sync' })
  watch(menuActive, (active) => {
    if (active) playMusic()
    else {
      hover.pause()
      music.pause()
    }
  }, { flush: 'sync' })

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
    for (const audio of [click, hover, music]) audio.pause()
    context?.close().catch(() => {})
  })
}
