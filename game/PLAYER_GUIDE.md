# Iron Coffin: Player Guide

You are a pilot sealed inside a mobile suit cockpit. The cockpit is dark, the armour is heavy, and the sky is full of missiles. This guide covers how to get the suit running and how to stay alive in it.

## Starting the game

1. Open a terminal in the `game` folder and run `npm install` once.
2. Run `npm start`, then open http://localhost:5173 in your browser.
3. Click the screen. This starts audio and captures the mouse. Press Esc to release the mouse.

## Missions

Single player is the story. The mission pick shows:

- **Story, Chapter 1: Midair handover.** Board the Xi, start it up, release, fight two waves at dusk, then the Penelope
  arrives with Gawman (see "Story" below). Chapter 2 follows straight on, without an end screen.
- **Chapter 3: Oenbili.** Appears once you have finished the briefing aboard Seawrack.
- **Continue, Chapter 2: Return to Seawrack.** Appears once you have reached Chapter 2. It restarts at the Chapter 2
  checkpoint with the Xi as it was when Chapter 1 ended. The hull is topped up to at least half.

See "Story" below. The older missions are no longer on the menu but still work from a direct link:
`#mission=waves` (Intercept, three waves at dusk) and `#mission=gawman` (the old night Gawman Retrieval, below).

**SPEED SYNC (catching Gawman).** Once Gawman jumps and you are within 1.5 km of him, the flight computer matches your
speed to his fall by itself. If you are in flight form it drops you to hover first (flight form cannot fly that slowly),
and you cannot go back to flight form until he is caught. The panel on the right shows SPEED SYNC, a bar while it
engages and LOCKED once the speeds match. It never flies you to him: you close the gap. Your thrust is counted relative
to him and gets gentler the closer you are, so holding the stick toward him slows the approach by itself. While the
hatch is not fully open you cannot push into him.

**How to catch Gawman** (Gawman Retrieval, `#mission=gawman`)

1. Close on Penelope. She is a neutral carrier: she does not fight and you cannot target her. Gawman jumps when you are within about 450 m of her, or after 60 seconds.
2. Watch his fall. The flashlight is the only light on him, and the HUD marks him with a triangle, his distance and his closing speed.
3. Open the hatch with **H** and slow to his speed. The catch ring shows the point in front of the hatch where he must arrive.
4. Put the catch ring on him. He is caught when he is within about 6 m and your relative speed is under 8 m/s, with the hatch fully open.
5. Close the hatch with **H** after he is aboard. The mission is complete when the hatch is sealed.

He is lost if he falls below about 30 m, or if he hits the hull: too fast, or touching a closed hatch. The end screen offers **RETRY** (the same mission) and **MENU**.

## Cold start

The cockpit boots in four stages. Press **Enter** (or gamepad **Y**) to advance each one.

The cold start begins with the hatch open: you look down the white hatch tunnel at the outside. The first Enter closes and locks the hatch (you hear it seal), then the stages below run as normal.

| Stage | What you see and hear |
| :--- | :--- |
| 0 | Hatch open, looking down the tunnel. Pitch black inside, only the tritium switches glow. |
| 1 | The harness clamps down. The reactor hum starts. |
| 2 | A cyan diagnostic sweep runs across the monitors. |
| 3 | The panoramic monitor fades in. The drive whine becomes audible. |
| 4 | Startup is complete and the battle begins. |

## How movement works

The suit is a mobile suit, not a jet. In hover it holds position and stops by itself when you stop asking for thrust. Movement is full 6-axis and always relative to the suit's own body.

- **W / S** move forward and back. **A / D** strafe left and right.
- **Space** moves toward the top of your seat and **Left Ctrl** toward the floor, even when you are rolled or upside down.
- **Q / E** roll left and right. The roll stays where you leave it; roll back yourself. There is no pitch limit, so loops are possible.
- **Left Shift** boosts. Boost is faster but heats the thrusters, so use it in short bursts.
- A warning **PULL UP** appears with a tone when you are less than 3 seconds from hitting the sea. Hitting it at speed is fatal.

## Flight form

Press **G** to transform into the Minovsky flight form. Press it again to return to hover.

- Transforming takes 2 seconds (1.4 seconds back) and cannot be cancelled. Your weapons are offline and you are slower while it happens, and there is a 3 second wait before the next change.
- Flight form flies like a jet: always forward, never below 150 m/s, with wide, heavy turns. Use it to close distance or escape; fight in hover.
- The rifle and vulcan fire only in a small cone ahead of the nose. Funnel missiles still work in any direction. The saber and shield are not available.
- If the backpack is destroyed, flight form is lost for the rest of the mission.

## The hatch

The cockpit hatch is the opening in front of you. Press **H** in flight to open it, and again to close it.

- Unlocking takes about 0.8 seconds, opening about 1.8 seconds and closing about 1.6 seconds. A press during a transition is queued, not lost.
- While the hatch is open, the rifle, funnel missiles and beam saber are locked. Head vulcans still work.
- The view ahead is the tunnel, and the world shows through its far end and the side monitors.
- With the hatch open, the air roars past. Above **120 m/s** you get a **WIND** warning and the suit buffets. Above 200 m/s the buffeting damages the hull. Close the hatch to slow down.
- Holding **X** to blow the hatch (eject) still works as before.

## How aiming works

The mouse moves the **crosshair**. The crosshair aims the beam rifle and the head.

- The crosshair stays where you leave it. Inside the central zone the suit holds its facing and the rifle arm tracks the crosshair.
- Push the crosshair outward and the suit turns that way, faster the further out it is.
- While the crosshair rests in the central zone, the suit slowly turns to bring it back to the centre of the screen.
- Hold **Alt** to look around with your head only. The crosshair does not move while you do this.
- There is no lock-on for the rifle. A small **lead marker** shows where to aim to hit the target nearest the crosshair.

## Keyboard and mouse

| Action | Control |
| :--- | :--- |
| Move forward / back | **W** / **S** |
| Strafe left / right | **A** / **D** |
| Rise / descend (body axes) | **Space** / **Left Ctrl** (hold) |
| Roll left / right | **Q** / **E** (hold) |
| Boost | **Left Shift** (hold) |
| Aim the crosshair | Move the mouse |
| Look around (head only) | Hold **Alt** and move the mouse |
| Fire beam rifle / saber slash | **Left mouse button** |
| Head vulcans | Hold **Right mouse button** |
| Reload E-Pack | **R** |
| Rifle / beam saber | **1** / **2**, or the mouse wheel |
| Shield | Hold **B** |
| Funnel missiles | **F** (press) |
| Flare / chaff | **C** |
| Flight form (hover / Minovsky) | **G** |
| Sensor mode (optical / night / thermal) | **N** |
| Zoom (1x, 3x, 8x) | **Z** |
| Eject hatch lever | Hold **X** (see Damage and ejecting) |
| Start-up switches | **Enter** |
| Open / close cockpit hatch | **H** |
| Outside view (third person) | **V** |
| Pause | **P** |

## Gamepad

Plug in an Xbox or PlayStation style pad. Keyboard and mouse still work at the same time.

| Action | Control |
| :--- | :--- |
| Move (strafe / forward and back) | Left stick |
| Aim the crosshair | Right stick (hold it to keep turning the crosshair) |
| Rise / descend | Hold A / Hold B |
| Roll left / right | Hold D-pad left / right |
| Boost | Right trigger (RT) |
| Fire beam rifle / saber slash | Hold RB |
| Vulcans | Hold Left trigger (LT) |
| Shield | Hold LB |
| Reload E-Pack (and start-up switches) | Y |
| Rifle / saber swap | Right stick click (R3) |
| Funnel missiles | X |
| Flight form | Left stick click (L3) |
| Sensor mode | D-pad down |
| Flare / chaff | D-pad up |
| Pause | Start |
| Eject hatch lever | Hold Back / Select |

Zoom has no gamepad button; use **Z**.

## Weapons

- **Beam rifle.** Slow, heavy single shots that go exactly where the crosshair points. Each E-Pack holds **15 shots**. Press **R** to swap packs at any time (2 seconds, no firing); an empty pack swaps itself. Packs are unlimited.
- **Beam saber.** Press **2** (or the wheel) to draw it. Left mouse slashes anything within about 40 m of the crosshair. Press **1** to go back to the rifle.
- **Head vulcans.** Hold **right mouse**. Weak against mobile suits, but they shoot down incoming missiles and strip enemy heads quickly.
- **Funnel missiles.** The enemy nearest the crosshair (within a small cone) locks automatically after a moment. Press **F** to send the salvo at it. No lock, no launch.
- **Shield.** Hold **B** to block beams and missiles from the front. You move slower and cannot fire the rifle or saber while it is up; vulcans and funnels still work. Hits from behind or the side get through.

## Incoming missiles

Every enemy missile heading for you is marked with a **red diamond** showing its range and time to impact. Missiles off-screen or behind you show as **red arrows** at the screen edge. Shoot them down with the vulcans, block them with the shield, or flare (C).

## Parts damage

Your suit has six parts besides the cockpit core. Hits land on a part depending on the direction they come from: front hits find the head and arms, hits from behind find the backpack and missile pods, low hits find the legs. **Broken parts are never repaired.**

| Part | When damaged or destroyed |
| :--- | :--- |
| Head | Radar and target readouts degrade; destroyed = no vulcans, no lead marker |
| Right arm | Rifle less accurate; destroyed = rifle lost, saber still works from the left hand (weaker) |
| Left arm | Shield weaker; destroyed = no shield |
| Legs / thrusters | Slower movement and turning |
| Backpack | Flight form slower; destroyed = no flight form, no beam barrier |
| Missile pods | Fewer funnel missiles; destroyed = no funnels |

Your last working weapon always holds together, so you are never left unarmed. Only the core (hull) can end the mission. The right-hand sub-monitor shows the suit outline: cyan is fine, amber is damaged, red is destroyed.

Enemies break too. Shoot off a Gustav Karl's gun arm and it stops firing beams; take its head and it aims badly. An enemy with no weapons left will try to ram you, and one badly hurt and crippled will flee and come back 20 seconds later, still broken.

## Outside view

Press **V** to toggle a third-person chase view that follows your suit from behind. Press **V** again to return to the cockpit.

## Sensors

- **Sensor modes** change how the panoramic screen shows the world: optical (default), night vision, and thermal. Cycle them with **N**.
- **Zoom** cycles between 1x, 3x and 8x telephoto with **Z**.

## Warnings

- **Caution** alerts are shown on the HUD. Read them, but you have time.
- **Warning** alerts come with an alarm. Something is wrong with the suit.
- **Missile alarm** means a missile is on an intercept course. Shoot it down, shield, flare or boost away.
- **PULL UP** means you are about to hit the sea.
- **Sector losses** mean part of the panoramic screen is dead. You will see static and black panels.

## G-force and blackout

Hard turns and high speed push blood away from your head. Watch for:

- **Breathing** gets heavier and louder when the G-load passes about 4.5 g.
- **Blackout** darkens the edges of your vision and muffles all sound. Stop thrusting hard and let the suit settle to recover.

## Damage and ejecting

- Your **hull** drops as the suit takes hits. When it reaches zero the suit is disabled, you lose control and fall.
- Hold **X** (or Back / Select on a gamepad) to pull the manual hatch lever. Keep holding until the hatch blows and the screen changes.

## Tips

- Fight in hover, travel in flight form.
- Face your enemies: the shield only covers the front, and your backpack is on the back.
- Keep an eye on the red diamonds. Two vulcan hits kill a missile.
- If your gamepad feels unresponsive, press any button on it once. The game switches to whichever device you used last.

## Multiplayer

Fight friends over the internet, 2 to 4 pilots. Multiplayer is in the same page as single player: on the start screen choose **MULTIPLAYER** instead of **SINGLE PLAYER**.

**Host or join**
- Type a callsign (up to 12 letters, digits, space, `_ - .`). Pick a suit, then press **HOST GAME**. You get a six-character room code; **COPY CODE** puts it on the clipboard.
- Friends type the code under **OR JOIN A ROOM** and press **JOIN**. Codes are not case sensitive.
- Everyone presses **READY** in the room. The host presses **START MATCH** once everyone is ready (PvP needs at least 2 pilots; 5 s countdown).
- When the match starts, click **CLICK TO BOARD**. Press Esc to free the mouse; click **CLICK TO RETURN** to get back in. **LEAVE MATCH** exits the match.

**Modes** (chosen by the host in the room)
- **Free-for-all**: every pilot for themselves. First to the score limit (default 10 kills), or most kills when the time limit ends (default 8 minutes).
- **Team**: pick TEAM A or TEAM B in the room. Team kills count. Friendly fire is off.
- **Co-op vs AI**: all pilots fight AI waves together. Clear every wave to win; if every pilot is down at once, you lose.
- In Free-for-all and Team, **AI enemies in the field** adds AI Gustav Karls that attack everyone.
- The host also sets the score limit, the time limit (minutes) and the respawn delay (seconds).

**Suits**
- **GUSTAV KARL** (selectable): shield, missile pods on **F** (salvo of four, eight carried, regenerating), beam rifle, beam saber, head vulcans, flares. No flight form: **G** shows NOT EQUIPPED, so you fight in hover only.
- **PENELOPE** (selectable): flight form on **G**, funnel missiles on **F**. No shield.
- **XI GUNDAM** (selectable): flight form on **G**, funnel missiles on **F**, and shield on **B**. Single player always flies Xi.

**Respawn**
- When your suit is destroyed, the monitors go dark and a countdown runs. Your suit comes back at a new spawn point away from enemies with full parts and hull, and you are protected for two seconds.

**Scoreboard**
- Hold **Tab** to see the scoreboard: pilot names, teams, kills, deaths and ping.

**Limits**
- Pilots connect directly to each other. Some networks (mobile data, some corporate or school networks) block direct connections, and then the match may not connect. Trying another network or a different Wi-Fi often helps.
- Online play is peer-to-peer only. If the page you opened blocks the public matchmaking relays, rooms will not connect; use the standalone `dist/iron-coffin.html` hosted on a free static host instead.
- To play with anyone for free, host the single file `dist/iron-coffin.html` on a free static host (GitHub Pages, itch.io or Netlify) and share that link.
- There is no anti-cheat. Play with friends.

## Story — Chapter 1: Midair handover

Pick the STORY card in single player. You start on foot in the dark airlock of the cargo that carries the Xi. There is no
time limit: take as long as you like.

| Step | Controls |
|---|---|
| Look around | Mouse |
| Walk | W A S D |
| Run | Shift (hold) |
| Skip the outside shot | Enter |

Walk up to the hex door and it opens. Go down the gangway; the Xi stands in the bay at the end. When you reach the end of
the gangway you board automatically: you see the cargo from outside for a few seconds, then you are in the cockpit. Run
the cold start with Enter four times, as in the other missions. After the release you are in the battle, and you can
watch the empty cargo fall and explode on the sea ahead of you and below.

**The Penelope.** After two waves of Gustav Karls a fast contact comes in: the Penelope, flown by Lane Aim. She takes
station above and ahead of you and holds her fire: she has Gawman in her hand. Hold your fire too, slow down and open the
hatch (**H**). Lane lets Gawman go; catch him with SPEED SYNC (above), then close the hatch. A few seconds later Lane
attacks: shoot the Penelope down and Chapter 2 begins. A checkpoint is saved when she arrives: if Gawman is lost, or you
are shot down, RETRY starts there, not in the airlock.

## Story — Chapter 2: Return to Seawrack

Fly home to the carrier ship Seawrack, about 42 km away. A checkpoint is saved when the chapter begins: if you fail,
RETRY starts here, not in the airlock.

- **Finding the way.** The SEAWRACK bracket (an arrow at the edge when it is off screen) points to the ship. The left
  console screen becomes a NAV map: Seawrack in green, the three enemy radar pickets as red squares with their radar
  circles, enemies as red chevrons. The big digits are the distance to Seawrack in km.
- **Radar.** Inside a picket's circle and above about 300 m, the picket sees you and the meter under the radio line fills
  (RADAR PAINT, two quick pips). Below 300 m it reads UNDER RADAR and the meter drains. Closer to a picket the meter fills
  faster. Flight form (G) fills it twice as fast. Within about 1.8 km of a picket even low flight is seen.
- **Detected.** When the meter is full: DETECTED, an alarm, and two Gustav Karls launch from that picket after you. This
  can happen three times.
- **Never lead them home.** Seawrack is found if you are detected within about 10 km of it, or if an enemy gets within
  about 6 km of it. A strike group of three Gustav Karls then attacks the ship. Its hull bar appears under the SEAWRACK
  bracket. If Seawrack sinks, the chapter fails. Undefended, it lasts about two minutes.
- **Coming home.** Fly to within about 1.2 km of Seawrack with no enemy within about 6 km of you and no strike group
  alive, and the game takes over: the covers of hold two open, the Xi goes down inside to hide, and the covers close.
  Enter skips the scene.

## Interlude — Aboard Seawrack

1. **In the hold.** After the landing shot you are back in the cockpit, in the closed hold. The gantry comes out from
   the forward bulkhead to the Xi's chest. When it is on, press **H** to open the hatch.
2. **The gantry.** You step out onto the gantry in front of the Xi. Walk back along it (W) to the bulkhead door; it
   takes you up the stair and out of the hold access house onto the deck.
3. **To Command.** Walk the deck to the door under the bridge, then the corridor and the lift.

| Action | Controls |
|---|---|
| Look around | Mouse |
| Walk / run | W A S D / Shift |
| Talk to someone, read a notice | Look at them and press Enter |
| Next line | Enter |
| Pick an answer | W / S, then Enter |

- **The crew.** On deck: the deck chief by the hold, a deckhand, Emerelda Zubin near the bridge door, and Mihessia
  Hence at the hold access house forward, with the people you rescued. In the corridor: three notices on the walls. All
  of it is optional, and what they say depends on how Chapter 2 went (detections, whether Seawrack was found, damage to
  your suit).
- **Codex.** Some answers and notices add an entry to the Codex (a toast says CODEX UPDATED). Reread them from the
  single-player menu: CODEX.
- **Command.** Walk up to the map table and the briefing starts with Iram Masam and the Captain. Ask what you like; once
  you have asked "What's next?", "I'm ready." ends Chapter 2 and unlocks **Chapter 3: Oenbili**. The end screen
  shows your time, detections, Seawrack's hull and a CHAPTER 3 button.
- **Gawman** is home: he waits on deck near where you arrive and has a word about Lane Aim.

## Story — Chapter 3: Oenbili

Oenbili is the film's name for Gunbalanya (formerly Oenpelli), an Aboriginal community in West Arnhem Land, in the far
north of Australia. The land in the game is an approximation of the real country, compressed to fit: the Van Diemen
Gulf coast with mangroves and mud flats, floodplains and billabongs, the East Alligator River, and the sandstone
escarpment and its gorges. The town itself is only ever seen from a distance; the fighting stays away from it.

1. **Hold two.** You start on foot inside Seawrack's closed hold. Walk the gantry (W) to the Xi's open chest hatch. The
   deck chief and Gawman are by the bulkhead door if you want a word.
2. **Cold start in the hold.** Enter four times as usual. After the last step the gantry pulls back to the bulkhead,
   the hold covers open and the Xi rises out.
   A checkpoint is saved here: RETRY restarts just out of the hold.
3. **To the coast.** Fly south-east to the COAST marker. A Circe patrol of three Gustav Karls comes out to meet you:
   shoot them down.
4. **The signal.** Follow the SIGNAL marker into the stone country. It shows a bearing, not a distance; the meter
   rises as you get closer, and reads weaker if you fly high.
5. **The pad.** Within a few kilometres the rebels show themselves (green smoke). Land on their pad: come down low over
   it and slow right down, then hold it there until the bar fills. You cannot land while a hostile is within about 5 km.
6. **The talk.** Parked on the pad, their leader talks to you over the radio: Enter for the next line, W / S and Enter to
   pick an answer. While parked the Xi does not fly or fire.
7. **The last wave.** Four Gustav Karls come in over the stone country from the east. The rebels' three old suits (BILI-1
   to 3) take off and fight beside you. Shoot the wave down to finish Chapter 3.

The ground is solid here: scraping a hillside costs some hull (a TERRAIN warning) but does not kill you. The hover form's
ground assist looks ahead along your track, so it climbs before a ridge. Shots stop when they hit the hills.

