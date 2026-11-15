// The DOM HUD: crosshair, hit marker, health, ammo, timer, score, money, kill feed,
// minimap, buy menu and the overlay panels. It never touches the simulation;
// main.js pushes numbers in and reads the play and buy callbacks out.
import { WEAPONS, GEAR } from './weapons.js';

const COPY = {
  start: {
    title: 'DUSTLINE',
    copy: 'Depot 9, dusk. Vanguard attacks, Wardens hold the sites. Plant the charge at A or B — or clear the Wardens. Click to play.',
    action: 'Click to play',
  },
  paused: {
    title: 'DUSTLINE',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  end: {
    title: 'Round over',
    copy: '',
    action: 'Next round',
  },
  matchover: {
    title: 'Match over',
    copy: '',
    action: 'Play again',
  },
};

const SHOP_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8'];

export function createHud() {
  const overlay = document.getElementById('overlay');
  const title = document.getElementById('overlay-title');
  const copy = document.getElementById('overlay-copy');
  const play = document.getElementById('play');
  const crosshair = document.getElementById('crosshair');
  const ammo = document.getElementById('ammo');
  const ammoMag = document.getElementById('ammo-mag');
  const ammoReserve = document.getElementById('ammo-reserve');
  const weaponName = document.getElementById('weapon-name');
  const gearLine = document.getElementById('gear-line');
  const healthFill = document.getElementById('health-fill');
  const healthNum = document.getElementById('health-num');
  const armorNum = document.getElementById('armor-num');
  const moneyEl = document.getElementById('money');
  const timerEl = document.getElementById('timer');
  const scoreEl = document.getElementById('score');
  const bombEl = document.getElementById('bomb-status');
  const killfeedEl = document.getElementById('killfeed');
  const hitmarker = document.getElementById('hitmarker');
  const banner = document.getElementById('banner');
  const bannerTitle = banner.querySelector('h2');
  const bannerCopy = banner.querySelector('p');
  const flashEl = document.getElementById('flash');
  const damageEl = document.getElementById('damage');
  const buyEl = document.getElementById('buy');
  const buySub = document.getElementById('buy-sub');
  const shopEl = document.getElementById('shop');
  const buyDone = document.getElementById('buy-done');
  const minimap = document.getElementById('minimap');
  const mapCtx = minimap.getContext('2d');

  let hitTimer = 0;
  let flashTimer = 0;
  let damageTimer = 0;
  let bannerTimer = 0;
  let last = {};
  let buyHandler = null;

  function setText(el, key, value) {
    if (last[key] === value) return;
    last[key] = value;
    el.textContent = value;
  }

  const shopItems = [
    ...Object.values(WEAPONS).filter((w) => w.slot === 'primary'),
    ...Object.values(GEAR),
  ];

  function renderShop(money, loadout) {
    shopEl.innerHTML = '';
    shopItems.forEach((item, i) => {
      const owned =
        (item.slot === 'primary' && loadout.primary === item.id) ||
        (item.id === 'kevlar' && loadout.kevlar) ||
        (GEAR[item.id] && item.id !== 'kevlar' && loadout.grenades[item.id] >= item.max);
      const button = document.createElement('button');
      button.type = 'button';
      button.disabled = owned || money < item.price;
      const label = document.createElement('span');
      label.innerHTML = `<span class="key">${SHOP_KEYS[i]}</span>${item.name}${owned ? ' — owned' : ''}`;
      const price = document.createElement('span');
      price.className = 'price';
      price.textContent = `$${item.price}`;
      button.append(label, price);
      button.addEventListener('click', () => buyHandler && buyHandler(item.id));
      shopEl.appendChild(button);
    });
  }

  return {
    setHealth(hp, armor) {
      const pct = Math.max(0, Math.min(100, hp));
      healthFill.style.width = `${pct}%`;
      healthFill.classList.toggle('low', pct <= 30);
      setText(healthNum, 'hp', String(Math.ceil(hp)));
      setText(armorNum, 'armor', armor > 0 ? `+${Math.ceil(armor)} armour` : '');
    },
    setAmmo(mag, reserve, name) {
      setText(ammoMag, 'mag', String(mag));
      setText(ammoReserve, 'reserve', ` / ${reserve}`);
      setText(weaponName, 'weapon', name);
      ammo.classList.toggle('empty', mag === 0);
    },
    setGear(frag, smoke, flash, hasBomb) {
      setText(gearLine, 'gear', `Frag ${frag} · Smoke ${smoke} · Flash ${flash}${hasBomb ? ' · CHARGE' : ''}`);
    },
    setMoney(value) {
      setText(moneyEl, 'money', `$${value}`);
    },
    setTimer(seconds, phase) {
      const s = Math.max(0, Math.ceil(seconds));
      const text = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      setText(timerEl, 'timer', text);
      timerEl.classList.toggle('low', phase === 'live' && s <= 10);
      timerEl.classList.toggle('buy', phase === 'buy');
    },
    setScore(a, d, round) {
      scoreEl.innerHTML = `<b class="van">Vanguard ${a}</b> — <b class="war">${d} Wardens</b> · Round ${round}`;
    },
    setBomb(text) {
      setText(bombEl, 'bomb', text);
    },
    setCrosshairGap(spread) {
      crosshair.style.setProperty('--gap', `${Math.round(spread * 900)}px`);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.style.transform = killed ? 'translate(-50%, -50%) rotate(45deg) scale(1.25)' : '';
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => {
        hitmarker.classList.remove('on');
        hitmarker.style.transform = '';
      }, holdMs);
    },
    damageFlash() {
      damageEl.style.opacity = '1';
      clearTimeout(damageTimer);
      damageTimer = setTimeout(() => {
        damageEl.style.opacity = '0';
      }, 220);
    },
    flash(seconds) {
      flashEl.style.opacity = '1';
      flashEl.style.transition = 'none';
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => {
        flashEl.style.transition = `opacity ${seconds}s linear`;
        flashEl.style.opacity = '0';
      }, 60);
    },
    killfeed(killer, killerTeam, victim, victimTeam, headshot) {
      const row = document.createElement('div');
      row.className = 'kf';
      const kc = killerTeam === 'attackers' ? 'van' : 'war';
      const vc = victimTeam === 'attackers' ? 'van' : 'war';
      row.innerHTML = `<b class="${kc}">${killer}</b> ${headshot ? '<b class="head">◎</b> ' : '— '} <b class="${vc}">${victim}</b>`;
      killfeedEl.prepend(row);
      while (killfeedEl.children.length > 5) killfeedEl.removeChild(killfeedEl.lastChild);
      setTimeout(() => row.remove(), 6000);
    },
    showBanner(text, sub, won) {
      bannerTitle.textContent = text;
      bannerCopy.textContent = sub;
      banner.className = won === true ? 'win on' : won === false ? 'lose on' : 'on';
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => banner.classList.remove('on'), 3600);
    },
    hideBanner() {
      banner.classList.remove('on');
    },
    showOverlay(mode, detail) {
      const text = COPY[mode];
      title.textContent = text.title;
      copy.textContent = mode === 'end' || mode === 'matchover' ? detail : text.copy;
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
    showBuy(round, money, loadout) {
      buySub.textContent = `Round ${round} · $${money} · buy ends when the round starts`;
      renderShop(money, loadout);
      buyEl.hidden = false;
    },
    updateBuy(money, loadout) {
      renderShop(money, loadout);
    },
    hideBuy() {
      buyEl.hidden = true;
    },
    isBuyOpen() {
      return !buyEl.hidden;
    },
    onBuy(handler) {
      buyHandler = handler;
    },
    onBuyDone(handler) {
      buyDone.addEventListener('click', handler);
    },
    drawMinimap(map, playerBody, bots, bomb, now) {
      const w = minimap.width;
      const h = minimap.height;
      const sx = w / 52;
      const sy = h / 44;
      mapCtx.clearRect(0, 0, w, h);
      mapCtx.fillStyle = '#1e2228';
      mapCtx.fillRect(0, 0, w, h);
      mapCtx.fillStyle = '#2c323a';
      for (const f of map.footprints) {
        mapCtx.fillRect((f.x0 + 26) * sx, (f.z0 + 22) * sy, (f.x1 - f.x0) * sx, (f.z1 - f.z0) * sy);
      }
      mapCtx.font = 'bold 11px sans-serif';
      mapCtx.fillStyle = '#f0a830';
      mapCtx.fillText('A', (-17 + 26) * sx - 3, (-13 + 22) * sy + 4);
      mapCtx.fillText('B', (17 + 26) * sx - 3, (-13 + 22) * sy + 4);
      if (bomb.state === 'planted' || bomb.state === 'dropped') {
        const bx = (bomb.position.x + 26) * sx;
        const by = (bomb.position.z + 22) * sy;
        mapCtx.fillStyle = Math.floor(now * 2) % 2 ? '#d95b4a' : '#e9e6df';
        mapCtx.beginPath();
        mapCtx.arc(bx, by, 4, 0, Math.PI * 2);
        mapCtx.fill();
      }
      for (const bot of bots) {
        if (!bot.alive) continue;
        const bx = (bot.body.position.x + 26) * sx;
        const by = (bot.body.position.z + 22) * sy;
        if (bot.team === 'attackers') {
          mapCtx.fillStyle = '#f0a830';
          mapCtx.fillRect(bx - 2, by - 2, 4, 4);
        } else if (now - (bot.lastShotAt || -99) < 3) {
          mapCtx.fillStyle = '#d95b4a';
          mapCtx.beginPath();
          mapCtx.arc(bx, by, 3, 0, Math.PI * 2);
          mapCtx.fill();
        }
      }
      const px = (playerBody.position.x + 26) * sx;
      const py = (playerBody.position.z + 22) * sy;
      mapCtx.save();
      mapCtx.translate(px, py);
      mapCtx.rotate(-playerBody.yaw);
      mapCtx.fillStyle = '#e9e6df';
      mapCtx.beginPath();
      mapCtx.moveTo(0, -6);
      mapCtx.lineTo(4, 5);
      mapCtx.lineTo(-4, 5);
      mapCtx.closePath();
      mapCtx.fill();
      mapCtx.restore();
    },
  };
}
