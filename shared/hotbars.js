// Hotbars. Three bars; Tab cycles them. The game also switches you to the
// combat bar when combat starts and back to whatever you had when it ends,
// unless you've pinned a bar manually since.

export const HOTBARS = ['combat', 'utility', 'social'];
export const COMBAT_TIMEOUT = 6; // seconds without dealing/taking damage

export const UTILITY_ACTIONS = {
  interact: { name: 'Interact', icon: '✋' },
  potion: { name: 'Drink Grog', icon: '🧪' },
  bank: { name: 'Bank All', icon: '🏦' },
  recall: { name: 'Recall', icon: '🏠' },
};

export const EMOTES = {
  wave: { name: 'Wave', icon: '👋', text: 'waves.' },
  laugh: { name: 'Cackle', icon: '🤣', text: 'cackles.' },
  dance: { name: 'Jig', icon: '💃', text: 'does a jig.' },
  point: { name: 'Point', icon: '👉', text: 'points.' },
  taunt: { name: 'Raspberry', icon: '😛', text: 'blows a raspberry.' },
  sit: { name: 'Squat', icon: '🪑', text: 'squats down.' },
};

export function defaultHotbars() {
  return {
    combat: ['dodge', 'punch', null, null, null, null, null, null],
    utility: ['interact', 'potion', 'bank', 'recall', null, null, null, null],
    social: ['wave', 'laugh', 'dance', 'point', 'taunt', 'sit', null, null],
  };
}

export function nextBar(current) {
  return HOTBARS[(HOTBARS.indexOf(current) + 1) % HOTBARS.length];
}
