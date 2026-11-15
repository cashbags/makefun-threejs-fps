// The match: rounds, money and the bomb. First to 8 round wins, at most 15 rounds.
// A round is won by elimination, by the bomb going off, by a defuse, or by the clock
// when the bomb was never planted. Money pays for the next round's buy menu.
import { WEAPONS, GEAR } from './weapons.js';

const WIN_ROUNDS = 8;
const MAX_ROUNDS = 15;
const BUY_SECONDS = 12;
const ROUND_SECONDS = 100;
const BOMB_SECONDS = 35;
const WIN_REWARD = 3250;
const LOSS_REWARD = 1900;
const LOSS_STREAK_BONUS = 500;
const LOSS_REWARD_CAP = 3400;
const KILL_REWARD = 300;

export function createRounds(rng, hooks) {
  const state = {
    phase: 'buy', // 'buy' | 'live' | 'over' | 'matchover'
    round: 0,
    score: { attackers: 0, defenders: 0 },
    timer: BUY_SECONDS,
    money: 800,
    lossStreak: 0,
    bomb: { state: 'carried', carrier: 'player', position: null, site: null, timer: BOMB_SECONDS },
    loadout: { primary: null, sidearm: 'p9', grenades: { frag: 0, smoke: 0, flash: 0 }, kevlar: false },
    lastReason: '',
  };

  function startMatch() {
    state.round = 0;
    state.score.attackers = 0;
    state.score.defenders = 0;
    state.money = 800;
    state.lossStreak = 0;
    state.loadout = { primary: null, sidearm: 'p9', grenades: { frag: 0, smoke: 0, flash: 0 }, kevlar: false };
    startRound();
  }

  function startRound() {
    state.round += 1;
    state.phase = 'buy';
    state.timer = BUY_SECONDS;
    state.bomb = { state: 'carried', carrier: 'player', position: null, site: null, timer: BOMB_SECONDS };
    state.loadout.grenades = { frag: 0, smoke: 0, flash: 0 };
    state.loadout.kevlar = false;
    hooks.onRoundStart(state.round);
  }

  function endRound(winner, reason) {
    if (state.phase === 'over' || state.phase === 'matchover') return;
    state.phase = 'over';
    state.timer = 4;
    state.lastReason = reason;
    if (winner === 'attackers') {
      state.score.attackers += 1;
      state.money += WIN_REWARD;
      state.lossStreak = 0;
    } else {
      state.score.defenders += 1;
      state.lossStreak += 1;
      state.money += Math.min(LOSS_REWARD_CAP, LOSS_REWARD + (state.lossStreak - 1) * LOSS_STREAK_BONUS);
    }
    hooks.onRoundEnd(winner, reason, state.score);
    if (
      state.score.attackers >= WIN_ROUNDS ||
      state.score.defenders >= WIN_ROUNDS ||
      state.round >= MAX_ROUNDS
    ) {
      state.phase = 'matchover';
      state.timer = 8;
      const matchWinner =
        state.score.attackers > state.score.defenders ? 'attackers'
        : state.score.defenders > state.score.attackers ? 'defenders' : 'draw';
      hooks.onMatchEnd(matchWinner, state.score);
    }
  }

  function buy(itemId) {
    if (state.phase !== 'buy') return false;
    const item = WEAPONS[itemId] || GEAR[itemId];
    if (!item) return false;
    if (state.money < item.price) return false;
    if (item.slot === 'primary') {
      if (state.loadout.primary === itemId) return false;
      state.money -= item.price;
      state.loadout.primary = itemId;
    } else if (item.slot === 'sidearm') {
      if (state.loadout.sidearm === itemId) return false;
      state.money -= item.price;
      state.loadout.sidearm = itemId;
    } else if (item.id === 'kevlar') {
      if (state.loadout.kevlar) return false;
      state.money -= item.price;
      state.loadout.kevlar = true;
    } else {
      if (state.loadout.grenades[item.id] >= item.max) return false;
      state.money -= item.price;
      state.loadout.grenades[item.id] += 1;
    }
    hooks.onBuy(itemId, state.money);
    return true;
  }

  function addKillReward() {
    state.money += KILL_REWARD;
  }

  // ctx: { attackersAlive, defendersAlive, playerAlive }
  function tick(dt, ctx) {
    if (state.phase === 'buy') {
      state.timer -= dt;
      if (state.timer <= 0) {
        state.phase = 'live';
        state.timer = ROUND_SECONDS;
        hooks.onLive();
      }
      return;
    }
    if (state.phase === 'live') {
      state.timer -= dt;
      const bomb = state.bomb;
      if (bomb.state === 'planted') {
        bomb.timer -= dt;
        if (bomb.timer <= 0) {
          bomb.state = 'detonated';
          endRound('attackers', 'The charge detonated at Site ' + bomb.site + '.');
          return;
        }
      }
      if (ctx.attackersAlive === 0 && bomb.state !== 'planted') {
        endRound('defenders', 'Vanguard eliminated.');
        return;
      }
      if (ctx.defendersAlive === 0 && bomb.state !== 'planted') {
        endRound('attackers', 'Wardens eliminated.');
        return;
      }
      if (state.timer <= 0) {
        endRound('defenders', 'Time expired — the charge was never planted.');
      }
      return;
    }
    if (state.phase === 'over') {
      state.timer -= dt;
      if (state.timer <= 0) startRound();
    }
  }

  function plant(site) {
    state.bomb.state = 'planted';
    state.bomb.site = site.id;
    state.bomb.timer = BOMB_SECONDS;
    state.bomb.position = site.center.clone();
    hooks.onPlant(site);
  }

  function defuse() {
    state.bomb.state = 'defused';
    endRound('defenders', 'The charge was defused.');
  }

  return {
    state,
    startMatch,
    startRound,
    endRound,
    tick,
    buy,
    addKillReward,
    plant,
    defuse,
    winRounds: WIN_ROUNDS,
    maxRounds: MAX_ROUNDS,
    buySeconds: BUY_SECONDS,
    roundSeconds: ROUND_SECONDS,
  };
}
