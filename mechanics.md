# Kill the Killer mechanics

## Game modes

### Last Man Standing

**Objective.** Be the last surviving player.

- At the start of the match, every player is assigned one other player as their target. Each player is also the target of exactly one killer.
- Players can blend in with the crowd or use hiding spots to stalk or surprise their target.
- A player can stun their assigned killer for three seconds. The stunned player keeps their current target, and all target assignments stay in place.
- After a player kills their assigned target, assign them a new target if the match is still active. Keep assignments one-to-one among surviving players.
- Eliminated players become spectators and can switch areas. They see all visible players and NPCs in the watched area, with the same rendering for each. Players inside hiding spots remain private.
- When two players remain, they are each other's target. The first to eliminate the other wins.

### Hitman

**Objective.** Earn the highest score in an eight-minute match.

- Each player has an assigned target. Several killers can be assigned the same target and race to eliminate them first. A player who kills their assigned target receives a new one.
- Eliminated players respawn five seconds after the lethal click. The view stays black until respawn, then fades in over 0.5 seconds. Respawn selects a random area and a valid position inside its green playable boundary, then returns control in the idle pose.
- A player can stun their assigned killer or killers for three seconds. A hunter who is stunned by their own assigned target receives a different living target when one is available. Other punches preserve target assignments.
- Each player has a three-bar Profile meter. More filled bars mean a lower profile, and lower-profile target kills award more points. The player with the highest score when time expires wins.

| Kill rating | Profile meter | Points |
| --- | --- | ---: |
| Assassin | Max (100%) | 400 |
| Hitman | 3 full bars (99%) | 300 |
| Secret Agent | 2 bars | 200 |
| Brawler | 1 bar | 100 |
| Warfreak | 0 bars | 50 |

#### Profile Meter

The meter has three bars of 33 percentage points each. The bars fill at 33%, 66%, and 99%. The final percentage point brings the meter to Max at 100%.

Each player starts the match at 33% (one full bar) in modes that use the meter. The meter resets to 0% whenever a new target is assigned after the player kills their previous target or is stunned.

The HUD shows a 100 × 15 px meter at the upper left, with dark blue, blue, and light blue segments that fill at 33%, 66%, and 99%. Segment fills animate as the value changes. At 100%, the label reads **Max**. The upper-right **Kill** card shows the assigned target's name and a crop of their stickman face.

| Player behavior | Change per second (percentage points) |
| --- | ---: |
| Standing still | +1 |
| Walking near walking NPCs | +2 |
| Standing with or near a crowd | +5 |
| Dancing near a musical object or interaction | +3 |
| Sitting | +8 |
| Sprinting | −8 |
| Walking away from walking NPCs or a crowd of NPCs | −1 |
| Entering or leaving a hiding area | −5 |

A successful nonlethal punch or stun immediately deducts 10 Profile points from the attacker, down to zero. Killing an NPC immediately deducts 20. Hitman scores assigned-target kills using the killer's Profile before reassignment resets the meter. The HUD shows the running score and briefly displays the rating from each scored kill.

### NPC rules for both modes

- Each NPC kill starts or refreshes a 10-second penalty. The penalized view is grayscale with slight blur, horizontal smearing, and distortion. The player's stickman retains its color and has a thick, pulsing red glow. Other players and spectators in the area see the red outline whenever that model is visible. At expiry, the glow stops and the grayscale, blur, smearing, and distortion fade over 0.5 seconds. With reduced motion, the glow and distortion stay steady.
- While the penalty is active, **IN PENALTY** blinks at the top of the play area in white with a thick black outline. **Blurred/Distorted Vision** and **Location Exposed to All** stay visible in grey beneath it. With reduced motion, the heading stays visible too.
- Unpenalized players and spectators see **PlayerName at AreaName** in the upper-left of the play area. Each NPC kill adds a notice that follows the player's current area and expires 10 seconds after that kill. The fourth active notice drops the oldest without clearing the associated player's personal penalty.
- A penalty follows the player through area changes, reconnects, and Hitman respawns. While waiting to respawn, notices show the previous area. Leaving the room removes that player's notices.
- Killed NPCs respawn and may use the same model or a different one.

## Stamina

- Each player has a maximum of 100 stamina points.
- Sprinting consumes 20 stamina points per second. A full meter supports five seconds of continuous sprinting.
- Players recover 10 stamina points every three seconds, up to the 100-point maximum.
- Sitting on a seat restores 30 stamina points per second, up to the 100-point maximum.
- A kill or stun consumes 30 stamina points per action.
- The blue stamina bar animates as stamina drains and recovers. It updates immediately when reduced motion is enabled.

## Player controls

| Category | Input | Action |
| --- | --- | --- |
| Movement | `W` | Move up |
| Movement | `A` | Move left |
| Movement | `S` | Move down |
| Movement | `D` | Move right |
| Movement | `Left Shift` | Sprint |
| Interactions | `E` | Interact or hide |
| Interactions | `F` | Toggle the Actions wheel |
| Mouse | Mouse movement | Move the pointer |
| Mouse | Left click | Kill or stun |
| Mouse | Hold right click | Open the Inventory wheel and hover a section to see its effect. Release to close. |
| Menu | `P` or **Pause** | Open the pause menu |
| Menu | Hold `Tab` | Open the player list dialog while held. Release to close it. In Hitman, show each player's score. In Last Man Standing, grey out eliminated players. |

## Map assets

Park is the first gameplay map. Its six areas each have two files in their folder under `assets/maps/park/`.

| File | Purpose |
| --- | --- |
| `template.gif` | Animated scene artwork used during gameplay. |
| `guides.png` | Reference image that marks area exits, playable space, interactions, hiding spots, NPC spawn spots, and objects that become transparent. |

Each guide matches its own template's dimensions. The areas use different image sizes, so guide positions are relative to their corresponding template.

## Guide legend

| Marker | Gameplay meaning |
| --- | --- |
| White filled box | Area exit. The left exit leads to the previous numbered area, and the right exit leads to the next numbered area. |
| Green outlined box | Playable space where players and NPCs can spawn and move. |
| Orange outlined box | An interaction spot. |
| Grey outlined box | A hiding spot. |
| Blue filled box | An NPC spawn spot for a small group or one NPC. |
| Wavy grey line | An object or foreground area that becomes transparent when any part of a player or NPC model passes through it, keeping the model visible. |

- **NPC spawn spots.** Each blue marker spawns one to three NPCs, chosen randomly. A lone NPC faces left or right at random and loops one randomly selected `phone_surfing` animation. Groups stand close together in distinct colors and loop all three talking clips. Two talkers always face each other. In groups of three, the outer two face inward and the middle talker faces left or right at random. Both animations play at 80% of their source speed.
- **Hiding limit.** Players can stay in a hiding spot for up to 10 seconds. When the timer expires, the player automatically exits the spot. This prevents camping.
- **Hiding preview.** Only the hiding player sees their translucent model inside the spot. The preview stands when the spot is taller than the area's standing model. It sits when the spot is the same height or shorter.

## Park

Park follows the numbered folder order from left to right. Main has only a right exit, and Carpark has only a left exit. The four areas between them have both exits.

| Order | Area | Asset folder | Orange interaction markers | Grey hiding markers |
| --- | --- | --- | --- | --- |
| 1 | Main | `1_main` | A: Buy Ice Cream. B: Right Bench. C: Left Bench. | — |
| 2 | Food Stalls | `2_food_stalls` | A: Left Bench. B: Right Bench. C: Cotton Candy. D: Takoyaki. E: Drinks. | — |
| 3 | Fountain | `3_fountain` | A: Left Bench. B: Left Middle Bench. C: Right Middle Bench. D: Right Bench. | — |
| 4 | Playground | `4_playground` | A: basketball shooting stall. B: firing range stall. C and D: speakers. | A and B: portable toilets. |
| 5 | Fireworks | `5_fireworks` | A: Left Picnic Table. B: Middle Picnic Table. C: Right Picnic Table. | — |
| 6 | Carpark | `6_carpark` | — | A: Blue Car. B: Red Car. |

The table lists the orange and grey markers in the guides. Interaction names, types, and descriptions come from the map data. Marker letters can repeat between categories, as with orange A and grey A in Playground.

Food Stalls uses the map key `food_stalls` and the asset folder `2_food_stalls`. [Park map data](data/maps/park.json)

### Park exploration

- The host can start exploration solo or with the current room roster. At match start, every player and bot is assigned a different random area and spawns inside its playable boundary. A full six-player room uses all six Park areas. Each occupied seat receives a random, unique stickman color for the session. Bots stay at their spawn points.
- Players can walk and sprint across the six areas using keyboard or touch controls. Stamina regenerates outside active sprinting. On phones, the view follows the player through areas wider than the screen.
- Use **E** or the touch **Interact** button near seats, speakers, and hiding spots. Seats use the sit pose and speakers use the dance animation. Interact again to stand, stop dancing, or exit hiding. Activity booths show information from the map data.
- Food stores play the stickman's `1_consume.gif` once over 1.35 seconds. Drinks stores play `drink.gif` once over 0.72 seconds. Players in the same area see the animation. The player eating or drinking sees a two-second floating confirmation and can move or act again when the clip ends.
- Speaker interactions loop all three dance clips in order until the player stops. Fountain's center bench fades when a model overlaps its wavy guide outline.
- Press **F** or tap **Actions** to open the six-slot wheel. **Phone**, **Talk**, **Dance**, and **Scream** each loop a randomly chosen clip until the player moves, interacts, chooses another action, or enters combat.
- Hold the right mouse button during gameplay to open **Inventory**. Hover over **Fist**, **Poison Blowgun**, **Smoke**, or **Rock** to read its effect from `data/inventory.json`. Release the button to dismiss the wheel.
- The bottom of the seated model's hips rests on the orange guide box's bottom edge, with the legs extending naturally below. The map's `seat_slots` value sets the combined capacity for players and NPCs. Each occupant takes the nearest available slot. A sitting interaction with no `seat_slots` value defaults to one slot.
- Nearby interaction prompts show **Sit**, **Hide**, **Dance**, or **Inspect** above the local player's head, with **E** on keyboard layouts or **Interact** on touch layouts. While hidden, the exit prompt and countdown appear above the player's hiding position. The inspection panel displays the interaction's name and details.
- Gameplay messages such as a full bench or blocked action rise above the local player's model in white text with a thick black outline and fade out over two seconds.
- Park artwork uses the supplied animated templates. Stickmen have transparent backgrounds and soft ground shadows. The default standing height is 83 map pixels. An area's `model_scale` multiplies that height and scales other poses with it. Carpark uses `0.8`, for a standing height of about 66 map pixels.
- Each player sees a small rainbow shadow under their own stickman's feet, including their translucent hiding preview.
- Park starts the Profile Meter at 33% and applies the behavior rates for movement, NPC proximity, seating, dancing, and hiding transitions. The proximity radius is 36 map pixels at default model scale. Entering and leaving hiding each apply the −5 rate for one second. Last Man Standing uses a shuffled, one-to-one target cycle among surviving players. Hitman allows multiple killers to share a target. A solo session without bots has no target.
- The pause menu blocks local movement and interaction while the multiplayer session continues. **Resume** returns to gameplay, **Settings** opens the audio controls, and **Exit** leaves the room. When the host exits, the room closes for everyone.
- Home Settings and the pause menu share **SFX** and **Music** sliders. Both default to 20%, and the browser saves the player's choices.
- Buttons on Home, Home Settings, and Room play hover and click sounds after the first menu interaction. Menu music continuously shuffles the three tracks and follows the Music slider. It pauses in Park and resumes when the player returns to a menu.
- Playground shuffles and loops its own music through the **Music** slider. Music starts fresh on each visit, continues during the pause menu, and stops when the player leaves Playground. Spectators hear the music of the area they watch.

### Park NPCs

- Each blue marker holds a group of up to three crowd NPCs when the session starts. The server shares NPC positions and activities with everyone in the same area.
- Each area's `walking_npcs` value sets how many walkers can be active at once, including any walkers who stop to sit or dance. An omitted value or `0` means that only the blue-marker crowds spawn.
- Walkers enter from the left or right side of the playable area at a random depth. They disappear at the opposite edge. After 5–10 seconds, the replacement enters from the side where the previous walker exited.
- Each new walker has a 30% chance to head for an available seat or music interaction along its route. A walker that finds a free seat on arrival sits for 10–90 seconds. A walker that reaches a music interaction dances for 5–60 seconds. Both continue toward their exit edge afterward. Players and NPCs share the same seat limits.
- Every 10 seconds, each area with an available food store has a 10% chance to send one randomly selected walking, talking, or phone-surfing NPC to the store. The NPC walks there, plays the eating animation once, and walks back to resume its prior activity. If a player starts eating there before the NPC arrives, the NPC heads back without eating.

- One second after a victim finishes their death animation, the living NPCs in that area turn toward the kill location and each play a random scream clip once. They then turn toward the nearest exit and sprint away. Five seconds after the last NPC flees, NPCs begin walking back from random sides at staggered times. Walkers resume their routes and crowd members walk back to their group. A crowd member uses their phone until a conversation partner arrives. Another death during the same evacuation shares the ongoing reaction.

### Implemented Park combat

- Hover over a visible, living model within 20 map pixels of the player's ground position to pulse its color to `#910123`. The pulse continues as the model animates while the pointer stays within its pose silhouette. The distance does not change with screen size, camera zoom, or model scale. Reduced motion uses a steady tint. Click or tap the opaque part of the frontmost model to attack.
- NPCs, assigned targets, and any seated player can be killed. Range for seated models uses the nearest walkable point to their seat. The attacker plays the updated `kill.gif` once at 1.3× speed (about 208ms). The victim plays `death.gif` once at 1.3× speed (about 346ms) in the direction they were facing when hit. The corpse then fades out over two seconds. A lethal attack also takes priority when both players have each other as targets.
- Killing an NPC or assigned target briefly flashes red around the killer's screen edges.
- NPC and assigned-target kills play a random `kill` sound. A full stun plays a random `pre_stun` sound on impact and a random `full_stun` sound 0.45 seconds later, when the stun begins. A quick stun plays random `pre_stun` and `quick_stun` sounds together on impact. The **SFX** slider controls these sounds, and players and spectators in the same area hear the same selected clips.
- The crowd plays one random `crowd_reaction` clip in its area when the NPCs start reacting, before they flee. Each NPC kill starts one random `penalty` clip for the penalized player and their assigned hunters. It plays continuously until the penalty expires, including when a listener changes areas. Both sounds follow the **SFX** slider.
- Hitman target kills show the white kill rating with the earned points above it, and successful stuns and punches show yellow **Stunned**. These outlined labels rise and fade above the acting player's model over 1.2 seconds and are visible only to that player.
- In Last Man Standing, an assigned-target kill shows the attacker **Target** and **Killed** on two lines in white with a 5 px black outline. The label rises from the model in 0.5 seconds, holds above it for 2 seconds, and fades over 0.3 seconds.
- Both modes show a private centered **Killed** animation to the victim of an assigned-target kill, with **By PlayerName** beneath it. The view stays black behind it until spectating in Last Man Standing or until the respawn fade begins in Hitman.
- Both modes blur and horizontally smear the victim's view while the centered **Stunned** animation stays sharp during a defensive stun, from the initial punch through the end of the stun lock. In Last Man Standing, unrelated punches show the same cue and view effect for 1.5 seconds. These overlays play three frames once at 100 ms per frame, then hold the last frame. **Killed** begins fading after 3 seconds. **Stunned** begins fading when the blur ends. Both fade over 0.3 seconds. Reduced motion shows the final overlay frame immediately.
- Clicking an assigned killer on their feet plays `punch.gif` once on the attacker and `pre-stun.gif` once (450ms) on the victim, followed by three seconds of looping `stun.gif`. In Last Man Standing, targets stay unchanged. In Hitman, the stunned killer receives a different living target when one is available.
- Clicking an unrelated player on their feet plays punch and pre-stun only, returning both players to idle after 450ms. Neither player's target assignment changes. Repeat punches cannot extend a stun. An assigned killer can still kill a stunned target.
- Combat interrupts seats, dancing, inspecting, and hiding, releases seats, and blocks movement and interaction until the sequence ends. Attacking from hiding reveals the attacker. Hidden opponents cannot be selected. Room bots participate as players, while crowd and walking NPCs are always lethal targets.
- A killed player immediately stops acting and leaves active targeting. If the match continues, anyone who lost their target to the kill has no target for three seconds. The same delay applies to a Hitman hunter who needs a new target after a defensive stun. The target portrait shows TV static during the search. Last Man Standing assigns the next player in its surviving target cycle. Hitman assigns an eligible living player as soon as one is available after the delay. Receiving a new target resets Profile to 0%. A respawn starts at 33% Profile and 100 stamina.
- Eliminated Last Man Standing players can select a spectator area after their corpse disappears and any **Killed** overlay finishes fading. They see all models visible in that area without player markers and can switch areas to observe.
- Last Man Standing stops combat when one player remains. After pending deaths and **Killed** overlays finish fading, every player sees **Winner:** above the winner's name in large white text with a thick black outline. The announcement stays centered for three seconds, then everyone returns to Home. Solo exploration does not end automatically.
- Hitman counts its five-second respawn delay from the lethal click, including death and fading. Respawn selects a random area and a position within its green playable boundary; it does not use a side-entry animation.
- Killed crowd NPCs and walkers disappear after their fade. Their replacements join the returning NPCs and reuse the original crowd or walker slots.
- The eight-minute timer and combat stamina deductions remain pending.

## Change log

- 2026-11-25 — Added the drinks-store animation and the hold-right-click Inventory wheel with item effect tooltips.

- 2026-11-25 — Cleaned the dark patches around the eating sprites' arms and added occasional NPC food-store visits.

- 2026-11-25 — Added the eating animation at food stores, muted the penalty subtitles with grey text, and applied the map's updated interaction names.

- 2026-11-23 — Added the hold-to-view player list dialog with live scores in Hitman and elimination status in Last Man Standing.

- 2026-11-23 — Added shuffled Playground music and shared combat sounds for kills, quick stuns, and full stuns.

- 2026-11-23 — Added the ten-second NPC-kill penalty and three-notice feed, expanded spectator visibility, and applied the Profile cost to all successful nonlethal punches.

- 2026-11-23 — Added Last Man Standing's two-line target kill label and private Killed and Stunned animations with a timed spectator handoff.

- 2026-11-23 — Kept the Profile Meter label on one line, moved combat feedback above the acting player, and shortened nearby prompts to action names.

- 2026-11-22 — Added nearby-model hover tinting, synchronized kills and punches, mode-specific stuns and targeting, death fading, NPC replacement, Hitman respawns within green boundaries, restricted spectating, and the Last Man Standing winner state.

- 2026-11-20 — Documented the gameplay template and guide files, Park's six-area order, the guide legend, and the marked interaction and hiding spots.
- 2026-11-20 — Updated the Food Stalls map key to `food_stalls`.
- 2026-11-20 — Documented Last Man Standing and Hitman objectives, target assignments, spectating, respawns, stuns, scoring, and shared NPC rules.
- 2026-11-20 — Added Profile Meter thresholds, starting value, gain and loss rates, and the reset rule for new target assignments.
- 2026-11-20 — Added the blue NPC spawn marker and the 10-second hiding limit.
- 2026-11-20 — Added the wavy grey line marker for objects that become transparent as player or NPC models pass through.
- 2026-11-20 — Documented keyboard and mouse controls for movement, interactions, combat, and the pause menu.
- 2026-11-20 — Added stamina capacity, recovery, and costs for sprinting, kills, and stuns.
- 2026-11-20 — Added the Last Man Standing stun rule with target assignments retained.
- 2026-11-20 — Added the Tab player list with Hitman scores and greyed-out eliminated players in Last Man Standing.
- 2026-11-20 — Implemented multiplayer Park exploration, including area travel, stamina, hiding, basic interactions, and six unique stickman colors.
- 2026-11-20 — Aligned sitting models with the updated Park guides and enforced each spot's seat capacity.
- 2026-11-20 — Kept seated sprites above the guide line and moved interaction prompts above the player.
- 2026-11-20 — Aligned the seated model's hips with the guide line using each animation frame's contact point.
- 2026-11-20 — Updated the playable boundaries in Food Stalls and Fireworks to match the revised green guide outlines.
- 2026-11-20 — Applied Carpark's model scale and added animated stamina, the pause menu, and saved audio settings.
- 2026-11-20 — Added Fountain bench transparency, looping dance clips, faster seated recovery, and private hiding previews.
- 2026-11-20 — Added synchronized Park crowds, configurable walkers, and timed NPC bench and music interactions.
- 2026-11-20 — Moved walker spawns to the sides of each area, randomized crowd facing, and slowed the talking and phone animations by 20%.
- 2026-11-20 — Made pairs of talkers face each other and required a face-to-face pair in every group of three.
- 2026-11-20 — Raised the walker interaction chance to 30%, set new sitting and dancing times, and verified the three-NPC cap per blue marker.
- 2026-11-20 — Made both outer talkers face inward in groups of three so everyone faces someone.
- 2026-11-20 — Added a private rainbow outline that follows the local player's model.
- 2026-11-20 — Moved the private rainbow marker from the model outline to a soft shadow at its feet.
- 2026-11-20 — Added the animated Profile Meter and private target portraits to the Park HUD.
