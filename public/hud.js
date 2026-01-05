/* hud.js ─ score + hearts + burst meter (DOM mode + worker proxy) */
const isWorker = typeof document === 'undefined' || typeof window === 'undefined' || globalThis.__IS_RENDER_WORKER;

let hearts = 10;
let score  = 0;
let bombs  = 0;
let meterState = { fraction: 1, active: false, recharging: false, mode: 'boost' };
let bossHealth = null; // null ⇒ hidden; number 0–1 ⇒ show bar
let bossAltHealth = null;

const notifyHost = (isWorker && typeof self?.postMessage === 'function')
  ? () => self.postMessage({ type: 'hud', state: { score, hearts, bombs, meter: meterState, boss: bossHealth, bossAlt: bossAltHealth } })
  : null;
const HUD_METER_SEND_INTERVAL_MS = 1000 / 20;
const HUD_METER_EPSILON = 0.002;
let lastHudSent = null;
let lastHudSentAt = 0;

/* DOM-backed HUD (main thread) */
let renderScore = () => {};
let renderMeter = () => {};
let renderBoss  = () => {};

if (!isWorker) {
  const hud = document.getElementById('hud');
  const hudDisabled = typeof window !== 'undefined'
    && (window.__EDITOR__ || new URLSearchParams(window.location.search).has('editor'));
  if (!hud || hudDisabled) {
    if (hud) hud.style.display = 'none';
  } else {
  hud.style.display = 'flex';
  hud.style.flexDirection = 'column';
  hud.style.gap = '4px';
  hud.innerHTML = '';

  let lastScoreText = '';
  let lastBombText = '';
  let lastMeterFraction = null;
  let lastMeterColor = '';
  let lastMeterShow = null;
  const primaryBossState = { lastFraction: null, lastVisible: null };
  const altBossState = { lastFraction: null, lastVisible: null };

  const scoreLine = document.createElement('div');
  scoreLine.style.font = '14px monospace';
  scoreLine.style.color = '#0f0';
  hud.appendChild(scoreLine);

  const bombsMeterRow = document.createElement('div');
  Object.assign(bombsMeterRow.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  });

  const bombsWrap = document.createElement('div');
  Object.assign(bombsWrap.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '6px'
  });

  const bombBadge = document.createElement('div');
  Object.assign(bombBadge.style, {
    width: '20px',
    height: '20px',
    borderRadius: '50%',
    background: '#081a33',
    border: '2px solid #d01f1f',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    font: '12px monospace',
    lineHeight: '1'
  });
  bombBadge.textContent = 'B';

  const bombCountLine = document.createElement('div');
  Object.assign(bombCountLine.style, {
    font: '12px monospace',
    color: '#0f0',
    letterSpacing: '0.04em'
  });

  bombsWrap.appendChild(bombBadge);
  bombsWrap.appendChild(bombCountLine);

  const meterWrap = document.createElement('div');
  Object.assign(meterWrap.style, {
    position: 'relative',
    width: '140px',
    height: '10px',
    background: 'rgba(0,0,0,0.35)',
    border: '1px solid #0f0',
    borderRadius: '2px',
    overflow: 'hidden',
    opacity: '0',
    transition: 'opacity 0.25s ease'
  });
  const meterFill = document.createElement('div');
  Object.assign(meterFill.style, {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: '100%',
    background: '#00a9ff',
    transformOrigin: 'left center',
    transform: 'scaleX(1)',
    willChange: 'transform',
    transition: 'transform 0.05s linear, background 0.1s ease'
  });
  meterWrap.appendChild(meterFill);
  bombsMeterRow.appendChild(bombsWrap);
  bombsMeterRow.appendChild(meterWrap);
  hud.appendChild(bombsMeterRow);

  const createBossBar = () => {
    const bossWrap = document.createElement('div');
    Object.assign(bossWrap.style, {
      position: 'fixed',
      top: '8px',
      left: '50%',
      transform: 'translateX(-50%)',
      width: '60vw',
      maxWidth: '640px',
      height: '12px',
      background: 'rgba(0,0,0,0.35)',
      border: '1px solid #0f0',
      borderRadius: '2px',
      overflow: 'hidden',
      opacity: '0',
      transition: 'opacity 0.2s ease',
      pointerEvents: 'none',
      zIndex: 9999
    });
    const bossFill = document.createElement('div');
    Object.assign(bossFill.style, {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      width: '100%',
      background: '#0f0',
      transformOrigin: 'left center',
      transform: 'scaleX(1)',
      willChange: 'transform',
      transition: 'transform 0.05s linear'
    });
    bossWrap.appendChild(bossFill);
    document.body.appendChild(bossWrap);
    return { bossWrap, bossFill };
  };
  const primaryBar = createBossBar();
  const altBar = createBossBar();

  renderScore = () => {
    const nextText = `SCORE ${score}  ${'♥'.repeat(hearts)}`;
    const nextBombText = `x ${bombs}`;
    if (nextText !== lastScoreText) {
      lastScoreText = nextText;
      scoreLine.textContent = nextText;
    }
    if (nextBombText !== lastBombText) {
      lastBombText = nextBombText;
      bombCountLine.textContent = nextBombText;
    }
  };

  renderMeter = () => {
    const clamped = Math.max(0, Math.min(1, meterState.fraction));
    const nextColor = meterState.recharging
      ? '#00ff99'
      : meterState.mode === 'brake'
        ? '#f8a300'
        : '#00a9ff';

    if (lastMeterFraction === null || Math.abs(clamped - lastMeterFraction) > 0.001) {
      meterFill.style.transform = `scaleX(${clamped})`;
      lastMeterFraction = clamped;
    }
    if (nextColor !== lastMeterColor) {
      meterFill.style.background = nextColor;
      lastMeterColor = nextColor;
    }

    const show = meterState.active || meterState.recharging || clamped < 0.999;
    if (show !== lastMeterShow) {
      meterWrap.style.opacity = show ? '1' : '0';
      lastMeterShow = show;
    }
  };

  const renderBossBar = (bar, fraction, state) => {
    if (fraction === null || fraction === undefined) {
      if (state.lastVisible !== false) {
        bar.bossWrap.style.opacity = '0';
        state.lastVisible = false;
      }
      state.lastFraction = null;
      return;
    }
    const clamped = Math.max(0, Math.min(1, fraction));
    if (state.lastVisible !== true) {
      bar.bossWrap.style.opacity = '1';
      state.lastVisible = true;
    }
    if (state.lastFraction === null || Math.abs(clamped - state.lastFraction) > 0.001) {
      bar.bossFill.style.transform = `scaleX(${clamped})`;
      state.lastFraction = clamped;
    }
  };

  renderBoss = () => {
    renderBossBar(primaryBar, bossHealth, primaryBossState);
    renderBossBar(altBar, bossAltHealth, altBossState);
  };
  }
} else {
  // worker mode: no DOM, just notify host when state changes
  renderScore = () => {};
  renderMeter = () => {};
  renderBoss  = () => {};
}

function pushHudState() {
  if (!notifyHost) return;
  const meterFraction = typeof meterState.fraction === 'number' ? meterState.fraction : 0;
  const meterActive = Boolean(meterState.active);
  const meterRecharging = Boolean(meterState.recharging);
  const meterMode = meterState.mode ?? 'boost';
    const boss = bossHealth;
    const bossAlt = bossAltHealth;
  const now = (typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? performance.now()
    : Date.now();

  if (!lastHudSent) {
    lastHudSent = {
      score,
      hearts,
      bombs,
      boss,
      bossAlt,
      meterFraction,
      meterActive,
      meterRecharging,
      meterMode
    };
    lastHudSentAt = now;
    notifyHost();
    return;
  }

  const scoreChanged = score !== lastHudSent.score;
  const heartsChanged = hearts !== lastHudSent.hearts;
  const bombsChanged = bombs !== lastHudSent.bombs;
  const bossChanged = !Object.is(boss, lastHudSent.boss);
  const bossAltChanged = !Object.is(bossAlt, lastHudSent.bossAlt);
  const meterFractionChanged = Math.abs(meterFraction - lastHudSent.meterFraction) > HUD_METER_EPSILON;
  const meterActiveChanged = meterActive !== lastHudSent.meterActive;
  const meterRechargingChanged = meterRecharging !== lastHudSent.meterRecharging;
  const meterModeChanged = meterMode !== lastHudSent.meterMode;
  const meterChanged = meterFractionChanged || meterActiveChanged || meterRechargingChanged || meterModeChanged;

  if (!scoreChanged && !heartsChanged && !bombsChanged && !bossChanged && !bossAltChanged) {
    if (!meterChanged) return;
    if (now - lastHudSentAt < HUD_METER_SEND_INTERVAL_MS) return;
  }

  lastHudSent.score = score;
  lastHudSent.hearts = hearts;
  lastHudSent.bombs = bombs;
  lastHudSent.boss = boss;
  lastHudSent.bossAlt = bossAlt;
  lastHudSent.meterFraction = meterFraction;
  lastHudSent.meterActive = meterActive;
  lastHudSent.meterRecharging = meterRecharging;
  lastHudSent.meterMode = meterMode;
  lastHudSentAt = now;
  notifyHost();
}

renderScore();

export function addScore(pts = 10) {
  score += pts;
  renderScore();
  pushHudState();
}

export function loseHeart() {
  hearts = Math.max(0, hearts - 1);
  renderScore();
  pushHudState();
  return hearts;
}

export function gainHeart(amount = 1) {
  hearts = Math.max(0, hearts + amount);
  renderScore();
  pushHudState();
}

export function getScore() {
  return score;
}

export function setBombs(count = 0) {
  bombs = Math.max(0, Math.floor(count));
  renderScore();
  pushHudState();
}

export function addBombs(amount = 1) {
  if (!Number.isFinite(amount)) return;
  setBombs(bombs + amount);
}

export function setBurstMeter(fraction = 1, { active = false, recharging = false, mode = 'boost' } = {}) {
  meterState = { fraction: Math.max(0, Math.min(1, fraction)), active, recharging, mode };
  renderMeter();
  pushHudState();
}

export function setBossHealth(fraction = null) {
  bossHealth = (fraction === null || fraction === undefined) ? null : Math.max(0, Math.min(1, fraction));
  renderBoss();
  pushHudState();
}

export function setBossHealthAlt(fraction = null) {
  bossAltHealth = (fraction === null || fraction === undefined) ? null : Math.max(0, Math.min(1, fraction));
  renderBoss();
  pushHudState();
}

export function syncHud(state = {}) {
  let scoreDirty = false;
  let bombsDirty = false;
  let meterDirty = false;
  let bossDirty = false;
  let bossAltDirty = false;

  if (typeof state.score === 'number' && state.score !== score) {
    score = state.score;
    scoreDirty = true;
  }
  if (typeof state.hearts === 'number' && state.hearts !== hearts) {
    hearts = state.hearts;
    scoreDirty = true;
  }
  if (typeof state.bombs === 'number' && state.bombs !== bombs) {
    bombs = state.bombs;
    bombsDirty = true;
  }

  if (state.meter) {
    const nextFraction = Math.max(0, Math.min(1, state.meter.fraction ?? meterState.fraction));
    const nextActive = Boolean(state.meter.active ?? meterState.active);
    const nextRecharging = Boolean(state.meter.recharging ?? meterState.recharging);
    const nextMode = state.meter.mode ?? meterState.mode;
    const currentFraction = typeof meterState.fraction === 'number' ? meterState.fraction : 0;
    const currentActive = Boolean(meterState.active);
    const currentRecharging = Boolean(meterState.recharging);
    const currentMode = meterState.mode ?? 'boost';
    meterDirty = Math.abs(nextFraction - currentFraction) > HUD_METER_EPSILON
      || nextActive !== currentActive
      || nextRecharging !== currentRecharging
      || nextMode !== currentMode;
    if (meterDirty) {
      meterState = {
        fraction: nextFraction,
        active: nextActive,
        recharging: nextRecharging,
        mode: nextMode
      };
    }
  }

  if (state.boss !== undefined) {
    const nextBoss = (state.boss === null || state.boss === undefined)
      ? null
      : Math.max(0, Math.min(1, state.boss));
    bossDirty = !Object.is(nextBoss, bossHealth);
    if (bossDirty) {
      bossHealth = nextBoss;
    }
  }
  if (state.bossAlt !== undefined) {
    const nextBossAlt = (state.bossAlt === null || state.bossAlt === undefined)
      ? null
      : Math.max(0, Math.min(1, state.bossAlt));
    bossAltDirty = !Object.is(nextBossAlt, bossAltHealth);
    if (bossAltDirty) {
      bossAltHealth = nextBossAlt;
    }
  }

  if (scoreDirty || bombsDirty) renderScore();
  if (meterDirty) renderMeter();
  if (bossDirty || bossAltDirty) renderBoss();
}
