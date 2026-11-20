# Kill the Killer mechanics

## Game modes

### Last Man Standing

**Objective.** Be the last surviving player.

- At the start of the match, every player is assigned one other player as their target. Each player is also the target of exactly one killer.
- Players can blend in with the crowd or use hiding spots to stalk or surprise their target.
- A player can stun their assigned killer for three seconds. The stunned player keeps their current target, and all target assignments stay in place.
- After a player kills their assigned target, assign them a new target if the match is still active. Keep assignments one-to-one among surviving players.
- Eliminated players become spectators. Spectators can switch areas to observe and receive no live player-location indicators. They can see a player in the area they are watching when that player kills or makes a suspicious move.
- When two players remain, they are each other's target. The first to eliminate the other wins.

### Hitman

**Objective.** Earn the highest score in an eight-minute match.

- Each player has an assigned target. Several killers can be assigned the same target and race to eliminate them first. A player who kills their assigned target receives a new one.
- Eliminated players respawn after five seconds in a random area. Play the walk animation as they enter from the side of the area. Return control when they reach the playable zone.
- A player can stun their assigned killer or killers for three seconds. A stunned player receives a new target after being stunned. Confirm whether the stun makes the player who uses it or the stunned killer vulnerable to their own killers.
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
| Stunning a killer | −10 |
| Killing an NPC | −20 |

### NPC rules for both modes

- Killing an NPC exposes the killer's location for 10 seconds.
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
| Interactions | `F` | Open Actions |
| Mouse | Mouse movement | Move the pointer |
| Mouse | Left click | Kill or stun |
| Menu | `P` or **Pause** | Open the pause menu |
| Menu | `Tab` | Show the player list. In Hitman, show each player's score. In Last Man Standing, grey out eliminated players. |

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

- **NPC spawn spots.** Each blue marker spawns one to three NPCs, chosen randomly. A lone NPC faces left or right at random and loops one randomly selected `phone_surfing` animation. Groups stand close together in distinct colors and loop all three talking clips. Two talkers always face each other. Three talkers use a random arrangement with at least one face-to-face pair. Both animations play at 80% of their source speed.
- **Hiding limit.** Players can stay in a hiding spot for up to 10 seconds. When the timer expires, the player automatically exits the spot. This prevents camping.
- **Hiding preview.** Only the hiding player sees their translucent model inside the spot. The preview stands when the spot is taller than the area's standing model. It sits when the spot is the same height or shorter.

## Park

Park follows the numbered folder order from left to right. Main has only a right exit, and Carpark has only a left exit. The four areas between them have both exits.

| Order | Area | Asset folder | Orange interaction markers | Grey hiding markers |
| --- | --- | --- | --- | --- |
| 1 | Main | `1_main` | A: ice cream stall. B and C: benches. | — |
| 2 | Food Stalls | `2_food_stalls` | A and B: benches. C: cotton candy stall. D: takoyaki stall. E: drinks stall. | — |
| 3 | Fountain | `3_fountain` | A and D: benches. B and C: chairs. | — |
| 4 | Playground | `4_playground` | A: basketball shooting stall. B: firing range stall. C and D: speakers. | A and B: portable toilets. |
| 5 | Fireworks | `5_fireworks` | A, B, and C: picnic tables. | — |
| 6 | Carpark | `6_carpark` | — | A: blue car. B: red car. |

The table lists the orange and grey markers in the guides. Interaction names, types, and descriptions come from the map data. Marker letters can repeat between categories, as with orange A and grey A in Playground.

Food Stalls uses the map key `food_stalls` and the asset folder `2_food_stalls`. [Park map data](data/maps/park.json)

### Park exploration

- The host can start exploration solo or with the current room roster. Everyone spawns in Main, and each occupied seat receives a random, unique stickman color for the session. Bot players stay at their spawn points.
- Players can walk and sprint across the six areas using keyboard or touch controls. Stamina regenerates outside active sprinting. On phones, the view follows the player through areas wider than the screen.
- Use **E** or the touch **Interact** button near seats, speakers, and hiding spots. Seats use the sit pose, speakers use the dance animation, and food stalls and activity booths show information from the map data. Interact again to stand, stop dancing, or exit hiding.
- Speaker interactions loop all three dance clips in order until the player stops. Fountain's center bench fades when a model overlaps its wavy guide outline.
- The bottom of the seated model's hips rests on the orange guide box's bottom edge, with the legs extending naturally below. The map's `seat_slots` value sets the combined capacity for players and NPCs. Each occupant takes the nearest available slot. A sitting interaction with no `seat_slots` value defaults to one slot.
- Nearby interaction prompts appear above the local player's head with **E** on keyboard layouts or **Interact** on touch layouts. While hidden, the exit prompt and countdown appear above the player's hiding position.
- Park artwork uses the supplied animated templates. Stickmen have transparent backgrounds and soft ground shadows. The default standing height is 83 map pixels. An area's `model_scale` multiplies that height and scales other poses with it. Carpark uses `0.8`, for a standing height of about 66 map pixels.
- The pause menu blocks local movement and interaction while the multiplayer session continues. **Resume** returns to gameplay, **Settings** opens the audio controls, and **Exit** leaves the room. When the host exits, the room closes for everyone.
- The home screen and pause menu share **SFX** and **Music** sliders. Both default to 100%, and the browser saves the player's choices.

### Park NPCs

- Crowds spawn at the blue markers when the session starts. The server shares NPC positions and activities with everyone in the same area.
- Each area's `walking_npcs` value sets how many walkers can be active at once, including any walkers who stop to sit or dance. An omitted value or `0` means that only the blue-marker crowds spawn.
- Walkers enter from the left or right side of the playable area at a random depth. They disappear at the opposite edge. After 5–10 seconds, the replacement enters from the side where the previous walker exited.
- Each new walker has a 10% chance to head for an available seat or music interaction along its route. A walker that finds a free seat on arrival sits for 30–60 seconds. A walker that reaches a music interaction dances for 10–20 seconds. Both continue toward their original edge afterward. Players and NPCs share the same seat limits.

## Change log

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
