// society/barks.js - authored one-liners for core/society.js. Pools are chosen by role / state / time / weather / event / memory.
// Lines are short spoken barks (<= ~60 chars). {place} = settlement name, {friend} = a related neighbour. Edit freely: society.js re-imports this on reload.

export const GREET = {
  adored: ['The hero returns! Welcome back!', 'Bless you, friend of {place}!', 'There you are! We were hoping you would come.', 'Always a pleasure to see you.'],
  liked: ['Good to see you again.', 'Well met, friend.', 'Ah, the one who keeps us safe.', 'Welcome back to {place}.'],
  neutral: ['Good day to you.', 'Hello, traveller.', 'Fine weather, if it holds.', 'Mind the road, stranger.'],
  wary: ['Hm. You again.', 'Keep your hands where I can see them.', 'We want no trouble here.', 'Walk on, stranger.'],
  hostile: ['Stay away from me!', 'You! After what you did!', 'Get out of {place}!', 'Guards! Guards!'],
  child: ['Hi hi hi!', 'Look, it is you!', 'Wanna see a frog?', 'Tag! No, wait, you are too tall.'],
};

// what people say while doing their routine, by role then by state
export const WORK = {
  farmer: ['Good soil this year.', 'Mind the rows!', 'The beans want rain.', 'Back to the hoe.', 'My back says it will storm.'],
  blacksmith: ['Hot work, this!', 'Steel does not forge itself.', 'Mind the sparks!', 'One more blade before supper.'],
  merchant: ['Fine wares! Finest in {place}!', 'Potions, blades, trinkets!', 'A special price, just for you.', 'Come and browse, traveller.'],
  bard: ['Care for a song?', '~ la la la ~', '~ a tale of two knights... ~', 'Tip the bard, kind soul!'],
  villager: ['Busy day today.', 'So much to do before dark.', 'Have you seen my goat?', 'Fetch the water, carry the wood...', 'The market looks lively.'],
  guard: ['All quiet on my watch.', 'Eyes open.', 'Nothing to report.', 'Move along, citizen.'],
  child: ['Catch me!', 'You cannot catch me!', 'Tee hee!', 'Race you to the well!'],
  king: ['A king must be seen to rule.', 'Fetch me a snack.', 'My subjects adore me.', 'Hmm. Yes. Very kingly.'],
  wizard: ['The stars are unusually chatty today.', 'Hm, hm. Curious.', 'Where did I leave my staff?', 'Magic is only the art of asking properly.'],
};
export const MEAL = ['Time for a bite.', 'Bread and cheese, at last.', 'Is that stew I smell?', 'Nothing beats a hot meal.', 'Pass the salt?'];
export const EVENING = ['Lovely evening for a fire.', 'Pull up a seat.', 'Another long day done.', 'Anyone have a story?', 'The fire does warm the bones.', 'Where is the bard tonight?'];
export const SLEEPY = ['Time for bed.', 'Yawn... off to sleep.', 'Good night, all.', 'Morning comes early.'];
export const DAWN = ['Morning!', 'Another day, then.', 'Up with the sun.', 'The cockerel was right again.'];
export const TIME = {
  night: ['Who is wandering at this hour?', 'The stars are out in force.', 'Hear that? Wolves, I think.'],
  dawn: ['Smell that? Fresh bread.', 'Mist on the field this morning.'],
  dusk: ['The light is going.', 'Red sky tonight.'],
};
export const WEATHER = {
  rain: ['Rain again!', 'Get inside, it is pouring!', 'Good for the crops, bad for the hat.', 'My boots are soaked.'],
  storm: ['A proper storm! Take cover!', 'That thunder shook my teeth!', 'Get indoors, quickly!'],
  snow: ['Snow! Wrap up warm.', 'It is bitter out here.', 'Snow in my boots again.'],
  clear: ['What a day!', 'Not a cloud in sight.'],
};
export const EVENT = {
  cheer: ['Hurrah! Well struck!', 'Good riddance to it!', 'Thank you, hero!', 'That is one less to worry about.', 'Bravo!'],
  mourn: ['Oh no... not {friend}...', 'Such a waste. Such a waste.', 'Who would do such a thing?', 'Rest well, neighbour.'],
  gasp: ['By the stars!', 'Did you see that?!', 'Ooooh!', 'What in the world is that?', 'Marvellous!'],
  flee: ['Run! Run for your lives!', 'Monsters!', 'Everyone inside!', 'Help! Somebody help!', 'Save yourselves!'],
  calm: ['Is it over?', 'I think it is safe now.', 'Back to work, then.', 'That was close.'],
  weapon: ['Easy now...', 'Put that away, please.', 'We want no trouble!', 'Careful with that thing.'],
  theft: ['Thief! Stop, thief!', 'Hey! That is not yours!', 'Guards! Thief!'],
  bounty: ['The guards are after you!', 'You will hang for this!', 'There is a bounty on your head!'],
  pardon: ['The guards have forgiven you. Do not push your luck.', 'Your slate is clean. Keep it so.'],
  thanks: ['Thank you for helping us!', 'You saved us!', 'We owe you, friend.'],
  hurt: ['Ow! Why?!', 'Stop that!', 'What did I do?!'],
  buy: ['A pleasure doing business.', 'Spend it well!', 'Come again!'],
  poor: ['Come back when you can afford it.', 'Not enough gold, friend.', 'Hands off the goods, please.'],
  tier: ['{place} is looking prosperous!', 'More folk are moving in, thanks to you.'],
};
export const MEMORY = {
  helped: ['You helped me once. I have not forgotten.', 'The hero who saved us!'],
  hurt: ['You hurt me before. I remember.', 'Stay back. I know what you did.'],
  gifted: ['Still got the gift you gave me.', 'That was kind of you, last time.'],
  talked: ['We have talked before, have we not?', 'Back for more conversation?'],
  killer: ['You murderer!', 'Blood on your hands, stranger.'],
};
// pairs of small talk: a speaks, b answers about 2.5 s later. {friend} = a's related neighbour
export const CHAT = [
  { a: 'Did you hear the wolves last night?', b: 'Heard them. Barred the door twice.' },
  { a: 'Think it will rain?', b: 'My knees say yes.' },
  { a: 'Have you seen {friend} today?', b: 'Not since breakfast. Why?' },
  { a: 'That traveller is quite the fighter.', b: 'Aye. Better on our side than against.' },
  { a: 'The harvest looks promising.', b: 'If the crows leave us any.' },
  { a: 'Another quiet day.', b: 'Do not say that out loud!' },
  { a: 'Did you see the great eye in the sky?', b: 'It watches. It always watches.' },
  { a: 'Pass me that bucket, will you?', b: 'Here. Mind the hole in it.' },
  { a: 'I heard {friend} snores like a bear.', b: 'Like two bears, I heard.' },
  { a: 'What is for supper?', b: 'Whatever is left of last night.' },
  { a: 'Have you tried the ale at the tavern?', b: 'Only on days that end in y.' },
  { a: 'Strange lights over the hills lately.', b: 'Best not to wonder too hard.' },
];
// allies (combat followers) chat only when nothing is fighting
export const ALLY = ['Quiet out here.', 'Think the road is clear?', 'I could use a hot meal.', 'Stay sharp.', 'Lead on, hero.', 'Another day, another battle.'];
export const ALLY_CHAT = [
  { a: 'Quiet tonight.', b: 'Too quiet.' },
  { a: 'My blade needs sharpening.', b: 'Everything of yours needs something.' },
  { a: 'Think the village will hold?', b: 'With us around, aye.' },
];
