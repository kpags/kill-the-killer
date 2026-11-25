Original prompt: Let's create a browser game called "Kill the Killer" using Vue.js.

Refer to the assets/images/backgrounds for the background images for desktop and mobile.

Let's create a home page first. Use the mentiond images as the background. The home page should have buttons in the center, vertically and horizontally:

- Play
- Join Room
- Settings

Make the buttons be in liquid glass design. Rounded corners.

Make it mobile responsive.

## Implementation

- Added the Vue home screen with the title above the buttons and separate desktop and mobile artwork. Each button shows a three-second notice.
- Passed the production build and Chromium checks at 1440 × 900, 320 × 568, and 667 × 320. Verified mouse, touch, and keyboard activation, notice replacement and dismissal, and the short-screen scrolling layout. Reviewed the Playwright screenshots and home-screen state.

## Local room lobby

- Play opens a fresh room with the host, five empty slots, a copyable invite code, and the map picker. Park is the current map. Start is a placeholder, and Leave returns home.
- Verified the production build and inspected the lobby at 1440 × 900, 1280 × 720, and 320 × 568. Tested clipboard copying and its fallback, keyboard and touch controls, slot capacity, name edits, readiness, and room reset.

## Online room lobby

- Connected Play and Join Room to a Node WebSocket server. The server synchronizes maps, slots, names, and readiness. Human names default to Player N, counting the host and other humans. Custom names support internal spaces.
- Tested final-seat concurrency, permissions, map broadcasts, reconnect expiry, and host closure with the WebSocket tests. Verified invite-code copying, host and guest permissions, shared updates, and refresh recovery in separate desktop and mobile Chromium sessions.

## Park exploration

- Connected Start to server-authoritative Park exploration. Added all six animated areas, guide geometry, player and stationary bot colors, stamina, hiding, basic interactions, and keyboard and touch controls.
- Prepared transparent frame atlases from the supplied sprites. Regenerate them with `python scripts/prepare_park_art.py` and Pillow when the artwork changes.
- Passed all seven Node tests and the production build. Verified traversal of all six areas, touch sprinting and camera panning, session recovery, seating, dancing, hiding, and foreground transparency in Chromium. Checked alpha bounds and foot anchors on all 222 prepared player frames and reviewed screenshots across the map.
- Aligned sitting poses to the updated guide boxes and enforced the map's seat capacities. Passed all nine Node tests and verified two-person seating, full-bench feedback, reconnect retention, and seat reuse with three browser sessions.
- Removed the seated render offset and moved interaction prompts overhead. Verified sprite bounds at a bench, chair, and picnic table, plus desktop and touch prompt tracking, viewport bounds, and the hiding countdown.
- Updated seated rendering to use the hips as the contact point. Verified alignment across animation frames at Main's bench, a Fountain chair, and a Fireworks picnic table.
- Applied the revised green guide outlines to Food Stalls and Fireworks. Verified walking limits, area transitions, and nearby interactions in Chromium.
- Applied per-area model scale, animated the blue stamina bar, and added Pause and shared audio settings. Passed all ten Node tests and the production build. Verified Carpark sprite size, drain and recovery animations, reduced motion, saved settings, and host and guest exit in desktop and touch Chromium.
- Added Fountain's center-bench fade, three looping dance clips per color, 30 stamina per second while seated, and private hiding previews. Passed all 12 Node tests and the production build. Verified the dance loop and hiding privacy with two connected Chromium sessions and checked the seated preview in a short-spot fixture.
- Added synchronized NPC crowds and walkers throughout Park, including shared seat limits and timed seating and dancing. Passed all 16 Node tests and the production build. Verified shared spawns, walker replacements, both crowd animations, and Carpark's zero-walker setting in desktop and mobile Chromium.
- Moved walkers to side entrances with alternating spawn sides per slot, randomized crowd facing, and slowed talking and phone loops by 20%. Passed all 16 Node tests and the production build. Verified synchronized entrances and replacement spawns in desktop and mobile Chromium and measured both animation loop durations on the canvas.
- Made two talkers face each other and randomized three-person groups among four layouts that each include a face-to-face pair. Passed all 17 Node tests and the production build. Verified synchronized facings in desktop and mobile Chromium and checked the orientation of the sprites drawn on the canvas.
- Raised the walker interaction chance to 30%, set sitting to 10–90 seconds and dancing to 5–60 seconds, and kept each blue marker's crowd capped at three. Passed all 17 Node tests and the production build. Used a controlled draw in two Chromium clients to verify sitting, dancing, and walking again after each activity.
- Made the outer talkers in every trio face inward while the middle talker randomly faces left or right. Passed all 17 Node tests and the production build. Verified both arrangements across desktop and mobile Chromium sessions.
- Added a private rainbow outline that follows the local sprite, including its translucent hiding pose. Passed all 17 Node tests and the production build. Verified one outline per client in the same room and checked walking, sitting, and hiding in Chromium.
- Replaced the outline with a small rainbow shadow under the local player's feet. Passed all 17 Node tests and the production build. Verified one shadow per client and checked standing, walking, sitting, and hiding in Chromium.
- Added the animated 100 × 15 px Profile Meter and the private Kill card with a cropped target portrait. Park applies the documented profile rates and assigns one target per player from the active roster. Passed all 19 Node tests and the production build. Verified live fill and drain animations, reduced motion, the 320 px layout, and target updates when a player leaves in Chromium.
- Kept the Profile Meter label on one line, added private floating combat feedback, and shortened nearby prompts to action names. Passed all 48 Node tests and the production build. Verified the three feedback types across two Chromium clients, the fixed layout at 320 px, and the hiding countdown and reduced-motion fade.
- Added Last Man Standing's two-line target kill label and private Killed and Stunned overlays. Passed all 48 Node tests and the production build. Verified one-shot frames, fades, reconnect recovery, reduced motion, and the final-kill spectator handoff across three Chromium clients. Checked that interaction prompts stay clear of both label lines on desktop and mobile.
- Added the 10-second NPC-kill penalty, private grayscale and red glow, and a room-wide three-notice FIFO. Expanded spectator visibility while keeping hiding private, and applied the 10-point Profile cost to both defensive stuns and unrelated punches. Passed all 50 Node tests and the production build. Verified FIFO, movement between areas, reconnect and expiry, both viewport sizes, and spectator rendering in Chromium.
- Added Hitman's defensive-stun cue, stun blur, penalty distortion and fade, and the death blackout with a 0.5-second respawn fade. Passed all 50 tests and the production build. Verified both fades, the centered stun cue, and the mobile spectator handoff in connected Chromium clients.
- Added the private Killed animation to Hitman target deaths. Passed all 50 tests and the production build. Verified the held frame, cue fade, and five-second respawn in connected desktop and mobile Chromium clients.
- Strengthened stun blur, added horizontal smearing during stuns and NPC penalties, and showed the killer's name beneath the Killed animation in both modes. Passed all 50 tests and the production build. Verified sharp stun art, the smudge fade, and the private killer credit in connected desktop and mobile Chromium clients.
- Added menu button sounds and a continuously shuffled three-track playlist. Both volume sliders default to 20% and preserve saved choices. Passed all 50 tests and the production build. Verified track endings, mute, saved levels, touch clicks, and pausing and resuming music around gameplay in Chromium.
- Added shuffled Playground music and area-wide combat sounds. Passed all 51 Node tests and the production build. Verified track changes, walking and spectating across areas, both volume sliders, shared kill and stun clips, silence in other areas, and reconnect behavior across four Chromium clients. Reviewed the room and Playground screenshots and found no browser errors.
- Added the hold-Tab player list with live Hitman scores and greyed-out Last Man Standing eliminations. Passed all 52 Node tests and the production build. Verified hold and release, focus loss, pause-menu navigation, and the 320 px spectator layout in connected Chromium clients. Reviewed screenshots and found no browser errors.
- Added transparent food animations for all six colors, grey penalty subtitles, and the updated interaction names. Passed all 55 Node tests and a production build that emitted all six atlases. Checked all 54 sprite frames for transparent padding and verified synchronized eating, private feedback, and penalty styling in two connected Chromium clients.
- Refined the eating sprite masks to remove dark arm patches and added 10% NPC food-store visits every 10 seconds per eligible area. Passed all 57 Node tests and the production build. Reviewed all 54 cleaned frames and verified a synchronized NPC trip, eating clip, and return to phone use across two Chromium clients.
- Regenerated the yellow idle sprite from the updated source PNG. Verified its transparency and alignment, checked the in-game sprite and target portrait in two Chromium clients, and confirmed the production build packaged the updated asset.
- Regenerated nine updated green stickman poses. Reviewed all 73 frames for clean transparency and clipping, verified gameplay movement, seating, and the target portrait in Chromium, and confirmed all 57 tests passed and the production build included all nine sprites.
- Added drinks-store animations for all six colors and a hold-right-click Inventory wheel with four data-driven tooltips. Passed all 57 tests and the production build. Verified shared drinking across two Chromium clients, all tooltip text, release and focus-loss cleanup, pause behavior, and the compact landscape layout.
- Added four illustrated inventory slots and the yellow equipped Fist outline. Verified image order, placement, and wheel compatibility in desktop, portrait, and landscape Chromium. All 57 tests and the production build passed.
- Equipped the last hovered inventory item on right-button release and moved the yellow outline with it. Verified release outside the wheel, re-opening without a hover, and pause and blur cancellation in Chromium. All 57 tests and the production build passed.
