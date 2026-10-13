import { ABILITIES, resolveCost } from '/shared/abilities.js';
import { ZONES, WORLD, zoneAt, SERVICES } from '/shared/zones.js';
import { ENEMIES } from '/shared/enemies.js';
import { HOTBARS, UTILITY_ACTIONS, EMOTES, nextBar } from '/shared/hotbars.js';
import { RARITIES, AFFIXES, AFFIX_GATES, WEAPON_TYPES, affinityLevel, affinityXpFor, upgradeChance, stackLabel, itemPower, activeAffixes } from '/shared/items.js';
import { SKILLS, TRADE_CAP, xpForLevel } from '/shared/skills.js';
import { attributePointCost } from '/shared/progression.js';
import { ATTRIBUTE_TOTAL_CAP } from '/shared/stats.js';
import { RECIPES } from '/shared/crafting.js';
import { ventureBonus } from '/shared/loot.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#game');
const ctx = canvas.getContext('2d');
const mini = $('#minimap');
const mctx = mini.getContext('2d');

let ws = null;
let myId = null;
let self = null; // private state
let snap = null;
let prevSnap = null;
let snapAt = 0;
let local = { x: 0, y: 0 }; // predicted position
const keys = new Set();
const mouse = { x: 0, y: 0, down: false };
const floaters = [];
let activeBar = 'combat';
let barBeforeCombat = null;
let manualDuringCombat = false;
let wasInCombat = false;
let assigning = null; // ability/emote/utility id waiting for a slot click
let openPanel = null;
let zoneInfo = null;
let zoneBannerUntil = 0;

// ------------------------------------------------------------ network

function connect(name) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join', name }));
  ws.onmessage = (ev) => onMessage(JSON.parse(ev.data));
  ws.onclose = () => log('Disconnected from server.', 'warn');
}

function send(m) {
  if (ws?.readyState === 1) ws.send(JSON.stringify(m));
}

function onMessage(m) {
  switch (m.t) {
    case 'error':
      $('#login-err').textContent = m.text;
      break;
    case 'welcome':
      myId = m.id;
      $('#login').hidden = true;
      $('#login').style.display = 'none';
      $('#hud').hidden = false;
      break;
    case 'self':
      self = m;
      renderHotbar();
      if (openPanel) renderPanel();
      break;
    case 'snap':
      prevSnap = snap;
      snap = m;
      snapAt = performance.now();
      if (!prevSnap || m.me.dead || Math.hypot(local.x - m.me.x, local.y - m.me.y) > 120) {
        local.x = m.me.x;
        local.y = m.me.y;
      }
      onCombatEdge(m.me.inCombat);
      break;
    case 'zone':
      zoneInfo = m;
      zoneBannerUntil = performance.now() + (m.warning ? 9000 : 4000);
      if (m.discovered) log(`Discovered ${ZONES.find((z) => z.id === m.zone).name}: +${m.wisdom} wisdom`, 'reward');
      if (m.warning) log(m.warning, 'warn');
      break;
    case 'msg':
      log(m.text, m.kind);
      break;
    case 'chat':
      if (m.from) log(`<b>${esc(m.from)}:</b> ${esc(m.text)}`, 'chat', true);
      else log(esc(m.text), 'sys', true);
      break;
    case 'emote': {
      const e = EMOTES[m.id];
      log(`${esc(m.name)} ${e.text}`, 'sys', true);
      floaters.push({ x: 0, y: 0, follow: m.who, text: e.icon, color: '#fff', t: 0, life: 1.8, size: 26 });
      break;
    }
    case 'hit': {
      const text = m.dodged ? 'dodged' : m.heal ? `+${m.amt}` : `${m.amt}${m.crit ? '!' : ''}`;
      const color = m.dodged ? '#9fe0ff' : m.heal ? '#7dff7d' : m.onPlayer ? '#ff6b5b' : m.crit ? '#ffd23f' : '#ffffff';
      floaters.push({ x: m.x + (Math.random() - 0.5) * 20, y: m.y - 20, text, color, t: 0, life: 0.9, size: m.crit ? 18 : 14 });
      break;
    }
    default:
      break;
  }
}

// ------------------------------------------------------------ helpers

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function log(text, kind = 'info', html = false) {
  const el = document.createElement('div');
  el.className = kind;
  if (html) el.innerHTML = text;
  else el.textContent = text;
  const box = $('#log');
  box.appendChild(el);
  while (box.children.length > 120) box.firstChild.remove();
  box.scrollTop = box.scrollHeight;
}

function camera() {
  return { x: local.x - canvas.width / 2, y: local.y - canvas.height / 2 };
}

function mouseWorld() {
  const c = camera();
  return { x: mouse.x + c.x, y: mouse.y + c.y };
}

function onCombatEdge(inCombat) {
  if (inCombat && !wasInCombat) {
    if (activeBar !== 'combat') {
      barBeforeCombat = activeBar;
      activeBar = 'combat';
      renderHotbar();
    }
    manualDuringCombat = false;
  } else if (!inCombat && wasInCombat) {
    if (barBeforeCombat && !manualDuringCombat) {
      activeBar = barBeforeCombat;
      renderHotbar();
    }
    barBeforeCombat = null;
  }
  wasInCombat = inCombat;
}

// ------------------------------------------------------------ input

function slotAction(i) {
  if (!self) return;
  const id = self.hotbars[activeBar][i];
  if (!id) return;
  useAction(id);
}

function useAction(id) {
  const w = mouseWorld();
  if (ABILITIES[id]) {
    let ax = w.x;
    let ay = w.y;
    if (id === 'dodge') {
      const d = moveDir();
      if (d.x || d.y) {
        ax = local.x + d.x * 100;
        ay = local.y + d.y * 100;
      }
    }
    send({ t: 'cast', id, ax, ay });
  } else if (UTILITY_ACTIONS[id]) send({ t: 'util', id });
  else if (EMOTES[id]) send({ t: 'emote', id });
}

function basicAttack() {
  if (!self) return;
  const order = ['slash', 'stab', 'staff_bolt', 'shoot', 'smash', 'punch'];
  const id = order.find((a) => self.abilities.includes(a));
  if (id) useAction(id);
}

function moveDir() {
  let x = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
  let y = (keys.has('s') ? 1 : 0) - (keys.has('w') ? 1 : 0);
  const l = Math.hypot(x, y);
  return l ? { x: x / l, y: y / l } : { x: 0, y: 0 };
}

const chat = $('#chat');
window.addEventListener('keydown', (e) => {
  if (document.activeElement === $('#name')) {
    if (e.key === 'Enter') $('#play').click();
    return;
  }
  if (document.activeElement === chat) {
    if (e.key === 'Enter') {
      if (chat.value.trim()) send({ t: 'chat', text: chat.value });
      chat.value = '';
      chat.hidden = true;
      chat.blur();
    } else if (e.key === 'Escape') {
      chat.hidden = true;
      chat.blur();
    }
    return;
  }
  if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'SELECT') return;
  const k = e.key.toLowerCase();
  if (k === 'tab') {
    e.preventDefault();
    activeBar = nextBar(activeBar);
    if (wasInCombat) manualDuringCombat = true;
    renderHotbar();
    return;
  }
  if (k === 'enter') {
    chat.hidden = false;
    chat.focus();
    e.preventDefault();
    return;
  }
  if (k === 'escape') {
    assigning = null;
    closePanel();
    return;
  }
  if (k === ' ') {
    e.preventDefault();
    useAction('dodge');
    return;
  }
  if (/^[1-8]$/.test(k)) return slotAction(+k - 1);
  if (k === 'e') return send({ t: 'util', id: 'interact' });
  if (k === 'q') return send({ t: 'util', id: 'potion' });
  if (k === 'c') return togglePanel('character');
  if (k === 'i') return togglePanel('inventory');
  if (k === 'k') return togglePanel('skills');
  if (k === 'b') return togglePanel('bank');
  if (k === 'm') return togglePanel('market');
  if (k === 'u') return togglePanel('workshop');
  keys.add(k);
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());
canvas.addEventListener('mousemove', (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
});
canvas.addEventListener('mousedown', (e) => {
  if (e.button === 0) {
    mouse.down = true;
    basicAttack();
  }
});
window.addEventListener('mouseup', () => (mouse.down = false));
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

let lastInput = '';
let lastHeld = 0;
setInterval(() => {
  if (!snap) return;
  const w = mouseWorld();
  const aim = Math.atan2(w.y - local.y, w.x - local.x);
  const m = { t: 'input', up: keys.has('w'), down: keys.has('s'), left: keys.has('a'), right: keys.has('d'), aim: Math.round(aim * 100) / 100 };
  const s = JSON.stringify(m);
  if (s !== lastInput) {
    send(m);
    lastInput = s;
  }
  // Holding LMB repeats the basic attack.
  if (mouse.down && performance.now() - lastHeld > 120) {
    lastHeld = performance.now();
    basicAttack();
  }
}, 50);

$('#play').onclick = () => {
  const name = $('#name').value.trim();
  if (name) connect(name);
};
$('#name').focus();

// ------------------------------------------------------------ hotbar

function actionInfo(id) {
  if (ABILITIES[id]) return { icon: ABILITIES[id].icon, name: ABILITIES[id].name };
  if (UTILITY_ACTIONS[id]) return UTILITY_ACTIONS[id];
  if (EMOTES[id]) return EMOTES[id];
  return null;
}

function renderHotbar() {
  if (!self) return;
  const label = $('#hotbar-label');
  label.textContent = activeBar;
  label.className = activeBar;
  const bar = self.hotbars[activeBar];
  const el = $('#hotbar');
  el.innerHTML = '';
  bar.forEach((id, i) => {
    const s = document.createElement('div');
    s.className = 'slot';
    const info = id && actionInfo(id);
    if (!info) s.classList.add('empty');
    if (id && ABILITIES[id] && !self.abilities.includes(id)) s.classList.add('unusable');
    s.innerHTML = `<span class="key">${i + 1}</span>${info ? info.icon : ''}<div class="cd" hidden></div>`;
    s.dataset.id = id || '';
    s.onclick = () => {
      if (assigning) {
        send({ t: 'hotbar', bar: activeBar, slot: i, id: assigning });
        assigning = null;
        return;
      }
      slotAction(i);
    };
    s.oncontextmenu = (e) => {
      e.preventDefault();
      send({ t: 'hotbar', bar: activeBar, slot: i, id: null });
    };
    s.onmouseenter = () => id && showTip(s, tipFor(id));
    s.onmouseleave = hideTip;
    el.appendChild(s);
  });
}

function tipFor(id) {
  const a = ABILITIES[id];
  if (!a) return actionInfo(id)?.name || id;
  const cost = resolveCost(a, { maxHealth: snap?.me.maxHp || 100 }, {});
  const parts = [];
  if (cost.mana) parts.push(`${cost.mana} mana`);
  if (cost.stamina) parts.push(`${cost.stamina} stamina`);
  if (cost.health) parts.push(`${cost.health} health`);
  let req = '';
  if (a.requires) req = `Requires ${Object.entries(a.requires).map(([k, v]) => `${k.toUpperCase()} ${v}`).join(', ')}`;
  if (a.source === 'weapon') req = `${WEAPON_TYPES[a.weapon].label}, unlock score ${a.unlock}`;
  const dmg = a.damage ? `Damage: ${a.damage.base}${a.damage.weapon ? ` + ${a.damage.weapon}x weapon` : ''}${a.damage.scale ? ' + ' + Object.entries(a.damage.scale).map(([k, v]) => `${v}x${k.toUpperCase()}`).join(' + ') : ''}` : '';
  return [`${a.icon} ${a.name}`, parts.join(', ') || 'free', `Cooldown ${a.cooldown}s`, dmg, req, a.taunt ? 'Taunts nearby enemies' : '', a.threatDrop ? 'Halves your threat nearby' : '', a.threatMult ? `Threat x${a.threatMult}` : '']
    .filter(Boolean).join('\n');
}

const tip = $('#tooltip');
function showTip(el, text) {
  tip.textContent = text;
  tip.hidden = false;
  const r = el.getBoundingClientRect();
  tip.style.left = `${Math.min(window.innerWidth - 290, r.left)}px`;
  tip.style.top = `${r.top - 10 - tip.offsetHeight}px`;
}
function hideTip() {
  tip.hidden = true;
}

function updateHud() {
  if (!snap || !self) return;
  const me = snap.me;
  const setBar = (sel, v, max) => {
    const b = $(sel);
    b.querySelector('.fill').style.width = `${Math.max(0, (v / max) * 100)}%`;
    b.querySelector('span').textContent = `${Math.round(v)} / ${max}`;
  };
  setBar('.bar.hp', me.hp, me.maxHp);
  setBar('.bar.mp', me.mana, me.maxMana);
  setBar('.bar.sp', me.stamina, me.maxStamina);

  for (const s of document.querySelectorAll('#hotbar .slot')) {
    const id = s.dataset.id;
    const cdEl = s.querySelector('.cd');
    let cd = me.cooldowns[id] || 0;
    if (id === 'potion') cd = me.potionCd;
    cdEl.hidden = cd <= 0.05;
    if (cd > 0.05) cdEl.textContent = cd.toFixed(cd < 1 ? 1 : 0);
  }
  $('#buffs').textContent = me.buffs.map((b) => `${b.id} ${b.left.toFixed(1)}s`).join('  ') + (me.inCombat ? '  ⚔ in combat' : '');

  const ch = $('#channel');
  ch.hidden = !me.channel;
  if (me.channel) {
    $('#channel-fill').style.width = `${(1 - me.channel.left / me.channel.total) * 100}%`;
    $('#channel-label').textContent = `${me.channel.kind} ${me.channel.left.toFixed(1)}s`;
  }
  $('#death').hidden = !me.dead;
  if (me.dead) $('#respawn').textContent = `Back in ${me.respawnIn.toFixed(1)}s`;

  const z = zoneAt(local.x, local.y);
  const vb = Math.round(ventureBonus(me.venture, z.tier) * 100);
  $('#topleft').innerHTML = `<b>${esc(self.name)}</b> · power ${self.power}<br>`
    + `STR ${self.attrs.str} · AGI ${self.attrs.agi} · INT ${self.attrs.int}<br>`
    + `Wisdom: ${self.wisdom}${self.wisdom > 0 ? ' (C to spend)' : ''}<br>`
    + `Carrying: ${self.inventory.gold}g, ${self.inventory.items.length} items<br>`
    + (me.venture ? `<span class="venture">Venture streak ${me.venture}: +${vb}% loot rarity. Bank to lock it in.</span>` : '<span class="hint">No venture streak</span>');

  const banner = $('#zone-banner');
  const showBanner = performance.now() < zoneBannerUntil;
  const zone = ZONES.find((q) => q.id === (zoneInfo?.zone || z.id));
  const tag = zone.safe ? '<span class="safe">Safe zone</span>' : zone.arena ? '<span class="pvp">Arena: PvP, no loss</span>' : '<span class="pvp">PvP: full loot of carried items</span>';
  banner.innerHTML = `<div class="name">${zone.name}${zone.tier ? ` <small>(tier ${zone.tier})</small>` : ''}</div><div>${tag}</div>`
    + (showBanner ? `<div>${zone.blurb}</div>${zoneInfo?.warning ? `<div class="warn">${esc(zoneInfo.warning)}</div>` : ''}` : '');
}

// ------------------------------------------------------------ panels

function togglePanel(name) {
  if (openPanel === name) return closePanel();
  openPanel = name;
  $('#panel').hidden = false;
  renderPanel();
}
function closePanel() {
  openPanel = null;
  $('#panel').hidden = true;
}
$('#panel-close').onclick = closePanel;

function inTown() {
  return zoneAt(local.x, local.y).id === 'warren';
}

function weaponCard(w, actions = '') {
  if (!w) return '<div class="item meta">Bare-handed.</div>';
  const r = RARITIES[w.rarity];
  const affXp = affinityXpFor(w, self.name);
  const aff = affinityLevel(affXp);
  const active = new Set(activeAffixes(w, self.name));
  const affixes = w.affixes.map((a, i) => {
    const g = AFFIX_GATES[i];
    const on = active.has(a);
    return `<span class="${on ? '' : 'dormant'}" title="${AFFIXES[a].desc}${on ? '' : ` (needs +${g.upgrade} and affinity ${g.affinity})`}">${AFFIXES[a].label}</span>`;
  }).join(', ');
  return `<div class="item"><div style="color:${r.color}"><b>${esc(w.name)}</b> ${w.upgrade ? `+${w.upgrade}` : ''}${w.dungeon ? ' ◆dungeon' : ''}</div>
    <div class="meta">${w.rarity} · tier ${w.tier} ${WEAPON_TYPES[w.type].label} · item power ${itemPower(w).toFixed(1)} · upgrade cap +${r.upgradeCap}</div>
    <div class="meta">Affinity ${aff}/10 (${affXp} hits, yours) · next upgrade ${Math.round(upgradeChance(w) * 100)}%${w.failstacks ? ` (${w.failstacks} failstacks)` : ''}</div>
    ${w.affixes.length ? `<div class="meta">Affixes: ${affixes}</div>` : ''}
    ${w.crafter ? `<div class="meta">Made by ${esc(w.crafter)}</div>` : ''}
    <div class="row">${actions}</div></div>`;
}

function stacksTable(stacks, rowActions) {
  const entries = Object.entries(stacks);
  if (!entries.length) return '<div class="hint">Nothing.</div>';
  return `<table>${entries.map(([k, v]) => `<tr><td>${stackLabel(k)}</td><td>${v}</td><td>${rowActions ? rowActions(k, v) : ''}</td></tr>`).join('')}</table>`;
}

function renderPanel() {
  if (!self || !openPanel) return;
  const body = $('#panel-body');
  const title = $('#panel-title');
  let html = '';
  if (openPanel === 'character') {
    title.textContent = 'Character';
    const total = self.attrs.str + self.attrs.agi + self.attrs.int;
    html += `<div class="hint">Wisdom raises attributes. Your spread decides which school abilities you get. Total cap ${ATTRIBUTE_TOTAL_CAP} (you: ${total}).</div>`;
    html += '<table>';
    for (const a of ['str', 'agi', 'int']) {
      const cost = attributePointCost(self.attrs[a]);
      html += `<tr><td><b>${a.toUpperCase()}</b></td><td>${self.attrs[a]}</td><td><button data-wis="${a}" ${self.wisdom < cost ? 'disabled' : ''}>+1 (${cost} wis)</button></td></tr>`;
    }
    html += `</table><div class="row">Wisdom available: <b>${self.wisdom}</b></div>`;
    const s = self.stats;
    html += `<h3>Derived</h3><table>
      <tr><td>Health / regen</td><td>${s.maxHealth} / ${s.healthRegen.toFixed(1)}/s</td></tr>
      <tr><td>Mana / regen</td><td>${s.maxMana} / ${s.manaRegen.toFixed(1)}/s</td></tr>
      <tr><td>Stamina / regen</td><td>${s.maxStamina} / ${s.staminaRegen.toFixed(1)}/s</td></tr>
      <tr><td>Move speed</td><td>${Math.round(s.moveSpeed)}</td></tr>
      <tr><td>Crit</td><td>${Math.round(s.critChance * 100)}% x${s.critMult.toFixed(2)}</td></tr>
      <tr><td>Armor / soak</td><td>${s.armor.toFixed(1)} / ${s.damageSoak}</td></tr>
      <tr><td>Tumble i-frames</td><td>${s.dodgeIframes.toFixed(2)}s</td></tr>
      <tr><td>Threat mult</td><td>x${s.threatMult.toFixed(2)}</td></tr></table>`;
    html += `<h3>Weapon</h3>${weaponCard(self.equipped, self.equipped ? '<button data-unequip>Unequip</button>' : '')}`;
    html += `<div class="hint">Effective power ${self.weapon.power} = item power x mastery ${self.weapon.mastery?.toFixed(2) ?? '-'} (affinity + ${self.equipped ? WEAPON_TYPES[self.equipped.type].label : 'unarmed'} skill). Unlock score ${self.weapon.unlockScore}.</div>`;
    html += '<h3>Abilities</h3><div class="hint">Click one, then click a hotbar slot to place it. Right-click a slot to clear.</div><table>';
    const all = Object.values(ABILITIES).filter((a) => a.source !== 'weapon' || a.weapon === self.equipped?.type);
    for (const a of all) {
      const have = self.abilities.includes(a.id);
      html += `<tr><td>${a.icon}</td><td title="${esc(tipFor(a.id))}">${have ? a.name : `<span class="dormant">${a.name}</span>`}</td><td class="hint">${a.source === 'weapon' ? `score ${a.unlock}` : a.requires ? Object.entries(a.requires).map(([k, v]) => `${k.toUpperCase()}${v}`).join(' ') : ''}</td><td>${have ? `<button data-assign="${a.id}" data-bar="combat">place</button>` : ''}</td></tr>`;
    }
    html += '</table><h3>Utility & social</h3><div class="row">';
    for (const [id, u] of Object.entries(UTILITY_ACTIONS)) html += `<button data-assign="${id}" data-bar="utility">${u.icon} ${u.name}</button>`;
    for (const [id, u] of Object.entries(EMOTES)) html += `<button data-assign="${id}" data-bar="social">${u.icon} ${u.name}</button>`;
    html += '</div>';
  } else if (openPanel === 'inventory') {
    title.textContent = 'Inventory (carried, lost on death outside town)';
    html += `<div class="row">Gold: <b>${self.inventory.gold}</b></div><h3>Equipped</h3>${weaponCard(self.equipped)}`;
    html += `<h3>Weapons (${self.inventory.items.length}/24)</h3>`;
    html += self.inventory.items.map((w) => weaponCard(w, `<button data-equip="${w.uid}">Equip</button>`)).join('') || '<div class="hint">None.</div>';
    html += `<h3>Stacks</h3>${stacksTable(self.inventory.stacks)}`;
  } else if (openPanel === 'skills') {
    title.textContent = 'Skills';
    let trade = 0;
    for (const [k, def] of Object.entries(SKILLS)) if (def.category === 'trade') trade += self.skills[k].level - 1;
    html += `<div class="hint">Skills rise by doing. Trade skills share a cap (${trade}/${TRADE_CAP}); mark one "down" to make room.</div>`;
    for (const cat of ['combat', 'movement', 'trade']) {
      html += `<h3>${cat}</h3><table>`;
      for (const [k, def] of Object.entries(SKILLS)) {
        if (def.category !== cat) continue;
        const s = self.skills[k];
        const next = s.level < 99 ? xpForLevel(s.level + 1) : s.xp;
        html += `<tr><td>${def.label}</td><td><b>${s.level}</b></td><td class="hint">${s.xp}/${next}</td><td>${cat === 'trade' ? ['up', 'down', 'locked'].map((l) => `<button data-lock="${k}:${l}" ${s.lock === l ? 'disabled' : ''}>${l === 'up' ? '▲' : l === 'down' ? '▼' : '■'}</button>`).join('') : ''}</td></tr>`;
      }
      html += '</table>';
    }
  } else if (openPanel === 'bank') {
    title.textContent = 'Bank (Goblin Warren)';
    if (!inTown()) html += '<div class="hint">You can look, but you need to be in the Warren to use it.</div>';
    html += `<div class="row"><button data-util="bank">Deposit everything carried</button></div>`;
    html += `<div class="row">Banked gold: <b>${self.bank.gold}</b> <input id="wgold" type="number" min="1" style="width:80px" placeholder="amt"><button data-wgold>Withdraw</button></div>`;
    html += `<h3>Weapons</h3>${self.bank.items.map((w) => weaponCard(w, `<button data-wuid="${w.uid}">Withdraw</button><button data-upgrade="${w.uid}">Upgrade</button>`)).join('') || '<div class="hint">None.</div>'}`;
    html += `<h3>Stacks</h3>${stacksTable(self.bank.stacks, (k) => `<button data-wkey="${k}">Take 1</button><button data-wkeyall="${k}">All</button>`)}`;
  } else if (openPanel === 'market') {
    title.textContent = 'Market';
    html += '<div class="hint">Trades from and into your bank. Limit orders, matched by price then time. 2% seller tax.</div>';
    const keysAll = ['ore_t1', 'ore_t2', 'ore_t3', 'herb_t1', 'herb_t2', 'herb_t3', 'hide_t1', 'hide_t2', 'core_t3', 'rotfang_tooth', 'tome_t1', 'tome_t2', 'tome_t3', 'potion_t1', 'potion_t2', 'potion_t3'];
    html += `<div class="row"><select id="mkey">${keysAll.map((k) => `<option value="${k}">${stackLabel(k)}</option>`).join('')}</select>
      <input id="mqty" type="number" min="1" value="1" style="width:60px"> @ <input id="mprice" type="number" min="1" value="10" style="width:70px">g
      <button data-mk="buy">Buy</button><button data-mk="sell">Sell</button></div>`;
    html += '<h3>Book</h3><table><tr><th>Item</th><th>Best bid</th><th>Best ask</th></tr>';
    for (const k of keysAll) {
      const s = self.market[k];
      if (!s || (s.bestBuy === null && s.bestSell === null)) continue;
      html += `<tr><td>${stackLabel(k)}</td><td>${s.bestBuy ?? '-'} (${s.buyQty})</td><td>${s.bestSell ?? '-'} (${s.sellQty})</td></tr>`;
    }
    html += '</table><h3>Your orders</h3>';
    html += self.orders.length ? `<table>${self.orders.map((o) => `<tr><td>${o.side}</td><td>${stackLabel(o.key)}</td><td>${o.remaining}/${o.qty} @ ${o.price}g</td><td><button data-cancel="${o.id}">Cancel</button></td></tr>`).join('')}</table>` : '<div class="hint">None.</div>';
    html += `<div class="row">Bank gold: ${self.bank.gold}</div>`;
  } else if (openPanel === 'workshop') {
    title.textContent = 'Anvil & Cauldron';
    if (!inTown()) html += '<div class="hint">Stations are in the Warren.</div>';
    html += '<h3>Upgrade (uses a tome of tier ≥ item tier; failure adds a failstack, never destroys)</h3>';
    const ws = [self.equipped, ...self.inventory.items].filter(Boolean);
    html += ws.map((w) => weaponCard(w, `<button data-upgrade="${w.uid}">Upgrade</button>`)).join('');
    const tomes = Object.entries({ ...self.bank.stacks }).filter(([k]) => k.startsWith('tome'));
    for (const [k, v] of Object.entries(self.inventory.stacks)) if (k.startsWith('tome')) tomes.push([k, v]);
    html += `<div class="hint">Tomes: ${tomes.map(([k, v]) => `${stackLabel(k)} x${v}`).join(', ') || 'none'}</div>`;
    html += '<h3>Craft (materials from inventory, then bank)</h3><table>';
    for (const [id, r] of Object.entries(RECIPES)) {
      const lvl = self.skills[r.skill].level;
      const ins = Object.entries(r.inputs).map(([k, v]) => `${v} ${stackLabel(k)}`).join(', ');
      const out = r.output.weapon ? `T${r.output.weapon} weapon` : `${r.output.qty} ${stackLabel(r.output.stack)}`;
      html += `<tr><td>${out}</td><td class="hint">${ins}</td><td class="hint">${SKILLS[r.skill].label} ${r.level}</td><td>${r.output.weapon ? `<select data-wtype="${id}">${Object.keys(WEAPON_TYPES).map((t) => `<option>${t}</option>`).join('')}</select>` : ''}<button data-craft="${id}" ${lvl < r.level ? 'disabled' : ''}>Make</button></td></tr>`;
    }
    html += '</table>';
  }
  body.innerHTML = html;
}

$('#panel-body').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const d = b.dataset;
  if (d.wis) send({ t: 'wisdom', attr: d.wis });
  else if (d.unequip !== undefined) send({ t: 'unequip' });
  else if (d.equip) send({ t: 'equip', uid: d.equip });
  else if (d.assign) {
    assigning = d.assign;
    activeBar = d.bar;
    renderHotbar();
    log(`Click a ${d.bar} hotbar slot to place it (Esc to cancel).`);
  } else if (d.lock) {
    const [skill, lock] = d.lock.split(':');
    send({ t: 'skillLock', skill, lock });
  } else if (d.util) send({ t: 'util', id: d.util });
  else if (d.wuid) send({ t: 'withdraw', uid: d.wuid });
  else if (d.wkey) send({ t: 'withdraw', key: d.wkey, qty: 1 });
  else if (d.wkeyall) send({ t: 'withdraw', key: d.wkeyall, qty: self.bank.stacks[d.wkeyall] });
  else if (d.wgold !== undefined) send({ t: 'withdraw', gold: +$('#wgold').value });
  else if (d.upgrade) send({ t: 'upgrade', uid: d.upgrade });
  else if (d.craft) {
    const sel = document.querySelector(`select[data-wtype="${d.craft}"]`);
    send({ t: 'craft', recipe: d.craft, weaponType: sel?.value });
  } else if (d.mk) send({ t: 'market', op: d.mk, key: $('#mkey').value, qty: +$('#mqty').value, price: +$('#mprice').value });
  else if (d.cancel) send({ t: 'market', op: 'cancel', id: +d.cancel });
});

// ------------------------------------------------------------ rendering

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

function lerpEntities(listA, listB, t) {
  if (!listA) return listB;
  const prev = new Map(listA.map((e) => [e.id, e]));
  return listB.map((e) => {
    const p = prev.get(e.id);
    if (!p) return e;
    return { ...e, x: p.x + (e.x - p.x) * t, y: p.y + (e.y - p.y) * t };
  });
}

function drawGoblin(x, y, aim, color, name, hpFrac, isMe, iframes, weapon) {
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = iframes ? 0.5 : 1;
  // ears
  ctx.fillStyle = color;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(s * 8, -6);
    ctx.lineTo(s * 22, -14);
    ctx.lineTo(s * 10, 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(0, 0, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = isMe ? '#fff' : '#1a2a10';
  ctx.lineWidth = 2;
  ctx.stroke();
  // eyes look at aim
  const ex = Math.cos(aim) * 4;
  const ey = Math.sin(aim) * 4;
  ctx.fillStyle = '#ffeb3b';
  ctx.beginPath(); ctx.arc(-4 + ex, -2 + ey, 3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(4 + ex, -2 + ey, 3, 0, Math.PI * 2); ctx.fill();
  // weapon stub
  if (weapon) {
    ctx.strokeStyle = { sword: '#ccc', dagger: '#aaa', staff: '#8b5a2b', bow: '#a0522d', maul: '#777' }[weapon];
    ctx.lineWidth = weapon === 'maul' ? 6 : 3;
    ctx.beginPath();
    ctx.moveTo(Math.cos(aim) * 12, Math.sin(aim) * 12);
    ctx.lineTo(Math.cos(aim) * (weapon === 'dagger' ? 22 : 30), Math.sin(aim) * (weapon === 'dagger' ? 22 : 30));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#000a';
  ctx.fillRect(-18, -30, 36, 4);
  ctx.fillStyle = isMe ? '#7dff5a' : '#ff5a5a';
  ctx.fillRect(-18, -30, 36 * Math.max(0, hpFrac), 4);
  ctx.fillStyle = '#fff';
  ctx.font = '11px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(name, 0, -34);
  ctx.restore();
}

function drawEnemy(e) {
  const def = ENEMIES[e.type];
  ctx.save();
  ctx.translate(e.x, e.y);
  if (e.windup) {
    // telegraph
    const prog = 1 - e.windup.left / e.windup.total;
    const ang = Math.atan2(e.windup.ay - e.y, e.windup.ax - e.x);
    ctx.fillStyle = `rgba(255,60,40,${0.15 + prog * 0.3})`;
    const atk = def.attack;
    if (atk.kind === 'ranged') {
      ctx.save();
      ctx.rotate(ang);
      ctx.fillRect(0, -3, atk.range * prog, 6);
      ctx.restore();
    } else {
      ctx.beginPath();
      if (atk.kind === 'melee') {
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, atk.range + e.r, ang - 1, ang + 1);
      } else {
        ctx.arc(Math.cos(ang) * atk.range * 0.5, Math.sin(ang) * atk.range * 0.5, atk.range * 0.75 * prog, 0, Math.PI * 2);
      }
      ctx.fill();
    }
  }
  ctx.fillStyle = def.color;
  ctx.beginPath();
  ctx.arc(0, 0, e.r, 0, Math.PI * 2);
  ctx.fill();
  const ring = { elite: '#ffd23f', champion: '#c26bff', boss: '#ff3b3b' }[e.rank];
  ctx.lineWidth = ring ? 3 : 1.5;
  ctx.strokeStyle = ring || '#0008';
  ctx.stroke();
  ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.arc(-e.r * 0.35, -e.r * 0.2, 2.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(e.r * 0.35, -e.r * 0.2, 2.5, 0, Math.PI * 2); ctx.fill();
  const w = Math.max(30, e.r * 2);
  ctx.fillStyle = '#000a';
  ctx.fillRect(-w / 2, -e.r - 10, w, 4);
  ctx.fillStyle = '#e04030';
  ctx.fillRect(-w / 2, -e.r - 10, w * (e.hp / e.maxHp), 4);
  if (e.target === myId) {
    ctx.fillStyle = '#ff5a5a';
    ctx.font = 'bold 12px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('!', 0, -e.r - 14);
  }
  ctx.restore();
}

function drawWorld(cam) {
  ctx.fillStyle = '#0b0c09';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(-cam.x, -cam.y);
  // zones, back to front (big first)
  for (const z of [...ZONES].reverse()) {
    const [x, y, w, h] = z.rect;
    ctx.fillStyle = z.color;
    ctx.fillRect(x, y, w, h);
  }
  // grid for motion reference
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 1;
  const gs = 80;
  const x0 = Math.floor(cam.x / gs) * gs;
  const y0 = Math.floor(cam.y / gs) * gs;
  ctx.beginPath();
  for (let x = x0; x < cam.x + canvas.width + gs; x += gs) { ctx.moveTo(x, cam.y); ctx.lineTo(x, cam.y + canvas.height); }
  for (let y = y0; y < cam.y + canvas.height + gs; y += gs) { ctx.moveTo(cam.x, y); ctx.lineTo(cam.x + canvas.width, y); }
  ctx.stroke();
  // zone borders + labels
  for (const z of ZONES) {
    const [x, y, w, h] = z.rect;
    ctx.strokeStyle = z.safe ? '#9bd34a' : z.arena ? '#f0a040' : z.dungeon ? '#b65cff' : 'rgba(255,255,255,0.08)';
    ctx.lineWidth = z.safe || z.arena || z.dungeon ? 3 : 1;
    ctx.strokeRect(x, y, w, h);
  }
  for (const [k, s] of Object.entries(SERVICES)) {
    ctx.fillStyle = '#2b2416';
    ctx.fillRect(s.x - 26, s.y - 18, 52, 36);
    ctx.fillStyle = '#e7e4d4';
    ctx.font = '12px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText({ bank: '🏦', market: '⚖️', anvil: '⚒️', cauldron: '⚗️' }[k], s.x, s.y + 2);
    ctx.fillText(s.label, s.x, s.y + 30);
  }
  ctx.restore();
}

function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  if (!snap) {
    ctx.fillStyle = '#0b0c09';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return;
  }
  const dt = Math.min(0.05, (now - (frame.last || now)) / 1000);
  frame.last = now;
  // client-side prediction for own movement, nudged toward server truth
  const me = snap.me;
  if (!me.dead && !me.channel && self) {
    const d = moveDir();
    local.x += d.x * self.stats.moveSpeed * dt;
    local.y += d.y * self.stats.moveSpeed * dt;
  }
  local.x += (me.x - local.x) * 0.15;
  local.y += (me.y - local.y) * 0.15;

  const cam = camera();
  drawWorld(cam);
  const t = Math.min(1, (now - snapAt) / 50);
  ctx.save();
  ctx.translate(-cam.x, -cam.y);

  for (const n of snap.nodes) {
    ctx.globalAlpha = n.ready ? 1 : 0.3;
    ctx.font = '22px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(n.skill === 'mining' ? '🪨' : '🌿', n.x, n.y + 8);
    if (n.ready && Math.hypot(n.x - local.x, n.y - local.y) < 120) {
      ctx.font = '10px ui-monospace, monospace';
      ctx.fillStyle = '#fff';
      ctx.fillText(`${stackLabel(n.key)} (${n.level})`, n.x, n.y + 24);
    }
    ctx.globalAlpha = 1;
  }
  for (const b of snap.bags) {
    ctx.font = '22px sans-serif';
    ctx.textAlign = 'center';
    ctx.globalAlpha = b.mine ? 1 : 0.5;
    ctx.fillText('💰', b.x, b.y + 8);
    ctx.globalAlpha = 1;
  }
  for (const a of snap.aoes) {
    ctx.beginPath();
    if (a.kind === 'swing' || a.kind === 'eswing') {
      const half = (a.arc * Math.PI) / 360;
      ctx.moveTo(a.x, a.y);
      ctx.arc(a.x, a.y, a.r, a.ang - half, a.ang + half);
      ctx.fillStyle = a.kind === 'swing' ? 'rgba(255,255,255,0.25)' : 'rgba(255,80,60,0.35)';
    } else {
      ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2);
      ctx.fillStyle = a.kind === 'heal' ? 'rgba(90,255,120,0.25)' : a.kind === 'eslam' ? 'rgba(255,60,40,0.4)' : a.pending ? 'rgba(255,200,80,0.18)' : 'rgba(150,200,255,0.3)';
    }
    ctx.fill();
  }
  for (const e of lerpEntities(prevSnap?.enemies, snap.enemies, t)) drawEnemy(e);
  for (const p of lerpEntities(prevSnap?.players, snap.players, t)) {
    if (p.dead) continue;
    const isMe = p.id === myId;
    const pos = isMe ? local : p;
    const aim = isMe ? Math.atan2(mouseWorld().y - local.y, mouseWorld().x - local.x) : p.aim;
    drawGoblin(pos.x, pos.y, aim, isMe ? '#6fbf3a' : '#4f9a3a', p.name, p.hp / p.maxHp, isMe, p.iframes, p.weapon);
  }
  for (const j of snap.projectiles) {
    ctx.beginPath();
    ctx.arc(j.x, j.y, j.r, 0, Math.PI * 2);
    ctx.fillStyle = j.enemy ? '#ff7043' : j.ability === 'blood_bolt' ? '#d01c1c' : j.ability?.startsWith('arcane') || j.ability === 'staff_bolt' ? '#b0e0ff' : '#ffe08a';
    ctx.fill();
  }
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i];
    f.t += dt;
    if (f.t > f.life) {
      floaters.splice(i, 1);
      continue;
    }
    let fx = f.x;
    let fy = f.y;
    if (f.follow) {
      const who = snap.players.find((p) => p.id === f.follow);
      if (!who) continue;
      fx = f.follow === myId ? local.x : who.x;
      fy = (f.follow === myId ? local.y : who.y) - 40;
    }
    ctx.globalAlpha = 1 - f.t / f.life;
    ctx.fillStyle = f.color;
    ctx.font = `bold ${f.size}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(f.text, fx, fy - f.t * 40);
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  drawMinimap();
  updateHud();
}

function drawMinimap() {
  const sx = mini.width / WORLD.width;
  const sy = mini.height / WORLD.height;
  for (const z of [...ZONES].reverse()) {
    const [x, y, w, h] = z.rect;
    mctx.fillStyle = z.color;
    mctx.fillRect(x * sx, y * sy, w * sx, h * sy);
  }
  for (const z of ZONES) {
    if (!(z.safe || z.arena || z.dungeon)) continue;
    const [x, y, w, h] = z.rect;
    mctx.strokeStyle = z.safe ? '#9bd34a' : z.arena ? '#f0a040' : '#b65cff';
    mctx.strokeRect(x * sx, y * sy, w * sx, h * sy);
  }
  for (const p of snap.players) {
    mctx.fillStyle = p.id === myId ? '#fff' : '#7dff5a';
    mctx.fillRect(p.x * sx - 2, p.y * sy - 2, 4, 4);
  }
}

requestAnimationFrame(frame);
