import assert from 'node:assert/strict'
import test from 'node:test'
import { fireworksSceneTime } from '../src/parkFireworks.js'

test('fireworks launch and burst frames follow each recording and return to the quiet sky', () => {
  for (const [track, onset] of [['one.mp3', 400], ['two.mp3', 3020], ['three.mp3', 2900]]) {
    assert.equal(fireworksSceneTime(track, onset - 181), 900)
    assert.equal(fireworksSceneTime(track, onset - 180), 0)
    assert.equal(fireworksSceneTime(track, onset), 180)
    assert.equal(fireworksSceneTime(track, onset + 720), 900)
  }
  assert.equal(fireworksSceneTime('one.mp3', 2020), 1260)
  assert.equal(fireworksSceneTime('one.mp3', 4140), 180)
  assert.equal(fireworksSceneTime('unmarked.mp3', 4140), null)
})
