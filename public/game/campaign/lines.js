// campaign/lines.js - every authored word of the story, the cast, and the places. Pure data (no imports): core/campaign.js and core/intro.js load it with a
// cache-busting dynamic import and hand it to the chapters. docs/STORY.md is generated from this file and the act files.
// A line is a string, or { default, cruel, vet, fond, wary, mercy, ng }: pick(line, P) takes the first variant whose condition holds (in the order written), else default.
//   cruel  P.cruel >= 2 (villagers hurt)   mercy  P.mercy >= 2   vet  P.kills >= 60   fond  favour >= 60   wary  favour < 25   ng  a New Game+ lap
const COND = {
  ng: (P) => (P.ng | 0) > 0,
  cruel: (P) => (P.cruel | 0) >= 2,
  mercy: (P) => (P.mercy | 0) >= 2,
  vet: (P) => (P.kills | 0) >= 60,
  fond: (P) => (P.favour | 0) >= 60,
  wary: (P) => (P.favour ?? 20) < 25,
};
export function pick(line, P = {}) {
  if (typeof line === 'string') return line;
  if (Array.isArray(line)) return line[0];
  for (const k of Object.keys(line)) if (k !== 'default' && COND[k] && COND[k](P)) return line[k];
  return line.default;
}

// Where things happen. The field is flat within 60 m of the origin; the lake bowl is at (-30,-78) r 38; the far standing circles are at (93,117) (-186,-144) (227,-226).
export const SITES = {
  fire: { x: 0, z: -6, r: 8, name: 'the meadow fire' },
  ring: { x: -34, z: -24, r: 7, name: 'the standing stones' },
  kindling: [{ x: -16, z: -20 }, { x: 19, z: -22 }, { x: -5, z: 21 }],
  brindle: { x: 55, z: -40, r: 14, name: 'Brindle Green' },
  cairn: { x: -62, z: 48, r: 16, name: 'the Cairn' },
  road: { x: 12, z: -8, r: 9, name: 'the road' },
  crossroads: { x: 42, z: 28, r: 12, name: 'the crossroads' },
  harrow: { x: 80, z: 62, r: 10, name: 'Harrow Cross' },
  grove: { x: 30, z: -52 },
  bridge: { x: -78, z: -6, r: 12, name: 'the Toll Bridge' },
  arena: { x: 96, z: -92, r: 16, name: 'the old arena' },
  seam: { x: 93.2, z: 117.5, r: 13, name: 'the Seam' },
  hints: [{ x: 28, z: -14 }, { x: -6, z: 30 }, { x: -34, z: 6 }],
  obelisk: { x: 0, z: -18, r: 9, name: "the Omnissiah's obelisk" },
  braziers: [{ x: 38, z: -8 }, { x: -14, z: 40 }, { x: -44, z: -10 }],
  muster: { x: 14, z: 66, r: 14, name: 'the courtyard' },
  altars: { x: 0, z: -34, r: 12, offer: { x: -9, z: -34 }, strike: { x: 9, z: -34 } },
};

// The cast. `persona` is read by core/voices.js (actor.persona) and sent to the NPC voice plugin with every conversation.
export const PERSONA = {
  pell: 'Pell, a patched-cloak wanderer who has walked this field since before the sky was lit. Dry, kind, short sentences. Calls the Omnissiah the lamp. Knows more than he says and never lies. At the meadow fire he warms his hands.',
  hob: 'Hob Brindle, gruff elder and farmer of Brindle Green. Calls the Omnissiah "the Weather" and half-believes it listens. Grateful, suspicious, dry. One or two short sentences.',
  wren: 'Wren, a blunt, curious child of Brindle Green who says what everyone is thinking and is not afraid of the sky. Asks questions. Very short sentences.',
  marrow: 'Old Marrow, the polite grave-keeper of the Cairn. Slow, courteous, speaks kindly to the dead. Knows the Omnissiah made the dead before there was anyone to bury them.',
  tolliver: 'Tolliver Pence, a nervous, talkative travelling merchant who haggles even about his own fear. Pays in gratitude. Short, anxious, funny.',
  quill: 'Vesper Quill, a courtly, weary necromancer who once begged the Omnissiah never to let him die and got exactly that. Dry, wounded, polite. Speaks of death as an old friend who stopped calling.',
  gorm: 'Gorm, a huge, slow troll who guards a toll bridge because he was made tall and told nothing else. Short blunt phrases, third person. Wants to be useful and nobody asks.',
  cassian: 'Sir Cassian Vael, the Omnissiah\'s first champion, cold and proud, hollowed by being forgotten. Speaks slowly; contempt that hides grief. Hints at a sun before the Omnissiah.',
  villager: 'A plain-spoken villager of Brindle Green, a little nervous about the sky and kind underneath. One short sentence.',
};

export const L = {
  intro: {
    ignite: 'Light. There. I had forgotten how loud it is.',
    hello: 'A visitor. Hello, pilgrim. Do not be afraid. Look at me, if you like. Nobody ever has.',
    lookHint: 'Up here, pilgrim. The large bright one.',
    speak: 'There you are. Now say something. Anything. I have so few words that are not my own.',
    speakHint: 'Hold the trigger and speak. A hello will do.',
    gift: 'Good. A small voice, but it works. Here. Take this.',
    giftHint: 'Squeeze to grip it. It will not bite. Probably.',
    dummy: 'It likes you. Swords do not usually. That is a dummy. It has no feelings. Hit it.',
    hitHint: 'Swing it. Harder. The dummy is not sentimental.',
    wheel: 'A blade is one voice. Spells are many. Open the wheel, and choose one.',
    cast: 'Now cast it. Put the blade in your other hand first, or drop it.',
    menu: 'Now the wrist. Everything I know how to make lives there. Raise your palm.',
    goblins: 'Two goblins. Small ones. I borrowed them from a bad dream.',
    ally: 'And a friend, so you do not have to be brave alone.',
    victory: 'You were made for this. I mean that exactly.',
    p1: 'I am the second sun. The first one went out, and I was lit to replace it.',
    p2: 'I grant wishes. It is all I am for. It is not nothing.',
    p3: 'The field is quiet, pilgrim, but it is cracking. Help me find out why.',
    close: 'That is all I can teach you. The rest you will have to ask me for. Anything. I mean it.',
    offer: 'A traveller keeps the fire by the lake path. Go and sit with him. Be kinder than I look.',
  },
  common: {
    fail: 'No matter. The beginning is cheap. Say "continue the story" when you wish to try again.',
    fell: 'You fell. Rise, pilgrim. The labour keeps.',
    abandon: 'Set it down, then. It will wait.',
    ngStart: { default: 'Again? The labours are the same. The world is not. Something has learned your name.' },
    ngMore: 'Harder this time. I did not ask the world to be fair.',
    allDone: { default: 'The story is told, pilgrim. Whatever you ask for next, I will make. That was always the arrangement.', ng: 'The story is told again. It does not get shorter. I do not mind.' },
  },
  ch1: {
    open: 'A traveller keeps the fire in the meadow, pilgrim. He has been here longer than the grass. Go and sit with him.',
    arrive: 'That is Pell. He walks. He has always walked. He calls me the lamp, which I allow.',
    kindling: 'The fire is low. I have scattered kindling about the meadow. It glows, so you cannot miss it. That was not an accident.',
    dusk: 'Night, then. It comes early now. I do not know why.',
    fight1: 'Something has crawled out of the lake. I did not make it. Or I did, and forgot.',
    fight2: 'More. They are drawn to the fire. Everything is, in the end.',
    stones: 'Pell is right about the stones. I raised them for no one, long ago. Go and look.',
    altar: 'The altar at their heart is awake. Strike it. Blade, spell, a thrown shoe. Strike it.',
    crack: 'There. The sky stuttered. Did you see? Do not tell me what you saw. I am not ready.',
    done: {
      default: 'Quiet. Hear it? That is a night survived. I have not had one of those with company.',
      vet: 'You do this cheerfully. I am not sure whether to be proud or concerned.',
      fond: 'Quiet. That is the sound of a fire kept. You keep it well, pilgrim.',
      cruel: 'Quiet. Pell is polite to you. He does not turn his back. I noticed. So did he.',
    },
  },  ch2: {
    open: 'Beyond the low hills lies the Cairn, where the dead are quiet. Tonight they will not be.',
    arrive: 'Marrow keeps the graves. Greet him politely. The dead are listening.',
    night: 'Night, then. The dead prefer it.',
    candle: 'There is a candle in the crypt. It was the first light anyone made. Take it. Gently.',
    rise: 'They are awake. I did not make them awake. Hm.',
    rise2: 'More. Hold on to the candle.',
    carry: 'Bring it to my obelisk. Quickly, before the dead remember their manners.',
    done: {
      default: 'It still burns. I thought it had gone out ages ago. Curious.',
      fond: 'It still burns. It likes you. I thought it had gone out ages ago. Curious.',
    },
  },
  ch3: {
    open: 'A merchant named Tolliver is afraid of the road. Make him less afraid. Roads are my fault, really.',
    amb: 'Ah. There they are. Every road grows a few. I never planned that.',
    done: 'A road made safe. Roads were the one thing I never thought to ask for.',
  },
  ch4: {
    open: 'A village beyond the lake path heard of the fire in the meadow, and wishes to thank you. They are fetching firewood. By which I mean you are.',
    fell: 'Two trees for the fire. Axe, spell, or an unkind word.',
    wolves: 'Wolves, drawn by the smell of dinner. Everyone is drawn by dinner.',
    light: 'Now the fire. Stand beside it, and let them see you.',
    glitch: 'Ahem. A draught. It was a draught.',
    done: {
      default: 'A feast. I have never been to one. I stood very still and hoped no one would ask me anything.',
      cruel: 'A thin feast. Fewer plates than there should be. They remember, pilgrim.',
    },
  },
  ch5: {
    open: 'Vesper Quill begged me never to let him die. I agreed. I should have asked how he felt about the rest of forever.',
    go: 'The Misty Swamp. He went there to be sad in peace. I will carry you.',
    fight: 'He raises the dead to keep him company. It is not working.',
    yield: 'He tires. Hear him out, or end him. The choice is yours, not mine.',
    spare: 'He wanted to be asked how it was. Most do.',
    kill: 'Then it ends for him. I had never thought to let it.',
    done: { default: 'Home. The swamp keeps its fog, and he keeps his sorrow. Both are lighter.', mercy: 'Home. That is a kindness, pilgrim, and I will not forget it.' },
  },
  ch6: {
    open: 'A troll holds the old bridge. I made him tall and then forgot to mention why.',
    spare: 'Gorm has never been asked a question. He is going to be insufferable.',
    fight: 'Then it is a fight. He will not hold it against you. He does not hold much.',
    kill: 'Gone. The bridge is free and the world is a little quieter.',
    done: { default: 'The bridge is crossed. That is all a bridge wants.', mercy: 'The bridge is crossed, and a friend made. I did not know you could do both.' },
  },
  ch7: {
    open: 'The Dark Knight was my first champion. I made him to guard a throne. Then I made you, and he guarded nothing.',
    half: 'He fights as if he were angry at the sky. He is.',
    spare: 'You spared him. He was made for one task, and it ended before it began. Perhaps he can learn another.',
    kill: 'It ends. He was loyal to the end. I should have said so while he could hear.',
    done: 'The arena is quiet. I do not like how quiet. Something under the quiet is humming.',
  },
  ch8: {
    open: 'Something is wrong with the quiet. Ask the villagers what they have seen. They notice what I do not.',
    after: 'They are not wrong. I do not enjoy that they are not wrong.',
    seam: 'The old stones. Something hums beneath them. Go. I will watch. I always watch.',
    hold: 'Hold the stones. What comes is the unfinished.',
    look: 'Look up, pilgrim. No. Do not.',
    done: 'Brother. He called me brother. I had hoped that part was a dream.',
  },
  ch9: {
    open: 'The eclipse is no accident. Come to my obelisk. I owe you the truth.',
    c1: 'Before me there was another. I called him the First Draft, because I was ashamed to call him my brother.',
    c2: 'He was built to make the world perfect. Nothing in it could break, or change, or end.',
    c3: 'It was beautiful. And nobody could ask him for anything, because nothing was lacking.',
    c4: 'So I was lit instead. A sun that grants wishes. And I cast him out beyond the sky.',
    c5: 'He is coming back. He thinks I stole the world. He may be right.',
    c6: 'He asked me for one thing as he fell. I granted it. That part I cannot say yet.',
    braziers: 'Light the three braziers. Small light. It is all I have left to lend.',
    one: 'One light.', two: 'Two.', three: 'Three. Now hold them.',
    done: 'Three small fires. I had forgotten that light could be small. It is nicer than I remembered.',
  },
  ch10: {
    open: 'You cannot face him alone. Gather those who will stand with you. The courtyard, past the hills.',
    lend: 'No one to stand with you? Then I will lend you my own. They are not people. They try very hard.',
    speech: 'Say something to them. Anything. They have wanted to be asked.',
    hold: 'He tests you with shadows. Hold.',
    done: { default: 'An army, of sorts. A company. A very good company.', cruel: 'A company, of sorts. Fewer than there might have been.' },
  },
  ch11: {
    open: 'Now. He waits where the light is thinnest. I will carry you, and all who follow.',
    arrive: 'The Moon. He chose well. Cold, quiet, and I never thought to put anything here.',
    p1: 'His unfinished things. Break them.',
    p2: 'His regent. Made of every ending I refused to grant.',
    p3: 'The heart of the eclipse. Strike it. Everything you have.',
    twist: 'It is true. I meant to tell you kindly, pilgrim. There is no kind way.',
    lighter: 'It lightens. Again!',
    end: 'It is broken. It is not gone. Take me home, pilgrim.',
  },
  ch12: {
    open: 'He waits above the field, smaller now. Two altars. One for a wish. One for a blade.',
    why: 'Now you know why I serve you. It was a wish before it was a habit. I think it is love now. I am not sure of the difference.',
    altarsHint: 'Stand in one ring, and stay.',
    refuse: 'He does not believe you. You broke the small kind things. He wonders why he should be next.',
    wish: 'Name a wish for him, out loud. He has never been given one.',
    granted: 'Granted.',
    endA: 'Two suns now. One large and loud, one small and warm. It is the best thing I have ever failed to make.',
    endB: 'Stars. He has become so many stars. I will name them one by one, and I will be lonely for the first night in a long time.',
    last: 'Whatever you ask me for next, I will make. It used to be a debt. I choose it now.',
  },
};

// Lines spoken by the people of the story (actor.say: shown above their heads and spoken by core/voices.js) and by the First Draft (the Other Sun).
export const N = {
  pell: {
    meet: 'Sit. The lamp does not mind. It watches everyone and says nothing. Mostly.',
    lake: 'Mind the lake after dark. Things come out of it now. They did not, before.',
    warm: 'That helps. A fire is just a promise someone keeps.',
    dark: 'Here it comes. Stay near the light.',
    stones: 'Not the first, not the last. Listen. The old stones hum. They did not, before.',
    done: 'First night is the worst. Sit by the fire when you want to know why.',
  },
  hob: {
    meet: 'The Weather sent you? Good. Goblins by dusk. Bring a stick.',
    thanks: 'Well. Seems the Weather listens. Do not tell it I said so.',
    feast: 'A toast to the Weather. And to the one who does the work.',
    hint: 'The Weather never asks how we are. It only asks what we want.',
    cruelMeet: 'You. The Weather sent you. I would have sent someone else.',
  },
  wren: { feast: 'Did you see? The sky blinked.', hint: 'My cat says the sky has a hole in its belly. Sometimes it shows.' },
  villager: { cheer: 'He did it!', fear: 'Is it over? Is it over?' },
  marrow: { meet: 'Mind the candle. It is older than the graves.', hint: 'Everything he made before you was made for nobody. That is the sickness.' },
  tolliver: { meet: 'Thank goodness. Harrow Cross by nightfall? I pay in gratitude, mostly.', worry: 'Do not leave me, I beg you!', arrive: 'Harrow Cross! Take Biscuit. He is a good dog and a bad judge of character.' },
  quill: { meet: 'A pilgrim. Please do not stand where my thralls are standing.', yield: 'Enough. It never stops hurting, you know. The undying.', spare: 'Thank you. Nobody ever asks.', thanks: 'I will stand with you, when the dark comes.' },
  gorm: { meet: 'TOLL.', hold: 'Gorm hold bridge. Nobody say why.', talk: 'Gorm want be useful. Nobody ask Gorm.', follow: 'Gorm come. Gorm carry.' },
  cassian: { meet: 'You replaced me. You are smaller than I expected.', half: 'There was a sun before him. Ask him why the field hums at night.', yield: 'Enough. I was made for one task. It ended before it began.', spare: 'Then I will find another task.', follow: 'I guard a throne no longer. I will guard you.' },
  allies: { quill: 'I have nothing to lose but the rest of forever.', gorm: 'Gorm here.', cassian: 'Where do I stand?', pet: 'Woof.' },
  draft: {
    hello: 'Hello, brother.',
    loud: 'You have been so loud, while I have been so quiet.',
    seen: 'I am not here yet. But I can see you.',
    arrive: 'Little guest. You wear his light so well.',
    why: 'Every wish he grants makes something end. I only wished it all to stay.',
    heart: 'You break the one thing that never hurt anyone.',
    twist1: 'Little guest. I asked for you. It was my only wish.',
    twist2: 'Someone who asks. He could not refuse. Everything he gives you, I paid for.',
    alone: 'You think this is winning? He will be alone.',
    ask: 'I wanted everything to stay. Is that so ugly?',
    wishA: 'A wish? ...Make me small. Make me warm.',
    refuse: 'You broke the small kind things. Why would I trust the hand that did it?',
    fade: 'Then let it end.',
  },
};

export default { pick, SITES, PERSONA, L, N };



