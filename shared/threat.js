// Threat: who an enemy is trying to kill.
//
// - Damage generates threat 1:1, scaled by ability threatMult and the
//   attacker's own threat multiplier (gear, affixes).
// - Healing generates 0.5 threat per HP on every enemy already fighting the
//   healed target's side (handled by the caller).
// - The enemy only switches targets when someone beats the current target by
//   10% (in melee range) or 30% (at range). Without that hysteresis aggro
//   ping-pongs and nobody can plan around it.
// - Taunt pins the target for a duration and lifts the taunter to the top.
// - Threat decays when a goblin stops contributing, so stepping back works.

export const MELEE_SWITCH = 1.1;
export const RANGED_SWITCH = 1.3;
export const DECAY_PER_SEC = 0.04; // fraction lost per second when idle
export const IDLE_GRACE = 3; // seconds before decay starts

export class ThreatTable {
  constructor() {
    this.entries = new Map(); // id -> { threat, lastAt }
    this.target = null;
    this.tauntBy = null;
    this.tauntUntil = 0;
  }

  add(id, amount, now) {
    const e = this.entries.get(id) || { threat: 0, lastAt: now };
    e.threat = Math.max(0, e.threat + amount);
    e.lastAt = now;
    this.entries.set(id, e);
  }

  scale(id, factor) {
    const e = this.entries.get(id);
    if (e) e.threat *= factor;
  }

  remove(id) {
    this.entries.delete(id);
    if (this.target === id) this.target = null;
    if (this.tauntBy === id) this.tauntBy = null;
  }

  top() {
    let best = null;
    let bestThreat = -1;
    for (const [id, e] of this.entries) {
      if (e.threat > bestThreat) {
        best = id;
        bestThreat = e.threat;
      }
    }
    return best;
  }

  taunt(id, duration, now) {
    const topId = this.top();
    const topThreat = topId ? this.entries.get(topId).threat : 0;
    this.add(id, 0, now);
    const e = this.entries.get(id);
    e.threat = Math.max(e.threat, topThreat * 1.1 + 10);
    this.tauntBy = id;
    this.tauntUntil = now + duration;
    this.target = id;
  }

  decay(dt, now) {
    for (const [id, e] of this.entries) {
      if (now - e.lastAt > IDLE_GRACE) e.threat *= 1 - DECAY_PER_SEC * dt;
      if (e.threat < 0.5 && id !== this.target) this.entries.delete(id);
    }
  }

  // isMelee(id) -> whether that candidate is within melee range of the enemy
  pickTarget(now, isMelee = () => true) {
    if (this.tauntBy && now < this.tauntUntil && this.entries.has(this.tauntBy)) {
      this.target = this.tauntBy;
      return this.target;
    }
    if (this.target && !this.entries.has(this.target)) this.target = null;
    if (!this.target) {
      this.target = this.top();
      return this.target;
    }
    const cur = this.entries.get(this.target).threat;
    for (const [id, e] of this.entries) {
      if (id === this.target) continue;
      const need = cur * (isMelee(id) ? MELEE_SWITCH : RANGED_SWITCH);
      if (e.threat > need) this.target = id;
    }
    return this.target;
  }

  get size() {
    return this.entries.size;
  }

  clear() {
    this.entries.clear();
    this.target = null;
    this.tauntBy = null;
  }
}
