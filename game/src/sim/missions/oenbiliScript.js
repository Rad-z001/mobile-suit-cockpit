// Story Chapter 3 "Oenbili": what the rebels at the pad say. The leader is an original, fictional character; all lines
// are original writing. Same node format as aboardScript.js: node { lines, choices?, next?, codex? }, a line is
// { who, text }, a choice { text, to?, codex?, once?, needs?, end?, finish? }. A 'finish' choice ends the talk and starts
// the last wave (sim/missions/oenbili.js).

export const PLACE = 'Oenbili';

export const LEADER = {
  id: 'leader', name: 'CORA VESSEY', start: 'a',
  nodes: {
    a: {
      lines: [
        { who: 'CORA VESSEY', text: 'So the real Mafty does exist. Half of us were sure we made you up.' },
        { who: 'CORA VESSEY', text: 'Eleven people, four machines older than the Federation\'s paperwork, and a pad no satellite has found in nine years.' },
      ],
      next: 'q',
    },
    q: {
      lines: [{ who: 'CORA VESSEY', text: 'You flew a long way. Say what you came to say.' }],
      choices: [
        { text: 'Why do you call yourselves Mafty?', to: 'why', codex: 'imitators', once: true },
        { text: 'What do you fly?', to: 'fly', once: true },
        { text: 'Who are your people?', to: 'who', once: true },
        { text: 'Come with us. Join the real Mafty.', to: 'join' },
      ],
    },
    why: { lines: [
      { who: 'CORA VESSEY', text: 'Nobody comes when you sign a letter with your own name. They come for Mafty. Even the Man Hunters slow down when they see it painted on a wall.' },
      { who: 'CORA VESSEY', text: 'We borrowed it. I always meant to give it back.' },
    ], next: 'q' },
    fly: { lines: [
      { who: 'CORA VESSEY', text: 'Three Gustav Karls the Federation wrote off after a wet season flood, and a fourth we built out of what was left. They fly. Mostly.' },
    ], next: 'q' },
    who: { lines: [
      { who: 'CORA VESSEY', text: 'Mechanics, a nurse, two pilots who quit the Federation, a schoolteacher. People the emigration law had a seat on a shuttle for.' },
      { who: 'CORA VESSEY', text: 'The town over the river has nothing to do with us. We keep it that way. That is the first rule here.' },
    ], next: 'q' },
    join: {
      lines: [
        { who: 'CORA VESSEY', text: 'Nine years hiding in this rock, waiting for someone to tell us it meant something.' },
        { who: 'CORA VESSEY', text: 'If the real thing is asking — then we\'re in. Where do we—' },
        { who: 'BILI-2', text: 'Cora! Circe — four Gustavs, coming in over the stone country from the east!' },
        { who: 'CORA VESSEY', text: 'They followed you in. Up, Mafty. Let\'s show them what old machines can do.' },
      ],
      choices: [{ text: 'Lift off. Stay on my wing.', end: true, finish: true }],
    },
  },
};
