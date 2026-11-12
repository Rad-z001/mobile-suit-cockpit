// CR-014 story: "Aboard Seawrack", the interlude that ends Chapter 2. Everything said and learned on the ship lives here:
// the people (film characters by name, plus unnamed crew), their reactive lines, the readable notices, and the Codex.
// All dialogue is original writing. ctx (built by sim/missions/aboard.js) describes how the chapters went:
//   { detections, found (Circe found Seawrack), shipHull 0..1, xiHull 0..1, armLost, partsHurt (count of damaged or
//     destroyed parts), kills }
// Line: { who, text } or a function ctx => { who, text } | null (null = skip). Node: { lines, choices?, next? }.
// Choice: { text, to (node id), codex (entry id unlocked), once (hide after picked), end (finishes the talk / chapter) }.

export const CODEX = {
  mafty: { title: 'Mafty', text: 'An armed movement on Earth that targets the officials of the Earth Federation who write and sign the forced-emigration laws. Its leader goes by the name Mafty Navue Erin. To the Federation it is a terrorist group; to the people it hides, it is the only side that fights back.' },
  manhunt: { title: 'The Man Hunters', text: 'Federation police who enforce the emigration law. Anyone living on Earth without a permit is arrested and shipped up to a space colony, often apart from their family. Whole towns are swept in a single night.' },
  seawrack: { title: 'Seawrack', text: 'A cargo freighter on paper, owned by a shipping company that does not exist. In practice it is a mobile base: it carries Mafty\'s machines, its crew, and the people they pull out of the round-ups. Its only armour is that nobody knows what it is.' },
  circe: { title: 'Circe', text: 'A Federation special unit formed to hunt Mafty, commanded by Kenneth Sleg. It flies Gustav Karls from carriers and patrol ships, keeps radar pickets at sea, and fields the Penelope. Methodical, well supplied, and patient.' },
  penelope: { title: 'RX-104FF Penelope', text: 'Circe\'s Gundam, flown by Lane Aim. A heavy flight unit wrapped around an earlier frame lets it fly and fight without a carrier. It comes from the same maker as the Xi: one machine was sold to each side.' },
  xi: { title: 'RX-105 Xi Gundam', text: 'Mafty\'s Gundam. Its built-in Minovsky flight unit lets it fly by itself, transform into a faster form, and outrun anything the Federation fields on Earth. It was delivered in secret, inside a falling cargo container, at night.' },
  gustav: { title: 'Gustav Karl', text: 'The Federation\'s standard mobile suit of this era: heavy, reliable and slow. On Earth it rides a sub-flight sled to fly. Dangerous in numbers and in the hands of a good pilot, but a generation behind the Gundams.' },
  minovsky: { title: 'Minovsky particles', text: 'Particles released by mobile suit reactors that jam radar and long-range guidance. Where they are dense, sensors go blind beyond a few kilometres, so machines close in and fight by sight. Thin them out, and the old radar pickets see far again.' },
  gawman: { title: 'Gawman Nobile', text: 'One of Mafty\'s pilots, captured by the Federation. Lane Aim brought him to the fight in the Penelope\'s hand and let him go rather than fight with a prisoner in his fist. He fell into the Xi\'s open hatch at a few hundred metres, and he will tell anyone who listens.' },
  lane: { title: 'Lane Aim', text: 'Circe\'s ace and the Penelope\'s pilot. Young, gifted, and certain he is on the right side. He handed Gawman back over open sea before he fought: he wants to beat Mafty, not win by holding a hostage.' },
  oenpeli: { title: 'Oenpeli', text: 'Gunbalanya, also called Oenpeli: an Aboriginal community in West Arnhem Land, in the north of Australia, across the East Alligator River from Kakadu. Floodplains and paperbark swamps run up to a high sandstone escarpment. A rebel group has hidden its machines in the rock country outside town and calls itself Mafty. The town has nothing to do with them.' },
  imitators: { title: 'The other Mafty', text: 'Mafty\'s name travels faster than Mafty does. Small groups across the Earth borrow it for their own fights against the emigration law. Some are bandits. Some are worth bringing in.' },
};

const said = (n) => (n === 1 ? 'once' : `${n} times`);

// People and readable notices. pos: ship model frame (bow toward -Z, deck at y = SEAWRACK.deckY; command floor = bridge
// level), feet position. area: 'deck' | 'corridor' | 'command'. kind: 'npc' (a figure) | 'sign' (a notice to read).
// look: figure style for render/aboard.js.
export const PEOPLE = [
  {
    id: 'chief', name: 'DECK CHIEF', area: 'deck', kind: 'npc', look: 'deck', pos: [10.5, 0, 6], yaw: -Math.PI / 2,
    start: 'a',
    nodes: {
      a: {
        lines: [
          (c) => (c.armLost ? { who: 'DECK CHIEF', text: 'You brought it back one arm short. I\'ll have to take something else apart to give you a new one.' }
            : c.partsHurt > 0 ? { who: 'DECK CHIEF', text: 'Scorched through the plating in places. Give me two days, and don\'t ask for one.' }
              : { who: 'DECK CHIEF', text: 'Not a mark on the armour. Don\'t get used to it, Mafty.' }),
          { who: 'DECK CHIEF', text: 'She\'s down in number two with the covers shut. Anything that flies over sees a freighter full of tractor parts.' },
          { who: 'DECK CHIEF', text: 'That flight unit is why you\'re standing here. No sled, no carrier — it just flies. Nothing down here can follow it once it\'s at speed.' },
        ],
        next: 'q',
      },
      q: {
        lines: [{ who: 'DECK CHIEF', text: 'Anything else? I\'ve got a Gundam to wash.' }],
        choices: [
          { text: 'Tell me about the Xi.', to: 'xi', codex: 'xi', once: true },
          { text: 'How good are the Gustav Karls?', to: 'gustav', codex: 'gustav', once: true },
          { text: 'Carry on, Chief.', end: true },
        ],
      },
      xi: { lines: [{ who: 'DECK CHIEF', text: 'The same people who sold Circe its Penelope built this one. Officially it doesn\'t exist. It came to us inside a cargo that fell out of the sky — you were there.' }], next: 'q' },
      gustav: { lines: [{ who: 'DECK CHIEF', text: 'Honest machines. Heavy, sturdy, slow. They need those sleds to fly at all. One is a nuisance. Five, with a good pilot in the middle, is how people die.' }], next: 'q' },
    },
  },
  {
    // he came home in the Xi's cockpit (Chapter 1): the first face on deck after the cut
    id: 'gawman', name: 'GAWMAN NOBILE', area: 'deck', kind: 'npc', look: 'gawman', pos: [3.6, 0, 20.5], yaw: Math.PI * 0.8,
    start: 'a',
    nodes: {
      a: {
        lines: [
          { who: 'GAWMAN', text: 'There he is. The man with the softest hatch in the Federation.' },
          { who: 'GAWMAN', text: 'Two hundred metres of air, and all I could think was: please don\'t let him close it early.' },
        ],
        next: 'q',
      },
      q: {
        lines: [{ who: 'GAWMAN', text: 'Go on, ask. I\'ve been locked in a room for a week, I want to talk.' }],
        choices: [
          { text: 'Why did Lane let you go?', to: 'lane', codex: 'lane', once: true },
          { text: 'What did Circe want from you?', to: 'circe', codex: 'gawman', once: true },
          { text: 'Get some rest, Gawman.', end: true },
        ],
      },
      lane: { lines: [{ who: 'GAWMAN', text: 'He said he doesn\'t fight with a man in his fist. He meant it. That\'s worse than a liar, if you ask me — he\'ll still be out there next time, and he\'ll be better.' }], next: 'q' },
      circe: { lines: [{ who: 'GAWMAN', text: 'Names. Where the Xi came from. Where this ship sleeps. I gave them the name of a bar that closed ten years ago.' }], next: 'q' },
    },
  },
  {
    id: 'emerelda', name: 'EMERELDA ZUBIN', area: 'deck', kind: 'npc', look: 'emerelda', pos: [-5.5, 0, 36], yaw: Math.PI,
    start: 'a',
    nodes: {
      a: {
        lines: [
          (c) => (c.found
            ? { who: 'EMERELDA', text: c.shipHull < 0.7 ? 'They found the ship. We\'re plugging holes in the hull with people still in the holds.' : 'They found the ship. Twelve hours of keeping our heads down, and Circe got a look at us anyway.' }
            : c.detections === 0 ? { who: 'EMERELDA', text: 'Not one ping on their boards all the way in. Whatever you did out there, do it again.' }
              : { who: 'EMERELDA', text: `Their pickets saw you ${said(c.detections)}. The captain changed course to be safe. Nobody followed you home, at least.` }),
          { who: 'EMERELDA', text: 'Iram is waiting in Command. He\'s been pacing since your signal came in.' },
        ],
        next: 'q',
      },
      q: {
        lines: [{ who: 'EMERELDA', text: 'Go on, then. Or ask.' }],
        choices: [
          { text: 'How close is Circe?', to: 'circe', codex: 'circe', once: true },
          { text: 'Who flies the Penelope?', to: 'pen', codex: 'penelope', once: true },
          { text: 'I\'m going up.', end: true },
        ],
      },
      circe: { lines: [{ who: 'EMERELDA', text: 'Close enough to keep pickets on this whole stretch of sea. Kenneth Sleg doesn\'t rush and doesn\'t waste men. He just keeps tightening the net.' }], next: 'q' },
      pen: { lines: [{ who: 'EMERELDA', text: 'Lane Aim. Young, very good, and very sure he\'s on the right side. His machine and yours came out of the same factory.' }], next: 'q' },
    },
  },
  {
    id: 'mihessia', name: 'MIHESSIA HENCE', area: 'deck', kind: 'npc', look: 'mihessia', pos: [-9.6, 0, -28.4], yaw: Math.PI / 2,
    start: 'a',
    nodes: {
      a: {
        lines: [
          { who: 'MIHESSIA', text: 'Forty-one people in hold two. The Man Hunters swept their town the night before we got them out.' },
          { who: 'MIHESSIA', text: 'Most of them were never registered anywhere. To the Federation that means they don\'t exist — until there\'s room on a shuttle.' },
        ],
        next: 'q',
      },
      q: {
        lines: [{ who: 'MIHESSIA', text: 'They keep asking me where we\'re going.' }],
        choices: [
          { text: 'Who are the Man Hunters?', to: 'mh', codex: 'manhunt', once: true },
          { text: 'Where are we taking them?', to: 'where', codex: 'seawrack', once: true },
          { text: 'Look after them.', end: true },
        ],
      },
      mh: { lines: [{ who: 'MIHESSIA', text: 'Federation police. No permit to live on Earth, and you\'re put on a shuttle to a colony you\'ve never seen. Families go to different ones. That\'s the law we\'re fighting.' }], next: 'q' },
      where: { lines: [{ who: 'MIHESSIA', text: 'Anywhere the Federation isn\'t looking. On paper we carry machine parts for a company that doesn\'t exist. As long as nobody lifts the hatch covers, we\'re a freighter.' }], next: 'q' },
    },
  },
  {
    id: 'deckhand', name: 'DECKHAND', area: 'deck', kind: 'npc', look: 'deck', pos: [10, 0, 14], yaw: -Math.PI * 0.6,
    start: 'a',
    nodes: {
      a: {
        lines: [
          (c) => (c.kills >= 4 ? { who: 'DECKHAND', text: `${c.kills} Gustav Karls! Half the deck watched it on the relay.` } : { who: 'DECKHAND', text: 'Welcome back, sir. The whole deck held its breath on the relay.' }),
          { who: 'DECKHAND', text: 'Our radar shows nothing but fuzz past a few kilometres. Minovsky particles. That\'s why you fight close enough to see the paint, isn\'t it?' },
        ],
        codex: 'minovsky',
      },
    },
  },
  {
    id: 'notice', name: 'NOTICE', area: 'corridor', kind: 'sign', pos: [-1.4, 0, 50], yaw: Math.PI / 2,
    start: 'a',
    nodes: { a: { lines: [{ who: 'FEDERATION NOTICE', text: '"EARTH IS FOR THOSE WHO BELONG TO IT. Unregistered residents will be relocated to the space colonies. Report them to your district office." (someone has scrawled MAFTY across it in red)' }], codex: 'manhunt' } },
  },
  {
    id: 'registry', name: 'REGISTRY', area: 'corridor', kind: 'sign', pos: [1.4, 0, 54], yaw: -Math.PI / 2,
    start: 'a',
    nodes: { a: { lines: [{ who: 'SHIP REGISTRY', text: 'M/V SEAWRACK. Bulk carrier. Cargo: machine parts. Owner: a shipping company with an address that turns out to be an empty lot.' }], codex: 'seawrack' } },
  },
  {
    id: 'roster', name: 'CREW ROSTER', area: 'corridor', kind: 'sign', pos: [-1.4, 0, 57], yaw: Math.PI / 2,
    start: 'a',
    nodes: { a: { lines: [{ who: 'CREW ROSTER', text: 'Forty names, handwritten. Six are crossed out. Next to Gawman Nobile someone wrote "NOT LOST" a week ago. Today, in fresh ink: "HOME".' }] } },
  },
  {
    id: 'captain', name: 'CAPTAIN', area: 'command', kind: 'npc', look: 'captain', pos: [-3.5, 0, 50.5], yaw: Math.PI * 0.15,
    start: 'a',
    nodes: {
      a: {
        lines: [
          (c) => (c.found ? { who: 'CAPTAIN', text: c.shipHull < 1 ? `They found us. ${Math.round((1 - c.shipHull) * 100)} percent of this hull is holes I have to explain to nobody. I need a day to move her where they've stopped looking.` : 'They found us. I need a day to move her somewhere they\'ve stopped looking.' }
            : { who: 'CAPTAIN', text: 'Their pickets never had us. We hold this course until dawn.' }),
        ],
      },
    },
  },
  {
    id: 'iram', name: 'IRAM MASAM', area: 'command', kind: 'npc', look: 'iram', pos: [3, 0, 50.5], yaw: -Math.PI * 0.15, briefing: true,
    start: 'a',
    nodes: {
      a: {
        lines: [
          { who: 'IRAM', text: 'Hathaway. Sit down before you fall down.' },
          { who: 'IRAM', text: 'The handover went the way we planned. The Xi is ours, and the Federation still thinks that cargo was an accident.' },
          (c) => (c.found ? { who: 'CAPTAIN', text: 'Which leaves us a ship Circe has seen. That changes the next few days.' } : { who: 'CAPTAIN', text: 'And nobody followed you home. Good.' }),
        ],
        next: 'q',
      },
      q: {
        lines: [{ who: 'IRAM', text: 'Ask what you need to. Then we talk about tomorrow.' }],
        choices: [
          { text: 'Remind me who we\'re fighting.', to: 'who', codex: 'mafty', once: true },
          { text: 'Why did the radar matter so much?', to: 'radar', codex: 'seawrack', once: true },
          { text: 'Why do the Gustavs fight so close?', to: 'mino', codex: 'minovsky', once: true },
          { text: 'What\'s next?', to: 'next', codex: 'oenpeli', once: true },
          { text: 'I\'m ready.', end: true, finish: true, needs: 'next' },
        ],
      },
      who: { lines: [{ who: 'IRAM', text: 'A government that decided the Earth belongs to a few thousand officials, and passes a new law every year to send everyone else into space. Mafty goes after the men who sign them. It is the only argument they have ever listened to.' }], next: 'q' },
      radar: { lines: [(c) => ({ who: 'CAPTAIN', text: `Because this hull is all there is. Find Seawrack and you find the people in the holds. Their pickets saw you ${c.detections === 0 ? 'not once' : said(c.detections)} today.${c.found ? ' And they found us anyway.' : ''}` })], next: 'q' },
      mino: { lines: [{ who: 'CAPTAIN', text: 'Minovsky particles. Every reactor out there sheds them, and they blind radar beyond a few kilometres. When the air is thick with them, you close in and shoot what you can see. Out here the air was thin — that\'s why the pickets were a threat.' }], next: 'q' },
      next: { lines: [
        { who: 'IRAM', text: 'Gawman is home, and Lane Aim is in the sea. That is more than I hoped for in one day.' },
        { who: 'IRAM', text: 'Next: Australia. In the rock country outside Oenpeli, in Arnhem Land, there is a group that calls itself Mafty.' },
        { who: 'IRAM', text: 'They are not us. But they have old suits, a pad hidden in the escarpment, and the same enemy. The real Mafty needs them — find their base and bring them in.' },
        { who: 'CAPTAIN', text: 'Circe patrols that coast. Expect Gustav Karls between you and them.' },
      ], codex: 'imitators', next: 'q' },
    },
  },
];

export const PEOPLE_BY_ID = Object.fromEntries(PEOPLE.map((p) => [p.id, p]));
