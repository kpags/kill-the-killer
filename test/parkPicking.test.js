import assert from 'node:assert/strict'
import test from 'node:test'
import { combatPlaybackRate } from '../shared/combat.js'
import { frameAt, hoverOpacity, pickModel } from '../src/parkPicking.js'

test('one-shot animations hold their final frame while repeating poses loop', () => {
  const atlas = { duration: 450, durations: Array(9).fill(50) }
  assert.equal(frameAt(atlas, -5, true), 0)
  assert.equal(frameAt(atlas, 49, true), 0)
  assert.equal(frameAt(atlas, 50, true), 1)
  assert.equal(frameAt(atlas, 449, true), 8)
  assert.equal(frameAt(atlas, 450, true), 8)
  assert.equal(frameAt(atlas, 5000, true), 8)
  assert.equal(frameAt(atlas, 450), 0)
  assert.equal(frameAt(atlas, 500), 1)
})

test('kill frames advance at 1.3× and still hold the final frame', () => {
  const atlas = { duration: 270, durations: Array(9).fill(30) }
  const rate = combatPlaybackRate('kill')
  assert.equal(frameAt(atlas, 24 * rate, true), 1)
  assert.equal(frameAt(atlas, 184 * rate, true), 7)
  assert.equal(frameAt(atlas, 185 * rate, true), 8)
  assert.equal(frameAt(atlas, 208 * rate, true), 8)
  assert.equal(frameAt(atlas, 500 * rate, true), 8)
})

test('picking respects opaque pixels, mirrored/scaled sprites and authoritative ground positions', () => {
  const local = { id: 'self', area: 0, x: 100, y: 290, life: 'alive' }
  const actor = { id: 'other', area: 0, x: 109, y: 290, groundX: 120, groundY: 290, facing: -1, life: 'alive', opacity: 1 }
  const mask = (_, x, y) => x === 90 && y === 100 ? 255 : 0
  assert.equal(pickModel([actor], local, { x: 104, y: 274 }, 0.5, mask), 'other')
  assert.equal(pickModel([actor], local, { x: 109, y: 274 }, 0.5, mask), null)
  actor.groundX = 120.01
  assert.equal(pickModel([actor], local, { x: 104, y: 274 }, 0.5, mask), null)
  actor.groundX = 120
  actor.life = 'dying'
  assert.equal(pickModel([actor], local, { x: 104, y: 274 }, 0.5, mask), null)
  actor.life = 'alive'
  local.life = 'eliminated'
  assert.equal(pickModel([actor], local, { x: 104, y: 274 }, 0.5, mask), null)
})

test('the frontmost opaque model blocks picking through it, including the local model', () => {
  const local = { id: 'self', area: 0, x: 100, y: 290, facing: 1, life: 'alive' }
  const behind = { ...local, id: 'behind', x: 105 }
  const front = { ...behind, id: 'front', x: 106 }
  const point = { x: 106, y: 250 }
  assert.equal(pickModel([behind, front], local, point, 1, () => 255), 'front')
  assert.equal(pickModel([behind, local], local, point, 1, () => 255), null)
  assert.equal(pickModel([behind, front], local, point, 1, (actor) => actor.id === 'front' ? 0 : 255), 'behind')
  front.groundX = 121
  assert.equal(pickModel([behind, front], local, point, 1, () => 255), null)
  front.hidden = true
  assert.equal(pickModel([behind, front], local, point, 1, () => 255), 'behind')
})

test('hover survives an animation gap without making transparent pixels clickable', () => {
  const local = { id: 'self', area: 0, x: 100, y: 290, life: 'alive' }
  const actor = { id: 'walking', area: 0, x: 120, y: 290, facing: 1, life: 'alive' }
  const point = { x: 122, y: 250 }
  let opaque = true
  const alphaAt = (model, x, y) => (model !== actor || (opaque && x === 82 && y === 92)) ? 255 : 0
  const hoverId = pickModel([actor], local, point, 1, alphaAt)
  assert.equal(hoverId, 'walking')
  assert.equal(hoverOpacity(0, false), 0.5)
  assert.equal(hoverOpacity(250, false), 1)
  assert.equal(hoverOpacity(750, false), 0)
  assert.equal(hoverOpacity(750, true), 0.8)

  opaque = false
  const retained = { id: hoverId, contains: (_, x, y) => x === 82 && y === 92 }
  const behind = { ...actor, id: 'behind' }
  const blocker = { ...actor, id: local.id }
  assert.equal(pickModel([actor], local, point, 1, alphaAt), null)
  assert.equal(pickModel([behind, actor], local, point, 1, alphaAt, retained), hoverId)
  assert.equal(pickModel([actor, blocker], local, point, 1, alphaAt, retained), null)
  assert.equal(pickModel([actor], local, { ...point, x: 123 }, 1, alphaAt, retained), null)
  assert.equal(pickModel([actor], local, null, 1, alphaAt, retained), null)
  actor.groundX = 120.001
  assert.equal(pickModel([actor], local, point, 1, alphaAt, retained), null)
  actor.groundX = 120
  actor.hidden = true
  assert.equal(pickModel([actor], local, point, 1, alphaAt, retained), null)
})

test('a seated model can be picked from 20 pixels past its walkable approach point', () => {
  const local = { id: 'self', area: 2, x: 167, y: 265 }
  const actor = { id: 'seated', area: 2, x: 167, y: 235, groundY: 218, facing: 1, pose: 'sit' }
  const point = { x: 167, y: 195 }
  assert.equal(pickModel([actor], local, point, 1, () => 255), 'seated')
  local.y = 265.01
  assert.equal(pickModel([actor], local, point, 1, () => 255), null)
})
