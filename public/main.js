/*****************************************************************
 main.js — on-rails shooter (compact modular version)
******************************************************************/

import * as THREE from './libs/build/three.module.js';
import { GLTFLoader } from './libs/examples/jsm/loaders/GLTFLoader.js';
import { initBossAndross } from './boss-andross.js';

import { initAsteroids       } from './asteroids.js';
import { initPlayerShip      } from './player-ship.js';
import { initAllyShip        } from './ally-ship.js';
import { createLaserSystem   } from './laser-system.js';
import { addStarfield        } from './starfield.js';
import { addScore, loseHeart, setBurstMeter, syncHud, getScore, setBombs } from './hud.js';
import { createCollisionSystem } from './collision-system.js';
import { updateDiagnostics, renderDiagnosticsLines     } from './diagnostics.js';
import { initEnemySystem, CAPTURED_ENEMY_PATHS } from './enemy-system.js';
import { initFrigateEnemySystem } from './frigate-enemy.js';
import { BEHAVIOURS          } from './behaviours.js';      // NEW
import { initBossSystem      } from './boss-system.js';   // NEW
import { initPickupSystem } from './pickup-system.js';
import { initPlatformSystem } from './platform-system.js';
import { initStationTurretSystem } from './station-turret.js';
import { createBoltPool } from './bolt-pool.js';
import { initStationBoss } from './station-boss.js';
import { initAsteroidPassage } from './asteroid-passage.js';
import { createExplosionPool } from './explosion-pool.js';
import { OrbitControls } from './libs/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from './libs/examples/jsm/controls/TransformControls.js';

/* enable cache so preloaded GLTFs are reused */
THREE.Cache.enabled = true;
const isElectron = Boolean(typeof window !== 'undefined' && window?.process?.versions?.electron);
const RUNNING_IN_WORKER = (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope)
  || Boolean(globalThis.__IS_RENDER_WORKER);
const EDITOR_MODE = !RUNNING_IN_WORKER && typeof window !== 'undefined'
  && (window.__EDITOR__ || new URLSearchParams(window.location.search).has('editor'));
const ENABLE_RENDER_WORKER = true; // flip to false to stay on main thread
const USE_RENDER_WORKER = !RUNNING_IN_WORKER && !isElectron && ENABLE_RENDER_WORKER && !EDITOR_MODE;
const ENEMY_CAPTURE_ENABLED = false; // set to false to stop path recording
const LEVEL_INTRO_DURATION_MS = 5000;
const LEVEL_INTRO_TITLE = 'Mission 1: Orbital Assault';
const LEVEL_INTRO_OBJECTIVE = 'Objective: Breach Oblivion Airspace';
const LOADING_PREVIEW_FADE_MS = 3600;
const LOADING_PREVIEW_HOLD_MS = 1350;
const LOADING_PREVIEW_TOTAL_MS = (LOADING_PREVIEW_FADE_MS * 2) + LOADING_PREVIEW_HOLD_MS;
const LOADING_FADE_OUT_MS = 750;
const LOADING_PROGRESS_DURATION_MS = 14000;
const DIALOGUE_POP_DELAY_MS = 5000;
const DIALOGUE_POP_DURATION_MS = 4200;
const PAUSE_KEY = 'KeyP';
const BOMB_KEY = 'KeyB';
const CHARACTER_MATERIAL_MODE = 'lambert'; // 'lambert' for A/B testing
const GAME_KEY_CODES = new Set([
  'KeyA',
  'KeyD',
  'KeyW',
  'KeyS',
  'KeyQ',
  'KeyE',
  PAUSE_KEY,
  BOMB_KEY,
  'ShiftLeft',
  'ShiftRight',
  'KeyJ',
  'KeyN',
  'Space'
]);
let renderWorker = null;
let renderWorkerLaunched = false;
let fallbackRun = null;
let laptopPreset = false;
let allowFpsToggle = true;
let drsOverrunCount = 0;
let drsUnderrunCount = 0;
let dialogueTimer = null;
let dialogueCleanup = null;
const shownDialogueIds = new Set();
const nowMs = () => (
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
);
const stats = {
  startMs: null,
  endMs: null,
  shotsFired: 0,
  shotsHit: 0,
  enemiesDestroyed: 0,
  ringsCollected: 0
};
const SHOT_HIT_BUCKETS = 4096;
const SHOT_HIT_MASK = SHOT_HIT_BUCKETS - 1;
const shotHitBuckets = new Uint32Array(SHOT_HIT_BUCKETS);
const recordShotFired = () => {
  stats.shotsFired += 1;
};
const recordShotHit = (shotId) => {
  const id = shotId >>> 0;
  if (!id) return;
  const idx = id & SHOT_HIT_MASK;
  if (shotHitBuckets[idx] === id) return;
  shotHitBuckets[idx] = id;
  stats.shotsHit += 1;
};
const recordEnemyDestroyed = () => {
  stats.enemiesDestroyed += 1;
};
const recordRingCollected = (count = 1) => {
  if (count > 0) stats.ringsCollected += count;
};
const snapshotStats = (endTimeMs = null) => {
  const endMs = Number.isFinite(endTimeMs) ? endTimeMs : nowMs();
  const startMs = Number.isFinite(stats.startMs) ? stats.startMs : endMs;
  return {
    timeMs: Math.max(0, endMs - startMs),
    shotsFired: stats.shotsFired,
    shotsHit: stats.shotsHit,
    enemiesDestroyed: stats.enemiesDestroyed,
    ringsCollected: stats.ringsCollected
  };
};
const formatTime = (ms) => {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};
const buildStatsLines = (snapshot) => {
  if (!snapshot) return [];
  const shotsFired = snapshot.shotsFired ?? 0;
  const shotsHit = snapshot.shotsHit ?? 0;
  const accuracy = shotsFired > 0 ? Math.round((shotsHit / shotsFired) * 100) : 0;
  return [
    `TIME: ${formatTime(snapshot.timeMs ?? 0)}`,
    `ENEMIES DESTROYED: ${snapshot.enemiesDestroyed ?? 0}`,
    `ACCURACY: ${accuracy}% (${shotsHit}/${shotsFired})`,
    `RINGS COLLECTED: ${snapshot.ringsCollected ?? 0}`
  ];
};
let introPauseBlockUntilMs = 0;
const setIntroPauseBlock = (durationMs) => {
  const duration = typeof durationMs === 'number' ? durationMs : 0;
  introPauseBlockUntilMs = nowMs() + Math.max(0, duration);
};
const isPauseBlockedForIntro = () => nowMs() < introPauseBlockUntilMs;
const degToRad = (v) => THREE.MathUtils.degToRad(v ?? 0);
const parseRotation = (cfg = {}) => {
  const rotDeg = cfg.rotationDeg ?? cfg.rotationDegrees ?? null;
  if (rotDeg) {
    return {
      x: degToRad(rotDeg.x),
      y: degToRad(rotDeg.y),
      z: degToRad(rotDeg.z)
    };
  }
  const rot = cfg.rotation ?? null;
  if (rot && (rot.unit === 'deg' || rot.units === 'deg' || rot.deg === true)) {
    return {
      x: degToRad(rot.x),
      y: degToRad(rot.y),
      z: degToRad(rot.z)
    };
  }
  return rot ?? { x: 0, y: 0, z: 0 };
};
const editorObjects = [];
const registerEditorObject = (root, { group, index, ref } = {}) => {
  if (!EDITOR_MODE || !root) return;
  root.traverse(o => {
    o.matrixAutoUpdate = true;
    o.matrixWorldNeedsUpdate = true;
  });
  root.userData.editorRef = ref ?? null;
  root.userData.editorGroup = group ?? null;
  root.userData.editorIndex = Number.isFinite(index) ? index : null;
  root.userData.editorSelectable = true;
  root.traverse(o => {
    if (o.isMesh) o.userData.__editorRoot = root;
  });
  editorObjects.push(root);
};
function createPauseMenu() {
  if (RUNNING_IN_WORKER || typeof document === 'undefined') return null;
  const root = document.createElement('div');
  Object.assign(root.style, {
    position: 'fixed',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0,0,0,0.6)',
    color: '#0f0',
    font: '14px/1.5 monospace',
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    textAlign: 'center',
    opacity: '0',
    pointerEvents: 'none',
    zIndex: 9999,
    transition: 'opacity 0.2s ease'
  });

  const panel = document.createElement('div');
  Object.assign(panel.style, {
    padding: '14px 20px',
    border: '1px solid #0f0',
    background: 'rgba(0,0,0,0.7)',
    boxShadow: '0 0 12px rgba(0,255,0,0.15)',
    minWidth: '260px'
  });

  const title = document.createElement('div');
  title.textContent = 'PAUSED';
  title.style.fontSize = '16px';
  title.style.marginBottom = '8px';

  const list = document.createElement('div');
  Object.assign(list.style, {
    display: 'grid',
    rowGap: '4px'
  });
  [
    'Move: W/A/S/D',
    'Shoot: Space',
    'Charge: Hold Space',
    'Roll: Q/E',
    'Bank: Hold Shift',
    'Bomb: B',
    'Boost: J',
    'Brake: N',
    'Pause/Menu: P'
  ].forEach(text => {
    const line = document.createElement('div');
    line.textContent = text;
    list.appendChild(line);
  });

  panel.appendChild(title);
  panel.appendChild(list);

  const restartWrap = document.createElement('div');
  Object.assign(restartWrap.style, {
    marginTop: '12px',
    display: 'none',
    flexDirection: 'column',
    alignItems: 'center',
    rowGap: '8px'
  });

  const startOverButton = document.createElement('button');
  startOverButton.type = 'button';
  startOverButton.textContent = 'Start Over?';
  Object.assign(startOverButton.style, {
    padding: '6px 14px',
    border: '1px solid #0f0',
    background: 'rgba(0,0,0,0.7)',
    color: '#0f0',
    font: '13px monospace',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    cursor: 'pointer'
  });

  const startOverHint = document.createElement('div');
  startOverHint.textContent = '[Enter]';
  Object.assign(startOverHint.style, {
    fontSize: '11px',
    opacity: '0.7',
    letterSpacing: '0.06em'
  });

  const confirmWrap = document.createElement('div');
  Object.assign(confirmWrap.style, {
    display: 'none',
    flexDirection: 'column',
    alignItems: 'center',
    rowGap: '8px'
  });

  const confirmLabel = document.createElement('div');
  confirmLabel.textContent = 'Are you sure?';

  const confirmButtons = document.createElement('div');
  Object.assign(confirmButtons.style, {
    display: 'flex',
    gap: '12px',
    justifyContent: 'center'
  });

  const yesButton = document.createElement('button');
  yesButton.type = 'button';
  yesButton.textContent = 'Yes';
  Object.assign(yesButton.style, {
    padding: '5px 12px',
    border: '1px solid #0f0',
    background: 'rgba(0,0,0,0.7)',
    color: '#0f0',
    font: '12px monospace',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    cursor: 'pointer'
  });

  const noButton = document.createElement('button');
  noButton.type = 'button';
  noButton.textContent = 'No';
  Object.assign(noButton.style, {
    padding: '5px 12px',
    border: '1px solid #0f0',
    background: 'rgba(0,0,0,0.7)',
    color: '#0f0',
    font: '12px monospace',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    cursor: 'pointer'
  });

  const confirmHint = document.createElement('div');
  Object.assign(confirmHint.style, {
    display: 'grid',
    rowGap: '2px',
    fontSize: '11px',
    opacity: '0.7',
    letterSpacing: '0.06em',
    justifyItems: 'center'
  });
  const confirmHintEnter = document.createElement('div');
  confirmHintEnter.textContent = '[Enter]';
  const confirmHintKeys = document.createElement('div');
  confirmHintKeys.textContent = 'A: Yes / D: No';
  confirmHint.appendChild(confirmHintEnter);
  confirmHint.appendChild(confirmHintKeys);

  const setButtonActive = (button, active) => {
    button.style.boxShadow = active ? '0 0 10px rgba(0,255,0,0.5)' : 'none';
    button.style.background = active ? 'rgba(0,0,0,0.85)' : 'rgba(0,0,0,0.7)';
  };

  confirmButtons.appendChild(yesButton);
  confirmButtons.appendChild(noButton);
  confirmWrap.appendChild(confirmLabel);
  confirmWrap.appendChild(confirmButtons);
  confirmWrap.appendChild(confirmHint);

  restartWrap.appendChild(startOverButton);
  restartWrap.appendChild(startOverHint);
  restartWrap.appendChild(confirmWrap);
  panel.appendChild(restartWrap);
  root.appendChild(panel);
  document.body.appendChild(root);

  let visible = false;
  let showRestart = false;
  let mode = 'main';
  let confirmChoice = 'no';
  let keyHandler = null;

  const setConfirmChoice = (choice) => {
    confirmChoice = choice === 'yes' ? 'yes' : 'no';
    const yesActive = confirmChoice === 'yes';
    setButtonActive(yesButton, yesActive);
    setButtonActive(noButton, !yesActive);
    try {
      (yesActive ? yesButton : noButton).focus({ preventScroll: true });
    } catch {
      (yesActive ? yesButton : noButton).focus();
    }
  };

  const setMode = (nextMode) => {
    mode = nextMode === 'confirm' ? 'confirm' : 'main';
    if (mode === 'main') {
      confirmWrap.style.display = 'none';
      startOverButton.style.display = showRestart ? 'inline-block' : 'none';
      startOverHint.style.display = showRestart ? 'block' : 'none';
      if (showRestart) {
        setButtonActive(startOverButton, true);
        try {
          startOverButton.focus({ preventScroll: true });
        } catch {
          startOverButton.focus();
        }
      } else {
        setButtonActive(startOverButton, false);
      }
    } else {
      startOverButton.style.display = 'none';
      startOverHint.style.display = 'none';
      confirmWrap.style.display = 'flex';
      setConfirmChoice('no');
    }
  };

  const attachKeyHandler = () => {
    if (keyHandler) return;
    keyHandler = (event) => {
      if (!visible || !showRestart) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        if (mode === 'main') {
          startOverButton.click();
        } else if (confirmChoice === 'yes') {
          yesButton.click();
        } else {
          noButton.click();
        }
        return;
      }
      if (mode === 'confirm' && !event.repeat) {
        if (event.code === 'KeyA' || event.code === 'KeyD') {
          event.preventDefault();
          event.stopPropagation();
          setConfirmChoice(confirmChoice === 'yes' ? 'no' : 'yes');
        }
      }
    };
    document.addEventListener('keydown', keyHandler);
  };

  const detachKeyHandler = () => {
    if (!keyHandler) return;
    document.removeEventListener('keydown', keyHandler);
    keyHandler = null;
  };

  startOverButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    setMode('confirm');
  });

  yesButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    window.location.reload();
  });

  noButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    setMode('main');
  });

  const setVisible = (next, titleText) => {
    visible = Boolean(next);
    if (titleText) title.textContent = titleText;
    root.style.opacity = visible ? '1' : '0';
    root.style.pointerEvents = visible ? 'auto' : 'none';
    if (!visible) {
      detachKeyHandler();
      setMode('main');
      return;
    }
    if (showRestart) {
      attachKeyHandler();
    } else {
      detachKeyHandler();
    }
  };
  return {
    show: (titleText, options = {}) => {
      showRestart = Boolean(options.showRestart);
      restartWrap.style.display = showRestart ? 'flex' : 'none';
      setMode('main');
      setVisible(true, titleText);
    },
    hide: () => setVisible(false),
    setVisible
  };
}
function createEndScreen() {
  if (RUNNING_IN_WORKER || typeof document === 'undefined') return null;
  const root = document.createElement('div');
  Object.assign(root.style, {
    position: 'fixed',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0,0,0,0.75)',
    color: '#0f0',
    font: '16px/1.5 monospace',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    textAlign: 'center',
    opacity: '0',
    pointerEvents: 'none',
    zIndex: 10002,
    transition: 'opacity 0.3s ease'
  });

  const panel = document.createElement('div');
  Object.assign(panel.style, {
    padding: '18px 28px',
    border: '1px solid #0f0',
    background: 'rgba(0,0,0,0.8)',
    boxShadow: '0 0 16px rgba(0,255,0,0.18)',
    minWidth: '280px',
    pointerEvents: 'auto'
  });

  const title = document.createElement('div');
  title.style.fontSize = '18px';
  title.style.marginBottom = '8px';

  const scoreLine = document.createElement('div');
  scoreLine.style.fontSize = '14px';
  scoreLine.style.letterSpacing = '0.06em';

  const statsWrap = document.createElement('div');
  Object.assign(statsWrap.style, {
    marginTop: '8px',
    display: 'none',
    fontSize: '12px',
    letterSpacing: '0.05em',
    lineHeight: '1.5'
  });

  const badgeRow = document.createElement('div');
  Object.assign(badgeRow.style, {
    marginTop: '10px',
    display: 'none',
    justifyContent: 'center',
    gap: '8px'
  });

  const restartButton = document.createElement('button');
  restartButton.type = 'button';
  restartButton.textContent = 'Play Again?';
  Object.assign(restartButton.style, {
    marginTop: '12px',
    padding: '6px 14px',
    border: '1px solid #0f0',
    background: 'rgba(0,0,0,0.7)',
    color: '#0f0',
    font: '13px monospace',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    cursor: 'pointer',
    display: 'none'
  });
  restartButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    window.location.reload();
  });
  restartButton.style.boxShadow = 'none';

  const restartHint = document.createElement('div');
  restartHint.textContent = '[Enter]';
  Object.assign(restartHint.style, {
    marginTop: '6px',
    fontSize: '11px',
    opacity: '0.7',
    letterSpacing: '0.06em',
    display: 'none'
  });

  let enterHandler = null;
  let restartHintAnim = null;
  const attachEnterHandler = () => {
    if (enterHandler) return;
    enterHandler = (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      event.stopPropagation();
      restartButton.click();
    };
    document.addEventListener('keydown', enterHandler);
  };
  const detachEnterHandler = () => {
    if (!enterHandler) return;
    document.removeEventListener('keydown', enterHandler);
    enterHandler = null;
  };

  panel.appendChild(title);
  panel.appendChild(scoreLine);
  panel.appendChild(statsWrap);
  panel.appendChild(badgeRow);
  panel.appendChild(restartButton);
  panel.appendChild(restartHint);
  root.appendChild(panel);
  document.body.appendChild(root);

  const show = ({ titleText = '', scoreText = '', statsLines = [], showRestart = false, badgeSources = [] } = {}) => {
    title.textContent = titleText;
    if (scoreText) {
      scoreLine.textContent = scoreText;
      scoreLine.style.display = 'block';
    } else {
      scoreLine.textContent = '';
      scoreLine.style.display = 'none';
    }
    if (Array.isArray(statsLines) && statsLines.length) {
      statsWrap.innerHTML = '';
      statsLines.forEach(line => {
        const row = document.createElement('div');
        row.textContent = line;
        statsWrap.appendChild(row);
      });
      statsWrap.style.display = 'block';
    } else {
      statsWrap.innerHTML = '';
      statsWrap.style.display = 'none';
    }
    if (Array.isArray(badgeSources) && badgeSources.length) {
      badgeRow.innerHTML = '';
      badgeSources.forEach(src => {
        const img = document.createElement('img');
        img.src = src;
        Object.assign(img.style, {
          width: '3em',
          height: '3em',
          objectFit: 'contain',
          imageRendering: 'auto',
          filter: 'drop-shadow(0 0 4px rgba(0,255,0,0.25))'
        });
        badgeRow.appendChild(img);
      });
      badgeRow.style.display = 'flex';
    } else {
      badgeRow.innerHTML = '';
      badgeRow.style.display = 'none';
    }
    restartButton.style.display = showRestart ? 'inline-block' : 'none';
    restartButton.style.boxShadow = showRestart ? '0 0 12px rgba(0,255,0,0.45)' : 'none';
    restartButton.style.background = showRestart ? 'rgba(0,0,0,0.85)' : 'rgba(0,0,0,0.7)';
    restartHint.style.display = showRestart ? 'block' : 'none';
    root.style.pointerEvents = showRestart ? 'auto' : 'none';
    if (restartHintAnim) {
      restartHintAnim.cancel();
      restartHintAnim = null;
    }
    const shouldPulse = titleText === 'GAME OVER'
      || titleText === 'MISSION COMPLETE'
      || titleText === 'MISSION ACCOMPLISHED';
    if (showRestart && shouldPulse) {
      restartHintAnim = restartHint.animate(
        [{ opacity: 0.2 }, { opacity: 1 }, { opacity: 0.2 }],
        { duration: 1600, iterations: Infinity }
      );
    }
    if (showRestart) {
      attachEnterHandler();
      try {
        restartButton.focus({ preventScroll: true });
      } catch {
        restartButton.focus();
      }
    } else {
      detachEnterHandler();
    }
    root.style.opacity = '1';
  };
  const hide = () => {
    root.style.pointerEvents = 'none';
    root.style.opacity = '0';
    if (restartHintAnim) {
      restartHintAnim.cancel();
      restartHintAnim = null;
    }
    detachEnterHandler();
  };
  return { show, hide };
}
function createLoadingUI({ onPreviewDone = () => {}, onFinish = () => {} } = {}) {
  if (RUNNING_IN_WORKER || typeof document === 'undefined') return null;
  const root = document.createElement('div');
  Object.assign(root.style, {
    position: 'fixed',
    inset: 0,
    pointerEvents: 'none',
    zIndex: 9998,
    opacity: '1',
    transition: `opacity ${LOADING_FADE_OUT_MS}ms ease`
  });

  const curtain = document.createElement('div');
  Object.assign(curtain.style, {
    position: 'absolute',
    inset: 0,
    background: '#000',
    opacity: '1',
    transition: `opacity ${LOADING_PREVIEW_FADE_MS}ms ease`
  });

  const hud = document.createElement('div');
  Object.assign(hud.style, {
    position: 'absolute',
    left: '50%',
    bottom: '10vh',
    transform: 'translateX(-50%)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px',
    zIndex: 2,
    opacity: '1',
    transition: 'opacity 0.25s ease'
  });

  const controlsWrap = document.createElement('div');
  Object.assign(controlsWrap.style, {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: '0',
    pointerEvents: 'none',
    zIndex: 1,
    transition: 'opacity 0.4s ease'
  });

  const titleWrap = document.createElement('div');
  Object.assign(titleWrap.style, {
    position: 'absolute',
    left: 0,
    top: 0,
    width: '100%',
    height: '0px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none'
  });

  const titleImage = document.createElement('img');
  titleImage.src = './textures/title.png';
  titleImage.alt = 'Game Title';
  Object.assign(titleImage.style, {
    width: '32vw',
    maxWidth: '360px',
    minWidth: '200px',
    height: 'auto',
    imageRendering: 'auto',
    objectFit: 'contain',
    opacity: '0.95'
  });
  titleWrap.appendChild(titleImage);

  const controlsPanel = document.createElement('div');
  Object.assign(controlsPanel.style, {
    padding: '14px 20px',
    border: '1px solid #0f0',
    background: 'rgba(0,0,0,0.7)',
    boxShadow: '0 0 12px rgba(0,255,0,0.15)',
    minWidth: '260px',
    color: '#0f0',
    font: '14px/1.5 monospace',
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    textAlign: 'center'
  });

  const controlsTitle = document.createElement('div');
  controlsTitle.textContent = 'Controls';
  controlsTitle.style.fontSize = '16px';
  controlsTitle.style.marginBottom = '8px';

  const controlsList = document.createElement('div');
  Object.assign(controlsList.style, {
    display: 'grid',
    rowGap: '4px'
  });
  const controlsText = EDITOR_MODE
    ? [
        'Camera: LMB rotate / RMB pan / Wheel zoom',
        'Select: Click mesh',
        'Move: G',
        'Rotate: R',
        'Scale: S',
        'Save: Ctrl+S',
        'Escape: Deselect'
      ]
    : [
        'Move: W/A/S/D',
        'Shoot: Space',
        'Charge: Hold Space',
        'Roll: Q/E',
        'Bank: Hold Shift',
        'Bomb: B',
        'Boost: J',
        'Brake: N',
        'Pause/Menu: P'
      ];
  controlsText.forEach(text => {
    const line = document.createElement('div');
    line.textContent = text;
    controlsList.appendChild(line);
  });
  controlsPanel.appendChild(controlsTitle);
  controlsPanel.appendChild(controlsList);
  controlsWrap.appendChild(titleWrap);
  controlsWrap.appendChild(controlsPanel);

  const label = document.createElement('div');
  label.textContent = 'Plotting Course... 0%';
  Object.assign(label.style, {
    font: '14px monospace',
    color: '#0f0',
    letterSpacing: '0.04em',
    textTransform: 'uppercase'
  });

  const barWrap = document.createElement('div');
  Object.assign(barWrap.style, {
    width: '60vw',
    maxWidth: '460px',
    minWidth: '220px',
    height: '8px',
    border: '1px solid #0f0',
    background: 'rgba(0,0,0,0.55)',
    boxShadow: '0 0 10px rgba(0,255,0,0.2)'
  });

  const barFill = document.createElement('div');
  Object.assign(barFill.style, {
    width: '0%',
    height: '100%',
    background: '#0f0',
    transition: 'width 0.2s linear'
  });
  barWrap.appendChild(barFill);
  hud.appendChild(label);
  hud.appendChild(barWrap);

  root.appendChild(curtain);
  root.appendChild(controlsWrap);
  root.appendChild(hud);
  document.body.appendChild(root);

  const updateTitleLayout = () => {
    const rect = controlsPanel.getBoundingClientRect();
    const topSpace = Math.max(0, rect.top);
    titleWrap.style.height = `${topSpace}px`;
  };
  const handleResize = () => updateTitleLayout();
  window.addEventListener('resize', handleResize);
  requestAnimationFrame(updateTitleLayout);

  let progress = 0;
  let targetProgress = 0;
  let animFrame = 0;
  const startMs = (typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? performance.now()
    : Date.now();
  const stepIntervalMs = LOADING_PROGRESS_DURATION_MS / 99;
  let lastStepMs = startMs;
  let previewActive = false;
  let previewTimer = null;
  let previewEndTimer = null;
  let previewAnimation = null;
  let previewPhase = 'idle';
  let previewEverShown = false;
  let finishPending = false;
  let finishCallback = null;
  let finished = false;
  let controlsShown = false;
  let controlsSuppressed = false;
  const notifyPreviewDone = () => {
    if (finished || finishPending) return;
    if (typeof onPreviewDone === 'function') onPreviewDone();
  };

  const applyProgress = (pct, allowFull = false) => {
    const cap = allowFull ? 100 : 99;
    const next = Math.max(0, Math.min(cap, Math.floor(pct)));
    if (next === progress) return;
    progress = next;
    label.textContent = `Plotting Course... ${progress}%`;
    barFill.style.width = `${progress}%`;
    if (!controlsSuppressed && !controlsShown && progress >= 33) {
      controlsShown = true;
      controlsWrap.style.opacity = '1';
    }
  };

  const setProgressFromCounts = (loaded, total) => {
    if (!total || total <= 0) {
      targetProgress = Math.max(targetProgress, 0);
      return;
    }
    const pct = Math.max(0, Math.min(99, Math.floor((loaded / total) * 99)));
    targetProgress = Math.max(targetProgress, pct);
  };

  const tickProgress = () => {
    const now = (typeof performance !== 'undefined' && typeof performance.now === 'function')
      ? performance.now()
      : Date.now();
    const elapsed = Math.max(0, now - startMs);
    const autoProgress = Math.min(99, Math.floor(elapsed / stepIntervalMs));
    const goal = Math.min(99, Math.max(targetProgress, autoProgress));
    if (goal > progress && now - lastStepMs >= stepIntervalMs) {
      lastStepMs = now;
      applyProgress(progress + 1);
    }
    animFrame = requestAnimationFrame(tickProgress);
  };
  animFrame = requestAnimationFrame(tickProgress);

  const finalizeFinish = (immediate = false) => {
    if (finished) return;
    finished = true;
    if (animFrame) cancelAnimationFrame(animFrame);
    applyProgress(100, true);
    if (previewTimer) clearTimeout(previewTimer);
    if (previewEndTimer) clearTimeout(previewEndTimer);
    window.removeEventListener('resize', handleResize);
    if (immediate) {
      if (typeof root.remove === 'function') root.remove();
      else if (root.parentNode) root.parentNode.removeChild(root);
      if (typeof finishCallback === 'function') finishCallback();
      finishCallback = null;
      return;
    }
    curtain.style.opacity = '0';
    root.style.opacity = '0';
    setTimeout(() => {
      if (typeof root.remove === 'function') root.remove();
      else if (root.parentNode) root.parentNode.removeChild(root);
      if (typeof finishCallback === 'function') finishCallback();
      finishCallback = null;
    }, LOADING_FADE_OUT_MS + 50);
  };

  const previewFlash = () => {
    if (previewActive) return;
    if (controlsShown && !controlsSuppressed) {
      controlsSuppressed = true;
      controlsWrap.style.opacity = '0';
    }
    previewActive = true;
    previewPhase = 'fadingIn';
    previewEverShown = true;
    if (previewTimer) clearTimeout(previewTimer);
    if (previewEndTimer) clearTimeout(previewEndTimer);
    if (previewAnimation) {
      previewAnimation.cancel();
      previewAnimation = null;
    }
    curtain.style.opacity = '1';
    const totalMs = (LOADING_PREVIEW_FADE_MS * 2) + LOADING_PREVIEW_HOLD_MS;
    if (typeof curtain.animate === 'function') {
      const fadeInOffset = LOADING_PREVIEW_FADE_MS / totalMs;
      const holdOffset = (LOADING_PREVIEW_FADE_MS + LOADING_PREVIEW_HOLD_MS) / totalMs;
      previewAnimation = curtain.animate([
        { opacity: 1, offset: 0 },
        { opacity: 0, offset: fadeInOffset },
        { opacity: 0, offset: holdOffset },
        { opacity: 1, offset: 1 }
      ], {
        duration: totalMs,
        easing: 'ease',
        fill: 'forwards'
      });
      previewAnimation.onfinish = () => {
        previewActive = false;
        previewPhase = 'idle';
        previewAnimation = null;
        notifyPreviewDone();
        if (finishPending) finalizeFinish(true);
      };
      previewAnimation.oncancel = () => {
        previewActive = false;
        previewPhase = 'idle';
        previewAnimation = null;
      };
      return;
    }
    curtain.style.opacity = '0';
    previewTimer = setTimeout(() => {
      previewPhase = 'fadingOut';
      curtain.style.opacity = '1';
      previewEndTimer = setTimeout(() => {
        previewActive = false;
        previewPhase = 'idle';
        notifyPreviewDone();
        if (finishPending) finalizeFinish(true);
      }, LOADING_PREVIEW_FADE_MS);
    }, LOADING_PREVIEW_FADE_MS + LOADING_PREVIEW_HOLD_MS);
  };

  const finish = (onDone) => {
    if (typeof onDone === 'function') finishCallback = onDone;
    if (finishPending) return;
    finishPending = true;
    if (typeof onFinish === 'function') onFinish();
    hud.style.opacity = '0';
    if (previewActive) return;
    finalizeFinish(previewEverShown);
  };

  return { setProgressFromCounts, previewFlash, finish };
}
function showDialoguePopup({
  portraitSrc = '',
  textLines = [],
  durationMs = 4200
} = {}) {
  if (RUNNING_IN_WORKER || typeof document === 'undefined') return () => {};
  const basePortrait = 86;
  const portraitSize = Math.max(48, Math.round(window.innerHeight * 0.15));
  const scale = portraitSize / basePortrait;
  const lines = Array.isArray(textLines) ? textLines : [String(textLines ?? '')];
  const root = document.createElement('div');
  Object.assign(root.style, {
    position: 'fixed',
    left: `${Math.round(24 * scale)}px`,
    bottom: `${Math.round(24 * scale)}px`,
    display: 'flex',
    alignItems: 'center',
    gap: `${Math.round(12 * scale)}px`,
    zIndex: 10020,
    pointerEvents: 'none',
    opacity: '0',
    transition: 'opacity 0.2s ease'
  });

  const portraitWrap = document.createElement('div');
  Object.assign(portraitWrap.style, {
    width: `${portraitSize}px`,
    height: `${portraitSize}px`,
    border: '1px solid #0f0',
    background: 'rgba(0,0,0,0.6)',
    boxShadow: '0 0 10px rgba(0,255,0,0.2)',
    overflow: 'hidden',
    transform: 'scaleY(0.04)',
    transformOrigin: 'center',
    transition: 'transform 0.25s ease-out'
  });

  const portraitImg = document.createElement('img');
  portraitImg.src = portraitSrc;
  Object.assign(portraitImg.style, {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    opacity: '0',
    transition: 'opacity 0.2s ease'
  });
  portraitWrap.appendChild(portraitImg);

  const textPanel = document.createElement('div');
  Object.assign(textPanel.style, {
    minHeight: `${portraitSize}px`,
    padding: `${Math.round(10 * scale)}px ${Math.round(14 * scale)}px`,
    border: '1px solid rgba(0,255,0,0.6)',
    background: 'rgba(30,120,200,0.35)',
    color: '#fff',
    font: `${Math.max(12, Math.round(14 * scale))}px/1.4 monospace`,
    letterSpacing: '0.03em',
    maxWidth: `${Math.round(360 * scale)}px`,
    transform: 'scaleX(0)',
    transformOrigin: 'left center',
    transition: 'transform 0.3s ease-out'
  });
  const text = document.createElement('div');
  text.textContent = lines.join('\n');
  text.style.whiteSpace = 'pre-line';
  textPanel.appendChild(text);

  root.appendChild(portraitWrap);
  root.appendChild(textPanel);
  document.body.appendChild(root);

  const revealTimer = setTimeout(() => {
    portraitImg.style.opacity = '1';
  }, 180);
  const textTimer = setTimeout(() => {
    textPanel.style.transform = 'scaleX(1)';
  }, 260);
  requestAnimationFrame(() => {
    root.style.opacity = '1';
    portraitWrap.style.transform = 'scaleY(1)';
  });

  const hideTimer = setTimeout(() => {
    root.style.opacity = '0';
  }, Math.max(800, durationMs));
  const removeTimer = setTimeout(() => {
    if (typeof root.remove === 'function') root.remove();
    else if (root.parentNode) root.parentNode.removeChild(root);
  }, Math.max(900, durationMs + 350));

  return () => {
    clearTimeout(revealTimer);
    clearTimeout(textTimer);
    clearTimeout(hideTimer);
    clearTimeout(removeTimer);
    if (typeof root.remove === 'function') root.remove();
    else if (root.parentNode) root.parentNode.removeChild(root);
  };
}
const handleDialoguePayload = (payload = {}) => {
  if (RUNNING_IN_WORKER) return;
  const id = payload.id;
  if (id && shownDialogueIds.has(id)) return;
  if (id) shownDialogueIds.add(id);
  const durationMs = Number.isFinite(payload.durationMs)
    ? payload.durationMs
    : DIALOGUE_POP_DURATION_MS;
  const portraitSrc = payload.portraitSrc ?? './textures/protag.png';
  const textLines = payload.textLines ?? [];
  if (dialogueCleanup) {
    dialogueCleanup();
    dialogueCleanup = null;
  }
  dialogueCleanup = showDialoguePopup({
    portraitSrc,
    textLines,
    durationMs
  });
};
const pauseMenu = (!RUNNING_IN_WORKER && typeof document !== 'undefined')
  ? createPauseMenu()
  : null;
const endScreen = (!RUNNING_IN_WORKER && typeof document !== 'undefined')
  ? createEndScreen()
  : null;
let pauseMenuVisible = false;
let pauseMenuLocked = false;
let endScreenActive = false;
const showPauseMenu = (titleText = 'PAUSED', { lock = false } = {}) => {
  pauseMenuVisible = true;
  if (lock) pauseMenuLocked = true;
  pauseMenu?.show(titleText, { showRestart: !lock && titleText === 'PAUSED' });
};
const hidePauseMenu = ({ force = false } = {}) => {
  if (pauseMenuLocked && !force) return;
  pauseMenuVisible = false;
  pauseMenuLocked = false;
  pauseMenu?.hide();
};
const showEndScreen = ({
  titleText = '',
  scoreText = '',
  statsLines = [],
  showRestart = false,
  badgeSources = []
} = {}) => {
  endScreenActive = true;
  hidePauseMenu({ force: true });
  endScreen?.show({ titleText, scoreText, statsLines, showRestart, badgeSources });
};
const hideEndScreen = () => {
  endScreenActive = false;
  endScreen?.hide();
};
const togglePauseMenu = () => {
  if (endScreenActive) return;
  if (pauseMenuLocked) return;
  if (pauseMenuVisible) {
    hidePauseMenu();
  } else {
    showPauseMenu('PAUSED');
  }
};
const loadingUI = (!RUNNING_IN_WORKER && typeof document !== 'undefined')
  ? createLoadingUI({
      onPreviewDone: () => {},
      onFinish: () => hidePauseMenu({ force: true })
    })
  : null;
function reportLoadingProgress(loaded, total) {
  if (RUNNING_IN_WORKER && typeof self?.postMessage === 'function') {
    self.postMessage({ type: 'loadingProgress', loaded, total });
    return;
  }
  loadingUI?.setProgressFromCounts(loaded, total);
}
function triggerLoadingPreview() {
  if (RUNNING_IN_WORKER && typeof self?.postMessage === 'function') {
    self.postMessage({ type: 'loadingPreview' });
    return;
  }
  loadingUI?.previewFlash();
}
function startLevelIntroOverlay(options = {}) {
  const durationMs = typeof options.durationMs === 'number'
    ? options.durationMs
    : LEVEL_INTRO_DURATION_MS;
  const titleText = typeof options.title === 'string'
    ? options.title
    : LEVEL_INTRO_TITLE;
  const objectiveText = typeof options.objective === 'string'
    ? options.objective
    : LEVEL_INTRO_OBJECTIVE;
  const instantBackdrop = Boolean(options.instantBackdrop);
  if (RUNNING_IN_WORKER || typeof document === 'undefined' || durationMs <= 0) {
    return () => {};
  }
  setIntroPauseBlock(durationMs);
  const introScale = 1.7;
  const root = document.createElement('div');
  Object.assign(root.style, {
    position: 'fixed',
    inset: 0,
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    background: 'rgba(0,0,0,0.35)',
    opacity: '0',
    pointerEvents: 'none',
    zIndex: 10000,
    transition: 'opacity 0.35s ease'
  });
  if (instantBackdrop) {
    root.style.opacity = '1';
    root.style.transition = 'none';
  }
  const panel = document.createElement('div');
  Object.assign(panel.style, {
    marginTop: '10vh',
    padding: '16px 26px',
    border: '1px solid #0f0',
    background: 'rgba(0,0,0,0.75)',
    color: '#0f0',
    font: '16px/1.4 monospace',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    textAlign: 'center',
    opacity: '0',
    transform: `translateY(-24px) scale(${introScale})`,
    transformOrigin: 'top center',
    transition: 'transform 0.45s ease, opacity 0.45s ease'
  });
  const title = document.createElement('div');
  title.textContent = titleText;
  title.style.fontSize = '18px';
  title.style.marginBottom = '6px';
  const objective = document.createElement('div');
  objective.textContent = objectiveText;
  objective.style.fontSize = '13px';
  panel.appendChild(title);
  panel.appendChild(objective);
  root.appendChild(panel);
  document.body.appendChild(root);

  requestAnimationFrame(() => {
    if (!instantBackdrop) {
      root.style.opacity = '1';
    }
    panel.style.opacity = '1';
    panel.style.transform = `translateY(0) scale(${introScale})`;
  });

  const exitMs = Math.max(0, durationMs - 700);
  const exitTimer = setTimeout(() => {
    panel.style.opacity = '0';
    panel.style.transform = `translateY(-24px) scale(${introScale})`;
    root.style.opacity = '0';
  }, exitMs);
  const removeTimer = setTimeout(() => {
    if (typeof root.remove === 'function') root.remove();
    else if (root.parentNode) root.parentNode.removeChild(root);
  }, durationMs + 300);

  return () => {
    clearTimeout(exitTimer);
    clearTimeout(removeTimer);
    if (typeof root.remove === 'function') root.remove();
    else if (root.parentNode) root.parentNode.removeChild(root);
  };
}
const scheduleIdle = (() => {
  let queued = false;
  const tasks = [];
  const runner = (deadline) => {
    queued = false;
    while (tasks.length) {
      // if we’re out of idle time, reschedule remaining tasks
      if (deadline && typeof deadline.timeRemaining === 'function' && deadline.timeRemaining() <= 1) break;
      const fn = tasks.shift();
      try { fn(); } catch (err) { console.warn('idle task error', err); }
    }
    if (tasks.length) {
      queued = true;
      const ric = typeof requestIdleCallback === 'function'
        ? requestIdleCallback
        : (cb) => setTimeout(() => cb({ timeRemaining: () => 5 }), 0);
      ric(runner);
    }
  };
  return (fn) => {
    tasks.push(fn);
    if (!queued) {
      queued = true;
      const ric = typeof requestIdleCallback === 'function'
        ? requestIdleCallback
        : (cb) => setTimeout(() => cb({ timeRemaining: () => 5 }), 0);
      ric(runner);
    }
  };
})();
if (!GLTFLoader.prototype._uncullPatchApplied) {
  const _origLoadAsync = GLTFLoader.prototype.loadAsync;
  GLTFLoader.prototype.loadAsync = function (url, ...rest) {
    return _origLoadAsync.call(this, url, ...rest).then((gltf) => {
      if (gltf?.scene) {
        gltf.scene.traverse(o => {
          if (o.isMesh) o.frustumCulled = false;
        });
      }
      return gltf;
    });
  };
  GLTFLoader.prototype._uncullPatchApplied = true;
}

function installEnemyPathDump() {
  if (RUNNING_IN_WORKER || typeof globalThis === 'undefined') return;
  const g = globalThis;

  function downloadPaths(paths) {
    if (typeof document === 'undefined') {
      console.warn('No document available to download JSON.');
      return 0;
    }
    const payload = { paths };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'enemy-paths-captured.json';
    a.click();
    URL.revokeObjectURL(url);
    return paths?.length ?? 0;
  }

  async function dumpFromWorker() {
    if (!renderWorker) {
      console.warn('No render worker active; nothing to dump from worker.');
      return 0;
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        renderWorker.removeEventListener('message', onMsg);
        reject(new Error('Timed out waiting for worker path dump'));
      }, 5000);
      const onMsg = (evt) => {
        const msg = evt.data;
        if (!msg || msg.type !== 'pathsDump') return;
        clearTimeout(timer);
        renderWorker.removeEventListener('message', onMsg);
        const count = downloadPaths(msg.payload?.paths ?? []);
        resolve(count);
      };
      renderWorker.addEventListener('message', onMsg);
      renderWorker.postMessage({ type: 'dumpPaths' });
    });
  }

  g.dumpEnemyPaths = async () => {
    if (!ENEMY_CAPTURE_ENABLED) {
      console.warn('Enemy path capture is off. Set window.__CAPTURE_ENEMY_PATHS__ = true before loading to enable.');
      return 0;
    }
    // If game is running on main thread, dump directly; otherwise ask worker.
    if (!renderWorkerLaunched) {
      return downloadPaths(CAPTURED_ENEMY_PATHS);
    }
    try {
      return await dumpFromWorker();
    } catch (err) {
      console.warn('Could not dump paths from worker:', err?.message || err);
      return 0;
    }
  };

  if (ENEMY_CAPTURE_ENABLED) {
    console.info('[dev] Enemy path capture ON; call  to download JSON.');
  } else {
    console.info('[dev] Enemy path capture OFF; set window.__CAPTURE_ENEMY_PATHS__ = true before load to record paths.');
  }
}

installEnemyPathDump();

/* ─── render worker bootstrap (main thread only) ───────────── */
if (USE_RENDER_WORKER) {
  const hostCanvas = typeof document !== 'undefined'
    ? document.getElementById('c')
    : null;
  if (hostCanvas) {
    hostCanvas.width = innerWidth;
    hostCanvas.height = innerHeight;
    hostCanvas.style.width = '100vw';
    hostCanvas.style.height = '100vh';
  }
  let fallbackTriggered = false;
  const triggerFallback = () => {
    if (fallbackTriggered) return;
    fallbackTriggered = true;
    renderWorkerLaunched = false;
    console.warn('Render worker failed; falling back to main-thread render.');
    fallbackRun && fallbackRun();
  };
  if (hostCanvas?.transferControlToOffscreen && typeof Worker !== 'undefined') {
    try {
      const offscreen = hostCanvas.transferControlToOffscreen();
      const worker = new Worker('./render-worker.js', { type: 'module' });
      const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
      worker.postMessage({
        type: 'init',
        canvas: offscreen,
        size: { w: innerWidth, h: innerHeight },
        dpr
      }, [offscreen]);
      hostCanvas.dataset.offscreen = '1';
      renderWorkerLaunched = true;
      renderWorker = worker;

      const inputBatch = [];
      let inputFlushScheduled = false;
      const scheduleInputFlush = (fn) => {
        if (typeof queueMicrotask === 'function') {
          queueMicrotask(fn);
        } else {
          Promise.resolve().then(fn);
        }
      };
      const flushInputBatch = () => {
        inputFlushScheduled = false;
        if (!inputBatch.length) return;
        worker.postMessage({ type: 'inputBatch', events: inputBatch });
        inputBatch.length = 0;
      };
      const queueInputEvent = (event, code, repeat) => {
        inputBatch.push({ event, code, repeat: Boolean(repeat) });
        if (!inputFlushScheduled) {
          inputFlushScheduled = true;
          scheduleInputFlush(flushInputBatch);
        }
      };
      const forwardedDown = new Set();
      const forwardKey = (ev) => {
        const code = ev?.code;
        if (!code || !GAME_KEY_CODES.has(code)) return;
        if (typeof ev.preventDefault === 'function') ev.preventDefault();
        if (code === PAUSE_KEY && ev.type === 'keydown' && !ev.repeat) {
          if (isPauseBlockedForIntro()) return;
          togglePauseMenu();
        }
        if (ev.type === 'keydown') {
          if (ev.repeat) return;
          if (forwardedDown.has(code)) return;
          forwardedDown.add(code);
        } else if (ev.type === 'keyup') {
          if (!forwardedDown.has(code)) return;
          forwardedDown.delete(code);
        } else {
          return;
        }
        queueInputEvent(ev.type, code, ev.repeat);
      };
      window.addEventListener('keydown', forwardKey);
      window.addEventListener('keyup', forwardKey);
      window.addEventListener('blur', () => {
        if (!forwardedDown.size) return;
        forwardedDown.forEach((code) => {
          queueInputEvent('keyup', code, false);
        });
        forwardedDown.clear();
        flushInputBatch();
      });
      let lastResize = {
        w: innerWidth,
        h: innerHeight,
        dpr: typeof devicePixelRatio === 'number' ? devicePixelRatio : 1
      };
      const readCanvasSize = () => {
        const rect = typeof hostCanvas?.getBoundingClientRect === 'function'
          ? hostCanvas.getBoundingClientRect()
          : null;
        const w = rect?.width || hostCanvas?.clientWidth || innerWidth;
        const h = rect?.height || hostCanvas?.clientHeight || innerHeight;
        return { w, h };
      };
      const sendResize = (force = false) => {
        const { w, h } = readCanvasSize();
        const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
        if (!force && w === lastResize.w && h === lastResize.h && dpr === lastResize.dpr) return;
        lastResize = { w, h, dpr };
        worker.postMessage({
          type: 'resize',
          size: { w, h },
          dpr
        });
      };
      window.addEventListener('resize', sendResize);
      if (typeof ResizeObserver !== 'undefined' && hostCanvas) {
        const ro = new ResizeObserver(sendResize);
        ro.observe(hostCanvas);
      }
      requestAnimationFrame(sendResize);
      requestAnimationFrame(() => sendResize(true));
      setTimeout(() => sendResize(true), 250);
      setTimeout(() => sendResize(true), 1000);

      let pendingHudState = null;
      let hudScheduled = false;
      let pendingDiagLines = null;
      let diagScheduled = false;
      const flushHud = () => {
        hudScheduled = false;
        if (pendingHudState) {
          syncHud(pendingHudState);
          pendingHudState = null;
        }
      };
      const flushDiag = () => {
        diagScheduled = false;
        if (pendingDiagLines) {
          renderDiagnosticsLines(pendingDiagLines);
          pendingDiagLines = null;
        }
      };

      worker.addEventListener('message', (evt) => {
        const msg = evt.data;
        if (!msg) return;
        if (msg.type === 'loadingProgress') {
          loadingUI?.setProgressFromCounts(msg.loaded, msg.total);
        } else if (msg.type === 'loadingPreview') {
          loadingUI?.previewFlash();
        } else if (msg.type === 'introStart') {
          setIntroPauseBlock(msg.payload?.durationMs ?? LEVEL_INTRO_DURATION_MS);
          if (loadingUI) {
            loadingUI.finish(() => startLevelIntroOverlay({ ...(msg.payload ?? {}), instantBackdrop: true }));
          } else {
            startLevelIntroOverlay({ ...(msg.payload ?? {}), instantBackdrop: true });
          }
        } else if (msg.type === 'dialogue') {
          const payload = msg.payload ?? {};
          const delayMs = Number.isFinite(payload.delayMs) ? payload.delayMs : 0;
          const durationMs = Number.isFinite(payload.durationMs) ? payload.durationMs : DIALOGUE_POP_DURATION_MS;
          const portraitSrc = payload.portraitSrc ?? './textures/protag.png';
          const textLines = payload.textLines ?? ['Everybody, stay alert!'];
          setTimeout(() => {
            handleDialoguePayload({
              id: payload.id,
              portraitSrc,
              textLines,
              durationMs
            });
          }, Math.max(0, delayMs));
        } else if (msg.type === 'hud') {
          pendingHudState = msg.state;
          if (!hudScheduled) {
            hudScheduled = true;
            requestAnimationFrame(flushHud);
          }
        } else if (msg.type === 'gameOver') {
          const score = typeof msg.payload?.score === 'number'
            ? msg.payload.score
            : getScore();
          const statsLines = buildStatsLines(msg.payload?.stats);
          showEndScreen({ titleText: 'GAME OVER', scoreText: `SCORE ${score}`, statsLines, showRestart: true });
        } else if (msg.type === 'missionComplete') {
          const score = typeof msg.payload?.score === 'number'
            ? msg.payload.score
            : getScore();
          const escortSurvived = Boolean(msg.payload?.escortSurvived);
          const missionTitle = msg.payload?.stationBossDestroyed && escortSurvived
            ? 'MISSION COMPLETE'
            : 'MISSION ACCOMPLISHED';
          const statsLines = buildStatsLines(msg.payload?.stats);
          const badgeSources = [
            './textures/red.png',
            escortSurvived ? './textures/green.png' : './textures/green-gray.png',
            './textures/yellow.png'
          ];
          showEndScreen({
            titleText: missionTitle,
            scoreText: `SCORE ${score}`,
            statsLines,
            showRestart: true,
            badgeSources
          });
        } else if (msg.type === 'diag') {
          pendingDiagLines = msg.payload?.lines ?? [];
          if (!diagScheduled) {
            diagScheduled = true;
            requestAnimationFrame(flushDiag);
          }
        } else if (msg.type === 'log') {
          console.log('[render-worker]', ...(msg.args ?? []));
      } else if (msg.type === 'error' || msg.type === 'fatal') {
        console.error('[render-worker error]', msg.error?.message ?? msg, msg.error?.stack ?? '');
        triggerFallback();
      } else if (msg.type === 'pathsDump') {
        // handled by dumpEnemyPaths promise listeners
      } else if (msg.type === 'ready') {
        console.log('[render-worker] ready');
      }
      });
      worker.addEventListener('error', (err) => {
        console.error('[render-worker] uncaught error', err?.message || err);
        triggerFallback();
      });
    } catch (err) {
      console.warn('Render worker init failed, using main thread', err);
      renderWorkerLaunched = false;
    }
  } else {
    console.warn('OffscreenCanvas not supported; staying on main thread renderer.');
  }
}

async function runGame() {

const FREE_ROAM = true;
let introActive = false;
let introStartMs = 0;
let pauseActive = false;
let allowPause = false;
let gameOverActive = false;
let levelCompleteActive = false;
let playerAlive = true;
let gameOverStartMs = 0;
let stationBossDestroyed = false;
let escortSurvived = false;
let missionCompleteTimer = null;
const STARTING_BOMBS = 3;
let bombCount = STARTING_BOMBS;
const MISSION_COMPLETE_DELAY_MS = 350;
const canEnemyFire = () => (
  playerAlive
  && !gameOverActive
  && !levelCompleteActive
  && !introActive
  && !pauseActive
);
let lasers = null;
let allySystem = null;
let pickupSystem = null;
const laserUpdateOptions = { allowFire: true };
const tmpDropPos = new THREE.Vector3();
const maybeDropHealRing = (ship, pos) => {
  if (!ship?.userData?.dropHealRing) return;
  ship.userData.dropHealRing = false;
  if (!pickupSystem?.spawnHealRingAt) return;
  if (pos) {
    tmpDropPos.copy(pos);
    pickupSystem.spawnHealRingAt(tmpDropPos);
  } else if (ship.getWorldPosition) {
    ship.getWorldPosition(tmpDropPos);
    pickupSystem.spawnHealRingAt(tmpDropPos);
  }
};

/* ─── simple loading overlay ───────────────────────────────── */
function createLoadingOverlay() {
  return {
    update: (loaded, total) => {
      reportLoadingProgress(loaded, total);
    },
    remove: () => {
      reportLoadingProgress(1, 1);
    }
  };
}

function prewarmPrograms(renderer, scene, camera) {
  const mats = new Set();
  scene.traverse(o => {
    if (!o.isMesh || !o.material) return;
    if (Array.isArray(o.material)) o.material.forEach(m => mats.add(m));
    else mats.add(o.material);
  });
  const dummyGeo = new THREE.BoxGeometry(1, 1, 1);
  const dummyScene = new THREE.Scene();
  mats.forEach(mat => {
    const mesh = new THREE.Mesh(dummyGeo, mat);
    mesh.visible = true;
    dummyScene.add(mesh);
  });
  renderer.compile(dummyScene, camera);
}

/* ─── preload all GLTF models up-front to avoid midgame hitches ── */
async function preloadModels() {
  const overlay = createLoadingOverlay();
  const manager = new THREE.LoadingManager();
  manager.onProgress = (_, loaded, total) => overlay.update(loaded, total);
  const loader = new GLTFLoader(manager);

  const MODEL_PATHS = Array.from(new Set([
    './models/player_starfighter_body_only.glb',
    './models/player_starfighter_v2.glb',
    './models/blue1.glb',
    './models/dark1.glb',
    './models/dark2.glb',
    './models/dark3.glb',
    './models/dark4_jet.glb',
    './models/dark_frigate.glb',
    './models/player_starfighter_l_wing_only.glb',
    './models/player_starfighter_r_wing_only.glb',
    './models/asteroid.glb',
    './models/asteroid_passage.glb',
    './models/asteroid_flat.glb',
    './models/drill_tunnel.glb',
    './models/bldg_step_up.glb',
    './models/bldg_bridge_dome.glb',
    './models/bldg_industry_stacks.glb',
    './models/bldg_tower_plat.glb',
    './models/bldg_asteroid_mine.glb',
    './models/bldg_mine_tower_front.glb',
    './models/bldg_mine_tower_back.glb',
    './models/bldg_mine_tunnel.glb',
    './models/bldg_triple_tower_basic_new.glb',
    './models/bldg_mine_plat.glb',
    './models/asteroid_big_bulb.glb',
    './models/asteroid_miner.glb',
    './models/bldg_walk.glb',
    './models/bldg_energy_hub_basic_new.glb',
    './models/prop_door.glb',
    './models/station.glb',
    './models/turret.glb',
    './models/plat.glb',
    './models/boss_head.glb',
    './models/boss_eyes.glb',
    './models/boss_left_hand.glb',
    './models/boss_left_palm.glb',
    './models/boss_right_hand.glb',
    './models/boss_right_palm.glb',
    './models/pickup_bomb.glb'
  ]));

  await Promise.all(MODEL_PATHS.map(p => loader.loadAsync(p).catch(err => {
    console.warn('Preload failed', p, err);
  })));

  overlay.remove();
}

/* ─── load curve + spawns ───────────────────────────────────── */
const [curveData, spawns, bakedPathFile] = await Promise.all([
  fetch('./scene/curve.json').then(r => r.json()),
  fetch('./scene/spawns.json').then(r => r.json()),
  fetch('./scene/enemy-paths-captured.json').then(r => r.json()).catch(() => ({ paths: [] }))
]);
const ALL_BAKED_PATHS = bakedPathFile?.paths ?? [];

const MAX_BAKED_MATCH_DIST = 250;
const MAX_BAKED_MATCH_DIST_SQ = MAX_BAKED_MATCH_DIST * MAX_BAKED_MATCH_DIST;
function buildBakedPathMap(spawnArray, modelPath) {
  const map = new Map();
  if (!Array.isArray(spawnArray) || !spawnArray.length || !ALL_BAKED_PATHS.length) return map;
  const candidates = ALL_BAKED_PATHS.filter(p => !modelPath || p.model === modelPath);
  const used = new Set();
  spawnArray.forEach((spawn, idx) => {
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < candidates.length; i++) {
      if (used.has(i)) continue;
      const p = candidates[i];
      if (!p.spawn) continue;
      const dx = (p.spawn.x ?? 0) - spawn.x;
      const dy = (p.spawn.y ?? 0) - spawn.y;
      const dz = (p.spawn.z ?? 0) - spawn.z;
      const d2 = dx*dx + dy*dy + dz*dz;
      if (d2 < bestDist) {
        bestDist = d2;
        best = i;
      }
    }
    if (best >= 0 && bestDist <= MAX_BAKED_MATCH_DIST_SQ) {
      used.add(best);
      const entry = candidates[best];
      const samples = entry.samples ?? [];
      const duration = samples.length ? samples[samples.length - 1].t : 0;
      map.set(idx, { samples, duration });
    } else {
      console.warn('No baked path for spawn', spawn, 'model', modelPath);
    }
  });
  return map;
}

/* ─── renderer ──────────────────────────────────────────────── */
function obtainCanvas() {
  if (RUNNING_IN_WORKER) {
    let c = globalThis.__OFFSCREEN_CANVAS ?? null;
    if (!c && typeof OffscreenCanvas !== 'undefined') {
      // fallback: create a local offscreen so we don't crash; host should still send one
      c = new OffscreenCanvas(innerWidth || 800, innerHeight || 600);
      globalThis.__OFFSCREEN_CANVAS = c;
    }
    if (c && typeof c.width === 'undefined') {
      c.width = innerWidth || 800;
      c.height = innerHeight || 600;
    }
    return c;
  }
  let c = document.getElementById('c');
  if (!c || c.dataset.offscreen === '1') {
    c = document.createElement('canvas');
    c.id = 'c';
    c.style.display = 'block';
    document.body.prepend(c);
  }
  return c;
}

const canvas   = obtainCanvas();
if (!canvas) {
  const errMsg = 'No canvas available for renderer (worker)';
  if (RUNNING_IN_WORKER && typeof self?.postMessage === 'function') {
    self.postMessage({ type: 'fatal', error: { message: errMsg } });
  }
  throw new Error(errMsg);
}
if (RUNNING_IN_WORKER) {
  if (typeof canvas.width !== 'number') {
    canvas.width = (typeof innerWidth === 'number' ? innerWidth : 800);
    canvas.height = (typeof innerHeight === 'number' ? innerHeight : 600);
  }
  if (typeof canvas.style === 'undefined') {
    canvas.style = { width: '', height: '' };
  }
}
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  powerPreference: 'high-performance'
});
const PIXEL_RATIO_CAP = 1.0;
let initialPixelRatio = Math.min(
  (typeof globalThis.devicePixelRatio === 'number' ? globalThis.devicePixelRatio : 1),
  PIXEL_RATIO_CAP
);
renderer.setPixelRatio(initialPixelRatio);
let renderScale = 1;
const setRendererSize = (w, h) => {
  const sw = Math.max(1, Math.floor(w * renderScale));
  const sh = Math.max(1, Math.floor(h * renderScale));
  renderer.setSize(sw, sh, !RUNNING_IN_WORKER);
};
setRendererSize(innerWidth, innerHeight);
const lastViewportSize = { w: 0, h: 0 };
const readViewportSize = () => {
  if (!canvas) return null;
  if (RUNNING_IN_WORKER) {
    return {
      w: canvas.width || innerWidth || 800,
      h: canvas.height || innerHeight || 600
    };
  }
  const rect = typeof canvas.getBoundingClientRect === 'function'
    ? canvas.getBoundingClientRect()
    : null;
  return {
    w: rect?.width || canvas.clientWidth || innerWidth || 800,
    h: rect?.height || canvas.clientHeight || innerHeight || 600
  };
};
const syncViewportSize = (force = false, sizeOverride = null) => {
  if (RUNNING_IN_WORKER && !sizeOverride) return;
  const size = sizeOverride ?? readViewportSize();
  if (!size) return;
  const rawW = size.w;
  const rawH = size.h;
  if (!Number.isFinite(rawW) || !Number.isFinite(rawH) || rawW < 2 || rawH < 2) return;
  const w = Math.max(1, Math.round(rawW));
  const h = Math.max(1, Math.round(rawH));
  if (!force && w === lastViewportSize.w && h === lastViewportSize.h) return;
  lastViewportSize.w = w;
  lastViewportSize.h = h;
  setRendererSize(w, h);
  if (camera) {
    const nextAspect = w / h;
    if (Math.abs(camera.aspect - nextAspect) > 1e-4) {
      camera.aspect = nextAspect;
      camera.updateProjectionMatrix();
    }
  }
};
let pendingResize = null;
let lastKnownCanvasSize = {
  w: (typeof innerWidth === 'number' && innerWidth) ? innerWidth : 800,
  h: (typeof innerHeight === 'number' && innerHeight) ? innerHeight : 600
};
const getPreferredViewportSize = () => {
  if (RUNNING_IN_WORKER) {
    if (pendingResize?.size?.w && pendingResize?.size?.h) return pendingResize.size;
    if (lastKnownCanvasSize?.w && lastKnownCanvasSize?.h) return lastKnownCanvasSize;
    return {
      w: (typeof innerWidth === 'number' && innerWidth) ? innerWidth : 800,
      h: (typeof innerHeight === 'number' && innerHeight) ? innerHeight : 600
    };
  }
  return readViewportSize();
};
const forceViewportSync = () => {
  const size = getPreferredViewportSize();
  if (!size) return;
  lastKnownCanvasSize = { w: size.w, h: size.h };
  syncViewportSize(true, size);
};
// Start a bit below full res on likely iGPU to ease bandwidth
{
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const rendererStr = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) || '' : '';
  if (/intel/i.test(rendererStr)) {
    laptopPreset = true;
    renderScale = 0.65; // render a bit below full res on iGPU
    allowFpsToggle = false; // force cap on laptop preset
    fpsCapEnabled = true;
    initialPixelRatio = Math.min(initialPixelRatio, 0.55);
    renderer.setPixelRatio(initialPixelRatio);
    setRendererSize(innerWidth, innerHeight);
    console.warn('[preset] laptop preset applied (Intel GPU detected)');
  }
}

// --- color output (safe across Three versions) ---
if ('outputColorSpace' in renderer) {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}


function syncRendererToCanvas() {
  if (!canvas) return;
  syncViewportSize(true);
}
if (!RUNNING_IN_WORKER) {
  window.addEventListener('resize', syncRendererToCanvas);
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(syncRendererToCanvas);
    ro.observe(canvas);
  }
  requestAnimationFrame(syncRendererToCanvas);
}

/* ─── scene & lights ────────────────────────────────────────── */
const scene = new THREE.Scene();
scene.fog   = new THREE.FogExp2(0x000000, 0.0002);

/* ─── skybox (single equirectangular image) ─────────────────── */
/* ─── skybox (single equirectangular image) ─────────────────── */
{
  // Change this to whatever you want:
  const SKY_YAW = THREE.MathUtils.degToRad(180); // rotate left/right (around Y)

  const pmremGen = new THREE.PMREMGenerator(renderer);
  pmremGen.compileEquirectangularShader();

  const applySkyTex = (tex) => {
    if (!tex) return;
    console.log('[sky] applying sky texture');
    // correct color space (safe across Three versions)
    if ('colorSpace' in tex) {
      tex.colorSpace = THREE.SRGBColorSpace;
    }

    tex.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = tex;

    const envRT = pmremGen.fromEquirectangular(tex);
    scene.environment = envRT.texture;

    if (scene.backgroundRotation) scene.backgroundRotation.set(0, SKY_YAW, 0);
    if (scene.environmentRotation) scene.environmentRotation.set(0, SKY_YAW, 0);

    pmremGen.dispose();
  };

  const skyPath = './textures/sky/space_4k.jpg';
  if (RUNNING_IN_WORKER && typeof fetch === 'function' && typeof createImageBitmap === 'function') {
    console.log('[sky] worker fetch+bitmap path', skyPath);
    fetch(skyPath)
      .then(r => r.blob())
      .then(blob => createImageBitmap(blob, { imageOrientation: 'flipY' }))
      .then(img => {
        const tex = new THREE.Texture(img);
        tex.needsUpdate = true;
        applySkyTex(tex);
      })
      .catch(err => {
        console.warn('Sky fetch->bitmap failed, falling back to TextureLoader', err);
        new THREE.TextureLoader().load(skyPath, applySkyTex, undefined, e => console.warn('Sky load failed', e));
      });
  } else {
    console.log('[sky] TextureLoader path', skyPath);
    new THREE.TextureLoader().load(skyPath, applySkyTex, undefined, e => console.warn('Sky load failed', e));
  }
}



scene.add(new THREE.HemisphereLight(0x88aaff, 0x080820, 0.6));
const sun = new THREE.DirectionalLight(0xffffff, 1);
sun.position.set(60, 80, 40);
scene.add(sun);

/* ─── starfield ─────────────────────────────────────────────── */
addStarfield(scene);

/* ─── camera rig ────────────────────────────────────────────── */
const camera   = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 4000);
forceViewportSync();
const railNode = new THREE.Object3D();
const steerNode= new THREE.Object3D();
railNode.add(steerNode);
steerNode.add(camera);
camera.position.set(0, 2, -10);
scene.add(railNode);

/* ─── rail helper ───────────────────────────────────────────── */
const railCurve = new THREE.CatmullRomCurve3(
  curveData.points.map(p => new THREE.Vector3(p.x, p.y, p.z)),
  curveData.closed ?? false, 'catmullrom', curveData.tension ?? 0.5
);
scene.add(new THREE.Line(
  new THREE.BufferGeometry().setFromPoints(railCurve.getPoints(400)),
  new THREE.LineBasicMaterial({ color: 0xffffff })
));

  /* ─── preload all models before instantiating game objects ─── */
  await preloadModels();
  forceViewportSync();
  renderer.render(scene, camera);



/* ─── asteroids ─────────────────────────────────────────────── */
const { group: asteroidGroup, update: updateAsteroids } =
      await initAsteroids(scene, spawns.asteroid ?? [], './models/asteroid.glb', {
        materialMode: 'standard'
      });
if (EDITOR_MODE && asteroidGroup) {
  const asteroidSpawns = Array.isArray(spawns.asteroid) ? spawns.asteroid : [];
  asteroidGroup.children.forEach((rock, idx) => {
    if (!rock) return;
    registerEditorObject(rock, { group: 'asteroid', index: idx, ref: asteroidSpawns[idx] });
  });
}

/* ─── asteroid passage set piece (solid with tunnel) ───────── */
const passageDefs = Array.isArray(spawns.asteroidPassage)
  ? spawns.asteroidPassage
  : [spawns.asteroidPassage ?? { x: 0, y: 0, z: -320, scale: 60 }];
const asteroidPassages = await Promise.all(passageDefs.map(cfg =>
  initAsteroidPassage(scene, {
    position : { x: cfg.x ?? 0, y: cfg.y ?? 0, z: cfg.z ?? 0 },
    rotation : parseRotation(cfg),
    scale    : cfg.scale ?? 30,
    materialMode: 'lambert',
    cellSize: cfg.cellSize ?? 'auto'
  })
));
const primaryPassage = asteroidPassages[0] ?? null;
if (EDITOR_MODE) {
  asteroidPassages.forEach((piece, idx) => {
    const mesh = piece?.getMesh?.();
    if (mesh) registerEditorObject(mesh, { group: 'asteroidPassage', index: idx, ref: passageDefs[idx] });
  });
}

/* ─── additional static hazards ────────────────────────────── */
const drillDefs = Array.isArray(spawns.drillTunnel)
  ? spawns.drillTunnel
  : [spawns.drillTunnel ?? { x: 0, y: 12, z: -180, scale: 30 }];
const drillTunnel = await Promise.all(drillDefs.map(cfg =>
  initAsteroidPassage(scene, {
    path     : './models/drill_tunnel.glb',
    position : { x: cfg.x ?? 0, y: cfg.y ?? 0, z: cfg.z ?? 0 },
    rotation : parseRotation(cfg),
    scale    : cfg.scale ?? 30,
    materialMode: 'lambert',
    cellSize: cfg.cellSize ?? 'auto'
  })
));
if (EDITOR_MODE) {
  drillTunnel.forEach((piece, idx) => {
    const mesh = piece?.getMesh?.();
    if (mesh) registerEditorObject(mesh, { group: 'drillTunnel', index: idx, ref: drillDefs[idx] });
  });
}

const flatDefs = Array.isArray(spawns.asteroidFlat)
  ? spawns.asteroidFlat
  : [spawns.asteroidFlat ?? { x: 0, y: -18, z: -180, scale: 26 }];
const flatAsteroid = await Promise.all(flatDefs.map(cfg =>
  (async () => {
    const piece = await initAsteroidPassage(scene, {
      path     : './models/asteroid_flat.glb',
      position : { x: cfg.x ?? 0, y: cfg.y ?? 0, z: cfg.z ?? 0 },
      rotation : parseRotation(cfg),
      scale    : cfg.scale ?? 26,
      materialMode: 'lambert',
      cellSize: cfg.cellSize ?? 'auto'
    });
    const mesh = piece?.getMesh?.();
    if (mesh?.userData && typeof cfg.scale === 'number' && cfg.scale >= 150) {
      mesh.userData.laserCollisionEnabled = false;
      mesh.userData.cullBehindZFactor = 0.5;
    }
        if (
      mesh?.userData &&
      Math.abs((cfg.x ?? 0) - 0) < 1e-3 &&
      Math.abs((cfg.y ?? 0) - (-139)) < 1e-3 &&
      Math.abs((cfg.z ?? 0) - (-5990)) < 1e-3
    ) {
      mesh.userData.activateDist = 800;
    }
    return piece;
  })()
));
if (EDITOR_MODE) {
  flatAsteroid.forEach((piece, idx) => {
    const mesh = piece?.getMesh?.();
    if (mesh) registerEditorObject(mesh, { group: 'asteroidFlat', index: idx, ref: flatDefs[idx] });
  });
}

const gateBox = new THREE.Box3();
const gateCenter = new THREE.Vector3();
const gateSize = new THREE.Vector3();
function applyLaserGate(mesh) {
  if (!mesh) return;
  mesh.updateWorldMatrix(true, true);
  gateBox.setFromObject(mesh);
  if (gateBox.isEmpty()) return;
  gateBox.getCenter(gateCenter);
  gateBox.getSize(gateSize);
  const radius = Math.max(gateSize.x, gateSize.z) * 0.5;
  mesh.userData.gateCylinder = {
    x: gateCenter.x,
    z: gateCenter.z,
    radius,
    minY: gateBox.min.y,
    maxY: gateBox.max.y
  };
}

/* ─── building set pieces (colliders like other static hazards) ───────── */
const BUILDING_MODELS = {
  step_up: './models/bldg_step_up.glb',
  bridge_dome: './models/bldg_bridge_dome.glb',
  industry_stacks: './models/bldg_industry_stacks.glb',
  tower_plat: './models/bldg_tower_plat.glb',
  asteroid_mine: './models/bldg_asteroid_mine.glb',
  mine_tower_front: './models/bldg_mine_tower_front.glb',
  mine_tower_back: './models/bldg_mine_tower_back.glb',
  mine_tunnel: './models/bldg_mine_tunnel.glb',
  triple_tower: './models/bldg_triple_tower_basic_new.glb',
  mine_plat: './models/bldg_mine_plat.glb',
  asteroid_big_bulb: './models/asteroid_big_bulb.glb',
  asteroid_miner: './models/asteroid_miner.glb',
  bldg_walk: './models/bldg_walk.glb',
  energy_hub: './models/bldg_energy_hub_basic_new.glb',
  prop_door: './models/prop_door.glb'
};
const buildingCfgs = Array.isArray(spawns.buildings) ? spawns.buildings : [];
const buildingPieces = await Promise.all(
  buildingCfgs.map(async cfg => {
    const path = cfg.path
      ?? BUILDING_MODELS[cfg.type]
      ?? BUILDING_MODELS[cfg.name]
      ?? BUILDING_MODELS[cfg.id]
      ?? './models/bldg_step_up.glb';
    const piece = await initAsteroidPassage(scene, {
      path,
      position : { x: cfg.x ?? 0, y: cfg.y ?? 0, z: cfg.z ?? 0 },
      rotation : parseRotation(cfg),
      scale    : cfg.scale ?? 30,
      visible  : cfg.visible ?? true,
      materialMode: 'lambert',
      cellSize: cfg.cellSize ?? 'auto'
    });
    const mesh = piece?.getMesh?.();
    if (mesh?.userData) {
      mesh.userData.modelPath = path;
      if (Number.isFinite(cfg.activateDist)) {
        mesh.userData.activateDist = cfg.activateDist;
      } else if (Number.isFinite(cfg.renderDist)) {
        mesh.userData.activateDist = cfg.renderDist;
      }
      if (path.endsWith('bldg_asteroid_mine.glb')) {
        mesh.userData.cullBehindZFactor = 4;
      }
      if (path.endsWith('asteroid_big_bulb.glb')) {
        mesh.userData.cullBehindZFactor = 4;
      }
      if (path.endsWith('bldg_walk.glb')) {
        mesh.userData.cullBehindZFactor = 4;
      }
      if (path.endsWith('bldg_energy_hub_basic_new.glb')) {
        mesh.userData.cullBehindZFactor = 3;
        mesh.userData.activateDist = 800;
      }
      if (path.endsWith('bldg_mine_tunnel.glb')) {
        mesh.userData.cullBehindZFactor = 3;
        mesh.userData.skipInsideCheck = true;
      }
      if (path.endsWith('bldg_mine_plat.glb')) {
        mesh.userData.cullBehindZFactor = 1.25;
      }
      if (path.endsWith('bldg_mine_tower_front.glb')) {
        mesh.userData.cullBehindZFactor = 0.5;
      }
      if (path.endsWith('bldg_mine_tower_back.glb')) {
        mesh.userData.cullBehindZFactor = 2.25;
      }
      if (path.endsWith('bldg_triple_tower_basic_new.glb')) {
        mesh.userData.cullBehindZFactor = 1.25;
      }
      if (path.endsWith('prop_door.glb')) {
        const propHp = Number.isFinite(cfg.hp) ? cfg.hp : 5;
        mesh.userData.destructible = { hp: propHp };
        mesh.userData.blink = () => {
          const blinkDurationMs = 150;
          if (!mesh.userData._blinkMats) {
            const mats = [];
            mesh.traverse(child => {
              if (!child.isMesh || !child.material) return;
              const list = Array.isArray(child.material) ? child.material : [child.material];
              list.forEach(mat => {
                if (!mat || !mat.emissive) return;
                if (!mat.userData) mat.userData = {};
                if (!mat.userData._origEmissive) mat.userData._origEmissive = mat.emissive.clone();
                mats.push(mat);
              });
            });
            mesh.userData._blinkMats = mats;
          }
          const mats = mesh.userData._blinkMats;
          mats.forEach(mat => mat.emissive.setRGB(1, 0, 0));
          if (mesh.userData._blinkTimer) clearTimeout(mesh.userData._blinkTimer);
          mesh.userData._blinkTimer = setTimeout(() => {
            mats.forEach(mat => {
              if (mat.userData?._origEmissive) mat.emissive.copy(mat.userData._origEmissive);
            });
            mesh.userData._blinkTimer = null;
          }, blinkDurationMs);
        };
        mesh.userData.onDestroyed = (pos) => {
          if (pos) explosions.spawn(pos);
        };
      }

    }
    if (mesh?.userData) {
      applyLaserGate(mesh);
    }
    return piece;
  })
);
if (EDITOR_MODE) {
  buildingPieces.forEach((piece, idx) => {
    const mesh = piece?.getMesh?.();
    if (mesh) registerEditorObject(mesh, { group: 'buildings', index: idx, ref: buildingCfgs[idx] });
  });
}

[...asteroidPassages, ...drillTunnel, ...flatAsteroid].forEach(p => {
  const mesh = p?.getMesh?.();
  if (mesh?.userData) applyLaserGate(mesh);
});

/* toggle to temporarily disable big set pieces/boss for perf testing */

const ENABLE_SET_PIECES = true;
const ENABLE_PLAYER_HAZARD_COLLISIONS = true; // player damage vs set pieces
const ENABLE_LASER_HAZARD_COLLISIONS  = true; // player/enemy lasers vs set pieces
const ENABLE_ENEMY_HAZARD_COLLISIONS  = false ; // enemy vs set-piece hazards
const ENABLE_BAKED_ENEMY_PATHS       = true; // master toggle for baked enemy paths

const staticHazardsRaw = [
  ...drillTunnel,
  ...flatAsteroid,
  ...asteroidPassages.slice(1), // additional passages beyond the primary
  ...buildingPieces
].filter(Boolean);
const staticHazards = ENABLE_SET_PIECES ? staticHazardsRaw : [];
const hazardColliders = ENABLE_SET_PIECES
  ? [primaryPassage, ...staticHazards].map(h => h?.collider).filter(Boolean)
  : [];
const allHazards = ENABLE_SET_PIECES ? [primaryPassage, ...staticHazards] : [];
const hazardEntries = allHazards;

const HAZARD_CULL_Z = 60;

/* ─── explosion pool for defeated enemies ───────────────────── */
const explosions = createExplosionPool(scene, { poolSize: 30, baseSize: 6 });
const largeExplosions = createExplosionPool(scene, { poolSize: 16, baseSize: 18 });
const wingExplosions = createExplosionPool(scene, { poolSize: 8, baseSize: 4 });
const asteroidExplosions = createExplosionPool(scene, {
  poolSize: 20,
  baseSize: 6,
  colors: [0x5b4a3c] // dark gray-brown for rocks only
});
const tmpExplosionPos = new THREE.Vector3();
const stationExplosionOffsets = [
  new THREE.Vector3(12, 6, -4),
  new THREE.Vector3(-10, -6, 8),
  new THREE.Vector3(6, -4, -10)
];
const shouldUseLargeExplosion = (ship) => Boolean(
  ship?.userData?.largeExplosion || ship?.userData?.androssPart
);
const spawnExplosionForShip = (pos, ship) => {
  if (!pos && !ship) return;
  const resolved = ship?.getWorldPosition
    ? ship.getWorldPosition(tmpExplosionPos)
    : pos;
  if (!resolved) return;
  if (shouldUseLargeExplosion(ship)) {
    largeExplosions.spawn(resolved);
  } else {
    explosions.spawn(resolved);
  }
};

/* ─── player fighter ───────────────────────────────────────── */
const { mesh: playerShip,
        update: updateShipAttitude,
        radius: shipRadius,
        startRoll,
        isRolling,
        getRollDir,
        updateTrail,
        setEngineGlowScale } =             // NEW
      await initPlayerShip(steerNode, {
        scene,
        explosionPool: wingExplosions,
        materialMode: CHARACTER_MATERIAL_MODE
      });

/* ─── spinning platform turrets (plural) ──────────────── */
const platSys = await Promise.all(
  (spawns.platform ?? []).map(pt =>
    initPlatformSystem(scene, {
      playerObj : playerShip,
      camera    : camera,
      canFire   : canEnemyFire,
      railCurve,
      spawn     : pt,                 // one turret per entry
      materialMode: CHARACTER_MATERIAL_MODE
    })
  )
);

let stationTurretSystems = [];
let stationSystem;
const STATION_EXPLOSION_SPACING_MS = 240;
const spawnStationBossExplosions = () => {
  const stationMesh = stationSystem?.getMesh?.();
  if (!stationMesh) return;
  const base = stationMesh.getWorldPosition(new THREE.Vector3());
  stationExplosionOffsets.forEach((offset, idx) => {
    const pos = base.clone().add(offset);
    const fire = () => largeExplosions.spawn(pos);
    if (idx === 0) {
      fire();
    } else {
      setTimeout(fire, STATION_EXPLOSION_SPACING_MS * idx);
    }
  });
};
stationSystem = await initStationBoss(scene, {
  playerObj: playerShip,
  camera,
  onDestroyed: () => {
    stationBossDestroyed = true;
    recordEnemyDestroyed();
    addScore(1000);
    spawnStationBossExplosions();
    stationTurretSystems.forEach(sys => {
      const destroyed = sys.destroy?.();
      if (destroyed) {
        addScore(100);
        recordEnemyDestroyed();
      }
    });
  }
});
if (!ENABLE_SET_PIECES) {
  const sm = stationSystem.getMesh();
  if (sm) {
    sm.visible = false;
    sm.userData.dead = true;
  }
}

/* ── set-piece activation (passage, drill, flat, station) ── */
const ACTIVATE_DIST = 600;  // show when within this many units (Z) of player
const setPieces = [];
function prepSetPiece(mesh) {
  if (!mesh) return null;
  mesh.traverse(o => {
    if (o.isMesh && o.material) {
      o.material.transparent = false;
      if (o.material.opacity !== undefined) o.material.opacity = 1;
    }
  });
  mesh.visible = false;
  return { mesh, active: false };
}
setPieces.push(
  ...asteroidPassages.map(p => prepSetPiece(p?.getMesh ? p.getMesh() : null)).filter(Boolean),
  ...drillTunnel.map(p => prepSetPiece(p?.getMesh ? p.getMesh() : null)).filter(Boolean),
  ...flatAsteroid.map(p => prepSetPiece(p?.getMesh ? p.getMesh() : null)).filter(Boolean),
  prepSetPiece(stationSystem.getMesh ? stationSystem.getMesh() : null),
  ...buildingPieces.map(b => prepSetPiece(b?.getMesh ? b.getMesh() : null)).filter(Boolean)
);
const tmpSetpiecePlayer = new THREE.Vector3();
function updateSetPieces() {
  if (!ENABLE_SET_PIECES) return;
  playerShip.getWorldPosition(tmpSetpiecePlayer);
  setPieces.forEach(p => {
    if (!p) return;
    const m = p.mesh;
    if (m.userData?.dead) { m.visible = false; p.active = false; return; }
    const dz = Math.abs(m.position.z - tmpSetpiecePlayer.z);
    const activateDist = m.userData?.activateDist ?? ACTIVATE_DIST;
    const shouldBeVisible = dz < activateDist;
      if (shouldBeVisible === p.active) return; // no change needed
    p.active = shouldBeVisible;
    m.visible = shouldBeVisible;
  });
}
const sharedBoltPool = createBoltPool(scene, { smallCount: 300, bigCount: 60 });
scene.userData.boltPool = sharedBoltPool;
sharedBoltPool.prewarm && sharedBoltPool.prewarm(renderer, camera);

stationTurretSystems = await Promise.all(
  (spawns.stationTurret ?? []).map(cfg =>
    initStationTurretSystem(scene, {
      playerObj: playerShip,
      stationMesh: stationSystem.getMesh(),
      camera,
      spawn: cfg,
      boltPool: sharedBoltPool,
      canFire: canEnemyFire,
      materialMode: CHARACTER_MATERIAL_MODE
    })
  )
);


/* bossSystem init */
let bossSystem;
bossSystem = await initBossSystem(scene,{
  spawn       : spawns.boss,
  playerObj   : playerShip,
  railCurve,
  playerSpeed : 35,
  onDestroyed : (info = {}) => {
    if (!info?.noScore) {
      recordEnemyDestroyed();
      addScore(500);
    }
    const bossMesh = bossSystem?.getMesh?.();
    if (bossMesh) {
      bossMesh.getWorldPosition(tmpExplosionPos);
      largeExplosions.spawn(tmpExplosionPos);
    }
  },
  autoDespawnZ: -3205,
  canFire     : canEnemyFire,
  materialMode: CHARACTER_MATERIAL_MODE
}, sharedBoltPool);
bossSystem.prewarm && bossSystem.prewarm(renderer, camera);

const tmpDeathPos = new THREE.Vector3();
function triggerMissionComplete() {
  if (levelCompleteActive) return;
  levelCompleteActive = true;
  allowPause = false;
  pauseActive = false;
  clearInputState();
  lasers?.clearInput?.();
  const missionTitle = stationBossDestroyed && escortSurvived
    ? 'MISSION COMPLETE'
    : 'MISSION ACCOMPLISHED';
  const finishMission = () => {
    missionCompleteTimer = null;
    stats.endMs = nowMs();
    const statsSnapshot = snapshotStats(stats.endMs);
    const statsLines = buildStatsLines(statsSnapshot);
    const score = getScore();
    if (RUNNING_IN_WORKER && typeof self?.postMessage === 'function') {
      self.postMessage({
        type: 'missionComplete',
        payload: {
          score,
          stationBossDestroyed,
          escortSurvived,
          stats: statsSnapshot
        }
      });
    } else {
      const badgeSources = [
        './textures/red.png',
        escortSurvived ? './textures/green.png' : './textures/green-gray.png',
        './textures/yellow.png'
      ];
      showEndScreen({
        titleText: missionTitle,
        scoreText: `SCORE ${score}`,
        statsLines,
        showRestart: true,
        badgeSources
      });
    }
  };
  if (MISSION_COMPLETE_DELAY_MS > 0) {
    missionCompleteTimer = setTimeout(finishMission, MISSION_COMPLETE_DELAY_MS);
  } else {
    finishMission();
  }
}

/* new end boss (head + hands) */
const androssBoss = await initBossAndross(scene, {
  playerObj: playerShip,
  boltPool: sharedBoltPool,
  railSpeed: 35,
  canFire: canEnemyFire,
  onHeadDestroyed: triggerMissionComplete,
  handCleanupDelay: 350,
  materialMode: CHARACTER_MATERIAL_MODE,
  onDialogue: (payload) => {
    if (RUNNING_IN_WORKER && typeof self?.postMessage === 'function') {
      self.postMessage({ type: 'dialogue', payload });
    } else {
      handleDialoguePayload(payload);
    }
  },
  summonWave: () => {
    // optional: trigger a small wave later using existing enemy systems
  }
  , explosionPool: explosions
});
{
  const tmpPos = new THREE.Vector3();
  const tmpDir = new THREE.Vector3();
  const prevParts = [];
  const prevLayers = [];
  const prevCulls = [];
  const prevBeams = [];
  const prevLightLayers = [];
  const PREWARM_LAYER = 3;
  const rig = androssBoss?.getRig?.();
  if (rig && renderer && camera) {
    const prevRigVis = rig.visible;
    const prevRigPos = rig.position.clone();
    const prevRigQuat = rig.quaternion.clone();
    rig.visible = true;

    const head = androssBoss.getHead?.();
    const hands = androssBoss.getHands?.() ?? [];
    const parts = [
      head?.getMesh?.(),
      head?.getEyes?.(),
      hands[0]?.getMesh?.(),
      hands[0]?.getPalm?.(),
      hands[1]?.getMesh?.(),
      hands[1]?.getPalm?.()
    ].filter(Boolean);
    parts.forEach(p => {
      prevParts.push([p, p.visible]);
      p.visible = true;
    });

    rig.traverse(o => {
      prevLayers.push([o, o.layers.mask]);
      o.layers.set(PREWARM_LAYER);
      if (o.isMesh) {
        prevCulls.push([o, o.frustumCulled]);
        o.frustumCulled = false;
      }
    });
    const beams = head?.getActiveBeams?.() ?? [];
    if (beams.length) {
      camera.getWorldPosition(tmpPos);
      camera.getWorldDirection(tmpDir);
      beams.forEach(beam => {
        if (!beam) return;
        prevBeams.push([
          beam,
          beam.visible,
          beam.position.clone(),
          beam.quaternion.clone(),
          beam.frustumCulled,
          beam.layers.mask
        ]);
        beam.visible = true;
        beam.frustumCulled = false;
        beam.layers.set(PREWARM_LAYER);
        beam.position.copy(tmpPos).addScaledVector(tmpDir, 30);
        beam.quaternion.copy(camera.quaternion);
      });
    }
    scene.traverse(o => {
      if (o.isLight) {
        prevLightLayers.push([o, o.layers.mask]);
        o.layers.enable(PREWARM_LAYER);
      }
    });

    camera.getWorldPosition(tmpPos);
    camera.getWorldDirection(tmpDir);
    rig.position.copy(tmpPos).addScaledVector(tmpDir, 120);
    rig.quaternion.copy(camera.quaternion);

    const prevTarget = renderer.getRenderTarget();
    const prevCameraMask = camera.layers.mask;
    const rt = new THREE.WebGLRenderTarget(16, 16);
    if ('outputColorSpace' in renderer && renderer.outputColorSpace) {
      rt.texture.colorSpace = renderer.outputColorSpace;
    }
    camera.layers.set(PREWARM_LAYER);
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    androssBoss.getMissiles?.()?.prewarm?.(renderer, camera, { layer: PREWARM_LAYER });
    renderer.setRenderTarget(prevTarget);
    rt.dispose();
    camera.layers.mask = prevCameraMask;

    rig.visible = prevRigVis;
    rig.position.copy(prevRigPos);
    rig.quaternion.copy(prevRigQuat);
    prevParts.forEach(([p, vis]) => { p.visible = vis; });
    prevCulls.forEach(([o, c]) => { o.frustumCulled = c; });
    prevLayers.forEach(([o, mask]) => { o.layers.mask = mask; });
    prevLightLayers.forEach(([o, mask]) => { o.layers.mask = mask; });
    prevBeams.forEach(([beam, vis, pos, quat, culled, mask]) => {
      beam.visible = vis;
      beam.position.copy(pos);
      beam.quaternion.copy(quat);
      beam.frustumCulled = culled;
      beam.layers.mask = mask;
    });
  }
}
let androssActive = false;
const ANDROSS_SPAWN_Z = spawns.andross?.z ?? -8500;

function triggerGameOver() {
  if (gameOverActive) return;
  gameOverActive = true;
  playerAlive = false;
  allowPause = false;
  pauseActive = false;
  gameOverStartMs = (typeof performance !== 'undefined' && performance.now)
    ? performance.now()
    : Date.now();
  clearInputState();
  lasers?.clearInput?.();
  if (playerShip?.visible) {
    playerShip.getWorldPosition(tmpDeathPos);
    explosions?.spawn?.(tmpDeathPos);
  }
  if (playerShip) {
    playerShip.visible = false;
    playerShip.userData.dead = true;
  }
  stats.endMs = nowMs();
  const statsSnapshot = snapshotStats(stats.endMs);
  const statsLines = buildStatsLines(statsSnapshot);
  if (RUNNING_IN_WORKER && typeof self?.postMessage === 'function') {
    self.postMessage({ type: 'gameOver', payload: { score: getScore(), stats: statsSnapshot } });
  } else {
    showEndScreen({ titleText: 'GAME OVER', scoreText: `SCORE ${getScore()}`, statsLines, showRestart: true });
  }
}

/* ─── laser system ─────────────────────────────────────────── */

lasers = createLaserSystem(scene,{
  bossMesh   : bossSystem.getMesh(),
  damageBoss : bossSystem.damageBoss,
  stationMesh   : ENABLE_SET_PIECES ? stationSystem.getMesh() : null,
  damageStation : ENABLE_SET_PIECES ? stationSystem.damageStation : (()=>{}),
  bossHitR2  : bossSystem.getRadiusSq(),
  androssParts : androssBoss?.getEnemyParts,

    /* give the laser module a way to fetch every active enemy */
  getEnemies : gatherEnemies,
  camera      : camera,           // ← pass the main Three.js camera
  passageColliders : hazardColliders,
  onEnemyKilled : (pos, ship) => {
    recordEnemyDestroyed();
    spawnExplosionForShip(pos, ship);
    maybeDropHealRing(ship, pos);
  },
  onShotFired: () => recordShotFired(),
  onShotHit: recordShotHit,
  onAsteroidDestroyed: (pos) => {
    pos && asteroidExplosions.spawn(pos);
  }

});
lasers.prewarm && lasers.prewarm(renderer, camera);
lasers.prewarmDual && lasers.prewarmDual(playerShip);
setBombs(bombCount);
if (playerShip?.userData) {
  playerShip.userData.onWingLost = () => {
    if (lasers.resetUpgrades) {
      lasers.resetUpgrades();
    } else {
      lasers.enableDual(false);
      lasers.enableBlue && lasers.enableBlue(false);
    }
  };
}

const handlePlayerHit = (hitPoint = null) => {
  if (!playerAlive || gameOverActive || levelCompleteActive) return;
  let wingHit = null;
  if (hitPoint && playerShip?.userData?.applyWingDamage) {
    wingHit = playerShip.userData.applyWingDamage(hitPoint);
  }
  if (playerShip?.userData) {
    const hitAt = nowMs();
    playerShip.userData.lastHitAt = hitAt;
    if (hitPoint) {
      if (!playerShip.userData.lastHitPoint) {
        playerShip.userData.lastHitPoint = new THREE.Vector3();
      }
      playerShip.userData.lastHitPoint.copy(hitPoint);
    }
    if (wingHit) {
      playerShip.userData.lastWingHit = wingHit;
      playerShip.userData.lastWingHitAt = hitAt;
    }
  }
  const heartsLeft = loseHeart();
  playerShip.userData?.blink?.();
  if (heartsLeft <= 0) triggerGameOver();
};
if (playerShip?.userData) {
  playerShip.userData.onHit = handlePlayerHit;
  playerShip.userData.dead = false;
}

pickupSystem = await initPickupSystem(scene, {
  spawnArray : spawns.pickupDual ?? [],   // points read from spawns.json
  blueSpawnArray : spawns.pickupDualBlue ?? [],
  ringSpawnArray : spawns.pickupHealRing ?? [],
  wingRepairSpawnArray : spawns.pickupWingRepair ?? [],
  bombSpawnArray : spawns.pickupBomb ?? [],
  playerObj  : playerShip,
  lasers,
  onBombPickup : (count = 1) => {
    if (!Number.isFinite(count)) return;
    bombCount = Math.max(0, bombCount + count);
    setBombs(bombCount);
  },
  onRingCollected : (count = 1) => {
    recordRingCollected(count);
  }
});


/* ─── collision system ─────────────────────────────────────── */


const collisions = createCollisionSystem({
  asteroidGroup,
  laserSystem : lasers,
    stationMesh: ENABLE_SET_PIECES ? stationSystem.getMesh() : null,              // new
  damageStation: ENABLE_SET_PIECES ? stationSystem.damageStation : (()=>{}),        // new
  enemyShips  : gatherEnemies,

  enemyLasers : gatherEnemyLasers,         // NEW uses scratch list
  androssBeams: () => androssBoss?.getHead?.().getActiveBeams?.() ?? [],

  bossMesh    : bossSystem.getMesh(),
  damageBoss  : bossSystem.damageBoss,
  playerMesh  : playerShip,
  playerRadius: shipRadius,
  asteroidPassage: ENABLE_SET_PIECES ? primaryPassage : null,
  staticHazards,
  hazardPlayerCollisionEnabled: ENABLE_PLAYER_HAZARD_COLLISIONS,
  hazardLaserCollisionEnabled : ENABLE_LASER_HAZARD_COLLISIONS,
  hazardEnemyCollisionEnabled : ENABLE_ENEMY_HAZARD_COLLISIONS,
  asteroidHazardCollisionEnabled: false,
  isRolling   : isRolling,
  onLaserHit  : () => addScore(10),
  onPlayerHit : handlePlayerHit,
  onEnemyDestroyed : (pos, ship) => {
    recordEnemyDestroyed();
    const scoreValue = ship?.userData?.scoreValue ?? 100;
    addScore(scoreValue);
    spawnExplosionForShip(pos, ship);
    maybeDropHealRing(ship, pos);
  },
  onEnemyNeutralized : (pos, ship) => { spawnExplosionForShip(pos, ship); },
  onShotHit : recordShotHit,
  onAsteroidDestroyed : (pos) => {
    pos && asteroidExplosions.spawn(pos);
  }

});

/* ─── input (steering + dedicated roll/bank keys) ───────────────────── */
const keys        = Object.create(null);   // live key-state map
let shiftHeld = false;
let steerDx = 0;
let steerDy = 0;
const STEER_SMOOTH = 12;
const DEFAULT_SIDE_BANK_DIR = -1;
let lastStrafeDir = DEFAULT_SIDE_BANK_DIR;

/* helper so we change the codes only in one place */
const LEFT   = 'KeyA';
const RIGHT  = 'KeyD';
const UP     = 'KeyW';
const DOWN   = 'KeyS';
const ROLL_LEFT = 'KeyQ';
const ROLL_RIGHT = 'KeyE';

const clearInputState = () => {
  Object.keys(keys).forEach((k) => { keys[k] = false; });
  shiftHeld = false;
  lastStrafeDir = DEFAULT_SIDE_BANK_DIR;
};

const setPauseActive = (next) => {
  const target = Boolean(next);
  if (pauseActive === target) return;
  pauseActive = target;
  if (pauseActive) {
    showPauseMenu('PAUSED');
  } else {
    hidePauseMenu();
  }
  clearInputState();
};

/* FPS cap toggle (default off) */
const FPS_TOGGLE_KEY = null;
const DRS_TOGGLE_KEY = null;
const DEFAULT_TARGET_FPS = 60;
const MAX_FRAME_DT = 0.1; // seconds
const MAX_SIM_STEPS = 5;
const MAX_ACCUMULATED_DT = MAX_FRAME_DT;
let fpsCapEnabled = true;
let targetFps = DEFAULT_TARGET_FPS;
let lastFrameMs = performance.now();
const frameIntervalMs = () => 1000 / targetFps;
const DRS_MIN_PIXEL_RATIO = 0.5;  // lowered for laptop preset
const DRS_MAX_PIXEL_RATIO = Math.min(1.0, initialPixelRatio);  // upper bound
let   drsEnabled = true;
let   drsPixelRatio = DRS_MAX_PIXEL_RATIO;
const frameTimes = [];
const FRAME_WINDOW = 30; // track last 30 frames
let pendingDiag = null;
let pendingCullZ = null;
let simAccumulator = 0;

function handleKeyDown(e) {
  if (e?.code === 'ShiftLeft' || e?.code === 'ShiftRight') {
    shiftHeld = true;
  }
  if (e?.code === PAUSE_KEY && !e.repeat) {
    if (allowPause && !gameOverActive && !levelCompleteActive && !introActive && !isPauseBlockedForIntro()) {
      setPauseActive(!pauseActive);
    }
    if (typeof e.preventDefault === 'function') e.preventDefault();
    return;
  }
  if ((introActive || pauseActive || gameOverActive || levelCompleteActive) && e?.code && GAME_KEY_CODES.has(e.code)) {
    if (typeof e.preventDefault === 'function') e.preventDefault();
    return;
  }
  if (e?.code && GAME_KEY_CODES.has(e.code) && typeof e.preventDefault === 'function') {
    e.preventDefault();
  }
  if (FPS_TOGGLE_KEY && e.code === FPS_TOGGLE_KEY && !e.repeat && allowFpsToggle) {
    fpsCapEnabled = !fpsCapEnabled;
    lastFrameMs = performance.now(); // avoid a big dt on the next tick
  }
  if (DRS_TOGGLE_KEY && e.code === DRS_TOGGLE_KEY && !e.repeat) { // toggle dynamic resolution scaling
    drsEnabled = !drsEnabled;
    if (!drsEnabled) {
      drsPixelRatio = DRS_MAX_PIXEL_RATIO;
      renderer.setPixelRatio(drsPixelRatio);
    }
  }
  if (e.code === BOMB_KEY && !e.repeat) {
    if (bombCount > 0 && playerAlive && lasers?.fireBomb) {
      if (lasers.fireBomb(playerShip)) {
        bombCount = Math.max(0, bombCount - 1);
        setBombs(bombCount);
      }
    }
  }

  if (!e.repeat && (e.code === ROLL_LEFT || e.code === ROLL_RIGHT)) {
    startRoll(e.code === ROLL_LEFT ? +1 : -1);
  }
  if (!e.repeat && (e.code === LEFT || e.code === RIGHT)) {
    lastStrafeDir = e.code === LEFT ? -1 : 1;
  }
  keys[e.code] = true;
}

function handleKeyUp(e) {
  if (e?.code === 'ShiftLeft' || e?.code === 'ShiftRight') {
    shiftHeld = false;
  }
  if (e?.code === PAUSE_KEY) {
    if (typeof e.preventDefault === 'function') e.preventDefault();
    return;
  }
  if ((introActive || pauseActive || gameOverActive || levelCompleteActive) && e?.code && GAME_KEY_CODES.has(e.code)) {
    if (typeof e.preventDefault === 'function') e.preventDefault();
    return;
  }
  if (e?.code && GAME_KEY_CODES.has(e.code) && typeof e.preventDefault === 'function') {
    e.preventDefault();
  }
  keys[e.code] = false;
}

if (!RUNNING_IN_WORKER && !EDITOR_MODE) {
  addEventListener('keydown', handleKeyDown);
  addEventListener('keyup', handleKeyUp);
}

if (RUNNING_IN_WORKER) {
  globalThis.__INPUT_HANDLER_READY__ = true;
  addEventListener('message', (evt) => {
    const data = evt.data;
    if (!data) return;
    if (data.type === 'input' || data.type === 'inputBatch') {
      const events = data.type === 'input'
        ? [data]
        : (Array.isArray(data.events) ? data.events : []);
      events.forEach((entry) => {
        if (!entry?.event) return;
        const evtObj = { code: entry.code, repeat: entry.repeat };
        if (entry.event === 'keydown') handleKeyDown(evtObj);
        else if (entry.event === 'keyup') handleKeyUp(evtObj);
        if (!introActive && !pauseActive && !gameOverActive && !levelCompleteActive && entry.code === 'Space') {
          // Forward synthetic keyboard events for laser-system.
          const synthetic = new Event(entry.event);
          Object.defineProperty(synthetic, 'code', { value: entry.code });
          Object.defineProperty(synthetic, 'repeat', { value: Boolean(entry.repeat) });
          self.dispatchEvent(synthetic);
        }
      });
    } else if (data.type === 'resize') {
      pendingResize = data;
      if (data?.size?.w && data?.size?.h) {
        lastKnownCanvasSize = { w: data.size.w, h: data.size.h };
      }
    } else if (data.type === 'dumpPaths') {
      self.postMessage({
        type: 'pathsDump',
        payload: { paths: CAPTURED_ENEMY_PATHS }
      });
    }
  });
}



/* ─── enemy fighters (dark) ─────────────────────── */
const bakedEnemyPaths      = buildBakedPathMap(spawns.enemy ?? [], './models/dark1.glb');
const bakedBluePaths       = buildBakedPathMap(spawns.enemyBlue ?? [], './models/blue1.glb');
const bakedDiagPaths       = buildBakedPathMap(spawns.enemyDiag ?? [], './models/dark1.glb');
const bakedDiagRLPaths     = buildBakedPathMap(spawns.enemyDiagRL ?? [], './models/dark1.glb');
const bakedZigzagWidePaths = buildBakedPathMap(spawns.enemyZigzagWide ?? [], './models/dark1.glb');
const bakedZigzagTightPaths= buildBakedPathMap(spawns.enemyZigzagTight ?? [], './models/blue1.glb');
const bakedHoverPaths      = buildBakedPathMap(spawns.enemyHoverBob ?? [], './models/blue1.glb');
const bakedSpiralPaths     = buildBakedPathMap(spawns.enemySpiral ?? [], './models/dark1.glb');
const bakedSpiderPaths     = buildBakedPathMap(spawns.enemySpider ?? [], './models/dark3.glb');
const bakedJetPaths        = buildBakedPathMap(spawns.enemyJet ?? [], './models/dark4_jet.glb');
const EMPTY_BAKED          = new Map();
const bakedPathsEnabled    = ENABLE_BAKED_ENEMY_PATHS;
const frigateSpawnCount = Array.isArray(spawns.enemyFrigate) ? spawns.enemyFrigate.length : 0;
const frigateBluePoolSize = frigateSpawnCount ? frigateSpawnCount * 6 : 0;

const enemySystem = await initEnemySystem(scene, {
  spawnArray  : spawns.enemy ?? [],
  playerObj   : playerShip,
  railCurve,
  playerSpeed : 35,
  manualPoolSize: 6,
  boltPool    : sharedBoltPool,
  canFire     : canEnemyFire,
  hazardColliders,
  hazardEntries,
  modelPath   : './models/dark1.glb',          // explicit, unchanged
  behaviour  : BEHAVIOURS.straight,
    camera     : camera,          // ← add this one line
    materialMode: CHARACTER_MATERIAL_MODE,
    bakedPaths : bakedPathsEnabled ? bakedEnemyPaths : EMPTY_BAKED,
    useBakedPaths: bakedPathsEnabled,
    editorGroup: 'enemy'


});

/* ─── enemy fighters (blue) ─────────────────────── */
const blueEnemySystem = await initEnemySystem(scene, {
  /* you can give blue-only spawn points later; for now reuse list */
  spawnArray  : spawns.enemyBlue ?? [],
  playerObj   : playerShip,
  railCurve,
  playerSpeed : 35,
  boltPool    : sharedBoltPool,
  canFire     : canEnemyFire,
  hazardColliders,
  hazardEntries,
  modelPath  : './models/blue1.glb',
  behaviour  : BEHAVIOURS.corkscrew,
      camera     : camera,
      materialMode: CHARACTER_MATERIAL_MODE,
      bakedPaths : bakedPathsEnabled ? bakedBluePaths : EMPTY_BAKED,
      useBakedPaths: bakedPathsEnabled,
      editorGroup: 'enemyBlue'




});

const blueStraightSys = await initEnemySystem(scene, {
  spawnArray  : spawns.enemyBlueStraight ?? [],
  playerObj   : playerShip,
  railCurve,
  playerSpeed : 35,
  boltPool    : sharedBoltPool,
  canFire     : canEnemyFire,
  hazardColliders,
  hazardEntries,
  modelPath  : './models/blue1.glb',
  behaviour  : BEHAVIOURS.blueStraight,
      camera     : camera,
      materialMode: CHARACTER_MATERIAL_MODE,
      bakedPaths : EMPTY_BAKED,
      useBakedPaths: false,
  manualPoolSize: frigateBluePoolSize,
  editorGroup: 'enemyBlueStraight'
});

/* diagonal dark fighters ------------------------------------- */
const diagEnemySystem = await initEnemySystem(scene, {
  spawnArray  : spawns.enemyDiag ?? [],
  playerObj   : playerShip,
  railCurve,
  playerSpeed : 35,
  boltPool    : sharedBoltPool,
  canFire     : canEnemyFire,
  hazardColliders,
  hazardEntries,
  modelPath   : './models/dark1.glb',   // same model
  behaviour  : BEHAVIOURS.diagLR,
      camera     : camera,
      materialMode: CHARACTER_MATERIAL_MODE,
      bakedPaths : bakedPathsEnabled ? bakedDiagPaths : EMPTY_BAKED,
      useBakedPaths: bakedPathsEnabled,
      editorGroup: 'enemyDiag'



});

/* mirrored diagonal (right → left) -------------------------------- */
const diagRLSystem = await initEnemySystem(scene,{
  spawnArray  : spawns.enemyDiagRL ?? [],
  playerObj   : playerShip,
  railCurve,
  playerSpeed : 35,
  boltPool    : sharedBoltPool,
  canFire     : canEnemyFire,
  hazardColliders,
  hazardEntries,
  modelPath   : './models/dark1.glb',
  behaviour  : BEHAVIOURS.diagRL,
      camera     : camera,
      materialMode: CHARACTER_MATERIAL_MODE,
      bakedPaths : bakedPathsEnabled ? bakedDiagRLPaths : EMPTY_BAKED,
      useBakedPaths: bakedPathsEnabled,
      editorGroup: 'enemyDiagRL'


});

const zigzagWideSys = await initEnemySystem(scene,{
  spawnArray : spawns.enemyZigzagWide ?? [],
  playerObj  : playerShip,
  railCurve,
  playerSpeed: 35,
  boltPool    : sharedBoltPool,
  canFire     : canEnemyFire,
  hazardColliders,
  hazardEntries,
  modelPath  : './models/dark1.glb',
  behaviour  : BEHAVIOURS.zigzagWide,
      camera     : camera,
      materialMode: CHARACTER_MATERIAL_MODE,
      bakedPaths : bakedPathsEnabled ? bakedZigzagWidePaths : EMPTY_BAKED,
      useBakedPaths: bakedPathsEnabled,
      editorGroup: 'enemyZigzagWide'

});

const zigzagTightSys = await initEnemySystem(scene,{
  spawnArray : spawns.enemyZigzagTight ?? [],
  playerObj  : playerShip,
  railCurve,
  playerSpeed: 35,
  boltPool    : sharedBoltPool,
  canFire     : canEnemyFire,
  hazardColliders,
  hazardEntries,
  modelPath  : './models/blue1.glb',
  behaviour  : BEHAVIOURS.zigzagTight,
      camera     : camera,
      materialMode: CHARACTER_MATERIAL_MODE,
      bakedPaths : bakedPathsEnabled ? bakedZigzagTightPaths : EMPTY_BAKED,
      useBakedPaths: bakedPathsEnabled,
      editorGroup: 'enemyZigzagTight'

});

const hoverBobSys = await initEnemySystem(scene,{
  spawnArray : spawns.enemyHoverBob ?? [],
  playerObj  : playerShip,
  railCurve,
  playerSpeed: 35,
  boltPool    : sharedBoltPool,
  canFire     : canEnemyFire,
  hazardColliders,
  hazardEntries,
  modelPath  : './models/blue1.glb',
  behaviour  : BEHAVIOURS.hoverBob,
      camera     : camera,
      materialMode: CHARACTER_MATERIAL_MODE,
      bakedPaths : bakedPathsEnabled ? bakedHoverPaths : EMPTY_BAKED,
      useBakedPaths: bakedPathsEnabled,
      editorGroup: 'enemyHoverBob'

});

const spiralSys = await initEnemySystem(scene,{
  spawnArray : spawns.enemySpiral ?? [],
  playerObj  : playerShip,
  railCurve,
  playerSpeed: 35,
  boltPool    : sharedBoltPool,
  canFire     : canEnemyFire,
  hazardColliders,
  hazardEntries,
  modelPath  : './models/dark1.glb',
  behaviour  : BEHAVIOURS.spiralIn,
      camera     : camera,
      materialMode: CHARACTER_MATERIAL_MODE,
      bakedPaths : bakedPathsEnabled ? bakedSpiralPaths : EMPTY_BAKED,
      useBakedPaths: bakedPathsEnabled,
      editorGroup: 'enemySpiral'

});

const spiderSys = await initEnemySystem(scene,{
  spawnArray  : spawns.enemySpider ?? [],
  playerObj   : playerShip,
  railCurve,
  playerSpeed : 35,
  boltPool    : sharedBoltPool,
  canFire     : canEnemyFire,
  hazardColliders,
  hazardEntries,
  modelPath   : './models/dark3.glb',
  behaviour   : BEHAVIOURS.spiderTurret,
      camera     : camera,
      materialMode: CHARACTER_MATERIAL_MODE,
      bakedPaths : bakedPathsEnabled ? bakedSpiderPaths : EMPTY_BAKED,
      useBakedPaths: bakedPathsEnabled,
      editorGroup: 'enemySpider'
});

const jetEnemySys = await initEnemySystem(scene,{
  spawnArray  : spawns.enemyJet ?? [],
  playerObj   : playerShip,
  railCurve,
  playerSpeed : 60,
  boltPool    : sharedBoltPool,
  canFire     : canEnemyFire,
  hazardColliders,
  hazardEntries,
  modelPath   : './models/dark4_jet.glb',
  behaviour   : BEHAVIOURS.jetArc,
      camera     : camera,
      materialMode: CHARACTER_MATERIAL_MODE,
      bakedPaths : bakedPathsEnabled ? bakedJetPaths : EMPTY_BAKED,
      useBakedPaths: bakedPathsEnabled,
      editorGroup: 'enemyJet'
});

const frigateEnemySys = await initFrigateEnemySystem(scene, {
  spawnArray : spawns.enemyFrigate ?? [],
  playerObj  : playerShip,
  boltPool   : sharedBoltPool,
  canFire    : canEnemyFire,
  hazardEntries,
  spawnBlue  : blueStraightSys.spawnManual,
  modelPath  : './models/dark_frigate.glb',
  materialMode: CHARACTER_MATERIAL_MODE,
  editorGroup: 'enemyFrigate'
});

allySystem = await initAllyShip(scene, {
  railCurve,
  playerObj: playerShip,
  laserSystem: lasers,
  enemySystem,
  enemyLasers: () => sharedBoltPool.getActive(),
  enemyBoltPool: sharedBoltPool,
  explosionPool: explosions,
  playerSpeed: 35,
  materialMode: CHARACTER_MATERIAL_MODE,
  onDialogue: (payload) => {
    if (RUNNING_IN_WORKER && typeof self?.postMessage === 'function') {
      self.postMessage({ type: 'dialogue', payload });
    } else {
      handleDialoguePayload(payload);
    }
  },
  onEscortOutcome: ({ survived } = {}) => {
    escortSurvived = Boolean(survived);
  },
  spawn: { x: 80, y: 12, z: -3500 },
  spawnTriggerZ: -3520
});

/* helpers to gather active enemies/lasers without concat churn */
const enemySystemsList = [
  enemySystem, blueEnemySystem, blueStraightSys, diagEnemySystem, diagRLSystem,
  zigzagWideSys, zigzagTightSys, hoverBobSys, spiralSys, spiderSys, jetEnemySys,
  frigateEnemySys,
  ...platSys, ...stationTurretSystems
];
const scratchEnemies = [];
const scratchLasers  = [];
function gatherEnemies() {
  scratchEnemies.length = 0;
  enemySystemsList.forEach(sys => {
    const arr = sys.getActiveShips?.();
    if (arr && arr.length) scratchEnemies.push(...arr);
  });
  const stationEnemies = stationSystem.getActiveShips?.();
  if (stationEnemies?.length) scratchEnemies.push(...stationEnemies);
  const androssParts = androssBoss?.getEnemyParts?.();
  if (androssParts?.length) scratchEnemies.push(...androssParts);
  return scratchEnemies;
}
function gatherEnemyLasers() {
  return sharedBoltPool.getActive();
}

function queueDiagnostics(dt, lines) {
  pendingDiag = { dt, lines };
  scheduleIdle(() => {
    if (!pendingDiag) return;
    const { dt, lines } = pendingDiag;
    pendingDiag = null;
    updateDiagnostics(dt, lines);
  });
}

function queueCullTasks(playerZ) {
  pendingCullZ = playerZ;
  scheduleIdle(() => {
    if (pendingCullZ === null) return;
    const z = pendingCullZ;
    pendingCullZ = null;
    allHazards.forEach(h => {
      const m = h?.getMesh ? h.getMesh() : h?.mesh;
      if (!m) return;
      const cullZ = HAZARD_CULL_Z * (m.userData?.cullBehindZFactor ?? 1);
      if (m.visible && m.position.z > z + cullZ) {
        m.visible = false;
      }
    });
    setPieces.forEach(p => {
      if (!p?.mesh) return;
      const cullZ = HAZARD_CULL_Z * (p.mesh.userData?.cullBehindZFactor ?? 1);
      if (p.mesh.visible && p.mesh.position.z > z + cullZ) {
        p.mesh.visible = false;
        p.active = false;
      }
    });
    pickupSystem.idleCull && pickupSystem.idleCull(z);
  });
}

/* ─── prewarm materials to avoid spawn hitches ─────────────── */
// targeted warmup for the first enemy wave
enemySystem.prewarm && enemySystem.prewarm(renderer, camera);
enemySystem.prewarmRender && enemySystem.prewarmRender(renderer, camera);
enemySystem.prewarmSpawn && enemySystem.prewarmSpawn(renderer, camera);

// general warmup passes
[
  enemySystem, blueEnemySystem, blueStraightSys, diagEnemySystem, diagRLSystem,
  zigzagWideSys, zigzagTightSys, hoverBobSys, spiralSys, spiderSys, jetEnemySys,
  frigateEnemySys,
  ...platSys, ...stationTurretSystems, stationSystem, pickupSystem, allySystem, bossSystem, androssBoss
].forEach(sys => sys.prewarm && sys.prewarm(renderer, camera));
// extra: render once with fighters visible to force GPU programs ready
[
  enemySystem, blueEnemySystem, blueStraightSys, diagEnemySystem, diagRLSystem,
  zigzagWideSys, zigzagTightSys, hoverBobSys, spiralSys, spiderSys, jetEnemySys,
  frigateEnemySys
].forEach(sys => sys.prewarmRender && sys.prewarmRender(renderer, camera));
// extra: force a dummy spawn render off-screen to warm state transitions
[
  enemySystem, blueEnemySystem, blueStraightSys, diagEnemySystem, diagRLSystem,
  zigzagWideSys, zigzagTightSys, hoverBobSys, spiralSys, spiderSys, jetEnemySys,
  frigateEnemySys
].forEach(sys => sys.prewarmSpawn && sys.prewarmSpawn(renderer, camera));

// small offscreen warmup render to finalize shaders/buffers
{
  const prevSize = renderer.getSize(new THREE.Vector2());
  renderer.setSize(256, 256, false);
  renderer.render(scene, camera);
  renderer.setSize(prevSize.x, prevSize.y, false);
  forceViewportSync();
}

// warm up all set-piece meshes (tunnels/flats/buildings/station)
{
  const prevVis = [];
  const prevCulled = [];
  setPieces.forEach(p => {
    if (!p?.mesh) return;
    prevVis.push([p.mesh, p.mesh.visible]);
    p.mesh.visible = true;
    p.mesh.traverse(o => {
      if (o.isMesh) {
        prevCulled.push([o, o.frustumCulled]);
        o.frustumCulled = false;
      }
    });
  });
  renderer.render(scene, camera);
  prevVis.forEach(([m, v]) => { m.visible = v; });
  prevCulled.forEach(([o, c]) => { o.frustumCulled = c; });
}

// warm up passage collider by doing a tiny dummy linecast
if (primaryPassage?.collider?.linecast) {
  const tmpA = new THREE.Vector3(0, 0, 0);
  const tmpDir = new THREE.Vector3(0, 0, -1);
  try { primaryPassage.collider.linecast(tmpA, tmpDir, 1); } catch (err) {}
}

// spawn + resolve one explosion in each pool to bake programs/textures
{
  const tmp = new THREE.Vector3(0, -500, -500); // off-camera
  explosions.spawn(tmp);
  explosions.update(0.01, camera);
  explosions.update(1.0, camera);
  largeExplosions.spawn(tmp);
  largeExplosions.update(0.01, camera);
  largeExplosions.update(1.0, camera);
  wingExplosions.spawn(tmp);
  wingExplosions.update(0.01, camera);
  wingExplosions.update(1.0, camera);
  asteroidExplosions.spawn(tmp);
  asteroidExplosions.update(0.01, camera);
  asteroidExplosions.update(1.0, camera);
}

// precompile all seen materials once programs exist
prewarmPrograms(renderer, scene, camera);
explosions.prewarm && explosions.prewarm(renderer, camera);
largeExplosions.prewarm && largeExplosions.prewarm(renderer, camera);
wingExplosions.prewarm && wingExplosions.prewarm(renderer, camera);
asteroidExplosions.prewarm && asteroidExplosions.prewarm(renderer, camera);
[
  primaryPassage,
  ...asteroidPassages.slice(1),
  ...drillTunnel,
  ...flatAsteroid,
  ...buildingPieces
].forEach(p => p?.prewarm && p.prewarm(renderer, camera));
// extra tiny render to finalize drill/building programs before approach
{
  const prevSize = renderer.getSize(new THREE.Vector2());
  renderer.setSize(128, 128, false);
  renderer.render(scene, camera);
  renderer.setSize(prevSize.x, prevSize.y, false);
  forceViewportSync();
}




const previewCamPos = new THREE.Vector3();
const previewCamDir = new THREE.Vector3();
const previewCamRight = new THREE.Vector3();
const previewCamUp = new THREE.Vector3();
const previewOrigin = new THREE.Vector3();
const previewOffset = new THREE.Vector3();
const previewEnemySystems = [
  enemySystem, blueEnemySystem, blueStraightSys, diagEnemySystem, diagRLSystem,
  zigzagWideSys, zigzagTightSys, hoverBobSys, spiralSys, spiderSys, jetEnemySys,
  frigateEnemySys
].filter(Boolean);
let loadingPreviewActive = false;
let previewCleanup = null;
let previewTimer = null;

function applyLoadingPreviewState() {
  const prevVis = [];
  const prevCulled = [];
  setPieces.forEach(p => {
    if (!p?.mesh) return;
    prevVis.push([p, p.mesh.visible, p.active]);
    p.active = true;
    p.mesh.visible = true;
    p.mesh.traverse(o => {
      if (o.isMesh) {
        prevCulled.push([o, o.frustumCulled]);
        o.frustumCulled = false;
      }
    });
  });

  camera.getWorldPosition(previewCamPos);
  camera.getWorldDirection(previewCamDir);
  previewCamRight.copy(previewCamDir).cross(previewCamUp.set(0, 1, 0)).normalize();
  previewCamUp.crossVectors(previewCamRight, previewCamDir).normalize();
  previewOrigin.copy(previewCamPos).addScaledVector(previewCamDir, 120);

  const spacing = 18;
  const bossPrev = [];
  const bossCulls = [];
  if (bossSystem?.getMesh) {
    const bossMesh = bossSystem.getMesh();
    if (bossMesh) {
      bossPrev.push([bossMesh, bossMesh.visible, bossMesh.position.clone(), bossMesh.quaternion.clone()]);
      bossMesh.visible = true;
      bossMesh.position.copy(previewOrigin);
      bossMesh.lookAt(previewCamPos);
      bossMesh.traverse(o => {
        if (o.isMesh) {
          bossCulls.push([o, o.frustumCulled]);
          o.frustumCulled = false;
        }
      });
    }
  }

  const androssPrev = [];
  const androssPartsPrev = [];
  const androssCulls = [];
  const androssMatPrev = new Map();
  const androssRig = androssBoss?.getRig?.();
  if (androssRig) {
    androssPrev.push([androssRig, androssRig.visible, androssRig.position.clone(), androssRig.quaternion.clone()]);
    androssRig.visible = true;
    androssRig.position
      .copy(previewOrigin)
      .addScaledVector(previewCamRight, spacing * 0.6);
    androssRig.lookAt(previewCamPos);

    const head = androssBoss?.getHead?.();
    const hands = androssBoss?.getHands?.() ?? [];
    const parts = [
      head?.getMesh?.(),
      head?.getEyes?.(),
      hands[0]?.getMesh?.(),
      hands[0]?.getPalm?.(),
      hands[1]?.getMesh?.(),
      hands[1]?.getPalm?.()
    ].filter(Boolean);
    parts.forEach(part => {
      androssPartsPrev.push([part, part.visible]);
      part.visible = true;
    });

    androssRig.traverse(o => {
      if (!o.isMesh || !o.material) return;
      androssCulls.push([o, o.frustumCulled]);
      o.frustumCulled = false;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(mat => {
        if (!mat) return;
        if (!androssMatPrev.has(mat)) {
          androssMatPrev.set(mat, {
            opacity: mat.opacity,
            transparent: mat.transparent,
            depthWrite: mat.depthWrite,
            color: mat.color ? mat.color.clone() : null,
            emissive: mat.emissive ? mat.emissive.clone() : null
          });
        }
        mat.transparent = true;
        mat.opacity = 0.01;
        mat.depthWrite = false;
        mat.needsUpdate = true;
      });
    });
  }

  const previewCleanups = [];
  const baseOffset = -((previewEnemySystems.length - 1) * spacing) * 0.5;
  previewEnemySystems.forEach((sys, idx) => {
    if (!sys?.previewSetup) return;
    previewOffset.copy(previewOrigin).addScaledVector(previewCamRight, baseOffset + idx * spacing);
    const cleanup = sys.previewSetup({
      origin: previewOffset,
      right: previewCamRight,
      up: previewCamUp,
      count: 1,
      spacing: 0,
      faceTarget: previewCamPos
    });
    previewCleanups.push(cleanup);
  });
  return () => {
    previewCleanups.forEach(fn => fn && fn());
    prevVis.forEach(([p, v, active]) => {
      p.mesh.visible = v;
      p.active = active;
    });
    prevCulled.forEach(([o, c]) => { o.frustumCulled = c; });
    bossPrev.forEach(([mesh, vis, pos, quat]) => {
      mesh.visible = vis;
      mesh.position.copy(pos);
      mesh.quaternion.copy(quat);
    });
    bossCulls.forEach(([o, c]) => { o.frustumCulled = c; });
    androssPrev.forEach(([rig, vis, pos, quat]) => {
      rig.visible = vis;
      rig.position.copy(pos);
      rig.quaternion.copy(quat);
    });
    androssPartsPrev.forEach(([part, vis]) => { part.visible = vis; });
    androssCulls.forEach(([o, c]) => { o.frustumCulled = c; });
    androssMatPrev.forEach((state, mat) => {
      mat.opacity = state.opacity;
      mat.transparent = state.transparent;
      mat.depthWrite = state.depthWrite;
      if (state.color && mat.color) mat.color.copy(state.color);
      if (state.emissive && mat.emissive) mat.emissive.copy(state.emissive);
      mat.needsUpdate = true;
    });
  };
}

function endLoadingPreview() {
  if (!loadingPreviewActive) return;
  loadingPreviewActive = false;
  if (previewCleanup) {
    previewCleanup();
    previewCleanup = null;
  }
  if (EDITOR_MODE && Array.isArray(setPieces)) {
    setPieces.forEach(piece => {
      if (!piece?.mesh) return;
      piece.mesh.visible = true;
      piece.active = true;
    });
  }
  if (previewTimer) {
    clearTimeout(previewTimer);
    previewTimer = null;
  }
  forceViewportSync();
  lastFrameMs = performance.now();
}

function startLoadingPreview() {
  if (loadingPreviewActive) return;
  loadingPreviewActive = true;
  previewCleanup = applyLoadingPreviewState();
  forceViewportSync();
  renderer.render(scene, camera);
  triggerLoadingPreview();
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = setTimeout(endLoadingPreview, LOADING_PREVIEW_TOTAL_MS + 50);
}

startLoadingPreview();

function formatSpawnsForSave(obj) {
  const formatValue = (val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const inner = Object.keys(val)
        .map((k) => `${JSON.stringify(k)}: ${formatValue(val[k])}`)
        .join(', ');
      return `{ ${inner} }`;
    }
    if (Array.isArray(val)) {
      if (!val.length) return '[]';
      const inner = val.map((v) => formatValue(v)).join(', ');
      return `[ ${inner} ]`;
    }
    return JSON.stringify(val);
  };
  const keys = Object.keys(obj);
  const lines = ['{'];
  keys.forEach((k, idx) => {
    const v = obj[k];
    const comma = idx < keys.length - 1 ? ',' : '';
    if (Array.isArray(v)) {
      if (!v.length) {
        lines.push(`  ${JSON.stringify(k)}: []${comma}`);
        return;
      }
      lines.push(`  ${JSON.stringify(k)}: [`);
      v.forEach((item, i) => {
        const itemComma = i < v.length - 1 ? ',' : '';
        lines.push(`    ${formatValue(item)}${itemComma}`);
      });
      lines.push(`  ]${comma}`);
    } else {
      lines.push(`  ${JSON.stringify(k)}: ${formatValue(v)}${comma}`);
    }
  });
  lines.push('}');
  return lines.join('\n') + '\n';
}

function initEditorMode() {
  if (!EDITOR_MODE || RUNNING_IN_WORKER || typeof document === 'undefined') return false;

  if (Array.isArray(setPieces)) {
    setPieces.forEach(piece => {
      if (!piece?.mesh) return;
      piece.mesh.visible = true;
      piece.active = true;
    });
  }

  if (camera.parent) camera.parent.remove(camera);
  scene.add(camera);
  camera.position.set(0, 45, 140);
  camera.lookAt(0, 0, -600);

  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.08;
  orbit.screenSpacePanning = true;

  const transform = new TransformControls(camera, renderer.domElement);
  transform.setMode('translate');
  transform.setSpace('world');
  scene.add(transform);
  transform.addEventListener('dragging-changed', (e) => {
    orbit.enabled = !e.value;
  });

  const panel = document.createElement('div');
  Object.assign(panel.style, {
    position: 'fixed',
    right: '12px',
    top: '12px',
    padding: '10px 12px',
    border: '1px solid #0f0',
    background: 'rgba(0,0,0,0.7)',
    color: '#0f0',
    font: '12px/1.4 monospace',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    zIndex: 10000,
    minWidth: '220px'
  });
  const title = document.createElement('div');
  title.textContent = 'Level Editor';
  title.style.fontSize = '13px';
  title.style.marginBottom = '6px';
  const selectedLine = document.createElement('div');
  const modeLine = document.createElement('div');
  const makeNumberInput = (placeholder, step = 0.1) => {
    const input = document.createElement('input');
    input.type = 'number';
    input.step = String(step);
    input.placeholder = placeholder;
    Object.assign(input.style, {
      width: '62px',
      background: 'rgba(0,0,0,0.55)',
      color: '#0f0',
      border: '1px solid rgba(0,255,0,0.4)',
      font: '11px monospace',
      padding: '2px 4px'
    });
    return input;
  };
  const makeRow = (labelText) => {
    const row = document.createElement('div');
    Object.assign(row.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      marginTop: '4px'
    });
    const label = document.createElement('span');
    label.textContent = labelText;
    label.style.minWidth = '42px';
    row.appendChild(label);
    return row;
  };
  const posLine = makeRow('Pos');
  const posInputs = [
    makeNumberInput('X', 0.1),
    makeNumberInput('Y', 0.1),
    makeNumberInput('Z', 0.1)
  ];
  posInputs.forEach(input => posLine.appendChild(input));
  const rotLine = makeRow('Rot');
  const rotInputs = [
    makeNumberInput('X°', 1),
    makeNumberInput('Y°', 1),
    makeNumberInput('Z°', 1)
  ];
  rotInputs.forEach(input => rotLine.appendChild(input));
  const scaleLine = makeRow('Scale');
  const scaleInput = makeNumberInput('S', 0.01);
  scaleLine.appendChild(scaleInput);
  const statusLine = document.createElement('div');
  statusLine.style.opacity = '0.7';
  statusLine.style.marginTop = '6px';

  const modeRow = document.createElement('div');
  Object.assign(modeRow.style, {
    display: 'flex',
    gap: '6px',
    marginTop: '6px'
  });
  const makeModeButton = (label) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    Object.assign(btn.style, {
      padding: '2px 6px',
      border: '1px solid #0f0',
      background: 'rgba(0,0,0,0.55)',
      color: '#0f0',
      font: '11px monospace',
      cursor: 'pointer'
    });
    return btn;
  };
  const moveBtn = makeModeButton('Move [G]');
  const rotateBtn = makeModeButton('Rotate [R]');
  const scaleBtn = makeModeButton('Scale [S]');
  modeRow.appendChild(moveBtn);
  modeRow.appendChild(rotateBtn);
  modeRow.appendChild(scaleBtn);

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.textContent = 'Save spawns.json';
  Object.assign(saveBtn.style, {
    marginTop: '8px',
    padding: '4px 8px',
    border: '1px solid #0f0',
    background: 'rgba(0,0,0,0.6)',
    color: '#0f0',
    font: '12px monospace',
    cursor: 'pointer'
  });
  const downloadLink = document.createElement('a');
  downloadLink.href = '#';
  downloadLink.download = 'spawns.json';
  downloadLink.style.display = 'none';
  const downloadBtn = document.createElement('button');
  downloadBtn.type = 'button';
  downloadBtn.textContent = 'Download spawns.json';
  Object.assign(downloadBtn.style, {
    marginTop: '6px',
    display: 'none',
    border: '1px solid rgba(0,255,0,0.4)',
    background: 'rgba(0,0,0,0.55)',
    color: '#0f0',
    font: '11px monospace',
    letterSpacing: '0.04em',
    padding: '4px 6px',
    textAlign: 'center',
    cursor: 'pointer'
  });

  panel.appendChild(title);
  panel.appendChild(selectedLine);
  panel.appendChild(modeLine);
  panel.appendChild(modeRow);
  panel.appendChild(posLine);
  panel.appendChild(rotLine);
  panel.appendChild(scaleLine);
  panel.appendChild(saveBtn);
  panel.appendChild(downloadBtn);
  panel.appendChild(statusLine);
  document.body.appendChild(panel);
  document.body.appendChild(downloadLink);

  let selected = null;
  let currentMode = 'translate';
  let dragging = false;
  let isTransformDragging = false;
  const undoStack = [];
  const MAX_UNDO = 10;
  let dragUndoEntry = null;
  let gizmoUndoEntry = null;
  let downloadUrl = null;
  const editorPickables = [];
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const dragPlane = new THREE.Plane();
  const dragHit = new THREE.Vector3();
  const dragOffset = new THREE.Vector3();
  const dragNormal = new THREE.Vector3();
  const SET_GROUPS = new Set(['asteroidPassage', 'drillTunnel', 'asteroidFlat', 'buildings', 'boss']);

  const round = (v, n = 3) => {
    const f = Math.pow(10, n);
    return Math.round(v * f) / f;
  };
  const radToDeg = (v) => THREE.MathUtils.radToDeg(v ?? 0);

  const updatePanel = () => {
    if (!selected) {
      selectedLine.textContent = 'Selected: none';
      modeLine.textContent = `Mode: ${currentMode === 'translate' ? 'Move' : (currentMode === 'rotate' ? 'Rotate' : 'Scale')}`;
      posInputs.forEach(input => { input.value = ''; input.disabled = true; });
      rotInputs.forEach(input => { input.value = ''; input.disabled = true; });
      scaleInput.value = '';
      scaleInput.disabled = true;
      return;
    }
    const ref = selected.userData.editorRef;
    const group = selected.userData.editorGroup ?? 'unknown';
    const idx = selected.userData.editorIndex ?? '?';
    selectedLine.textContent = `Selected: ${group} #${idx}`;
    posInputs[0].value = String(round(selected.position.x));
    posInputs[1].value = String(round(selected.position.y));
    posInputs[2].value = String(round(selected.position.z));
    rotInputs[0].value = String(round(radToDeg(selected.rotation.x), 2));
    rotInputs[1].value = String(round(radToDeg(selected.rotation.y), 2));
    rotInputs[2].value = String(round(radToDeg(selected.rotation.z), 2));
    scaleInput.value = String(round(selected.scale.x, 3));
    posInputs.forEach(input => { input.disabled = false; });
    rotInputs.forEach(input => { input.disabled = false; });
    scaleInput.disabled = false;
    if (ref && typeof ref === 'object') {
      statusLine.textContent = '';
    }
  };

  const setTransformMode = (mode) => {
    currentMode = mode;
    transform.setMode(mode);
    modeLine.textContent = `Mode: ${mode === 'translate' ? 'Move' : (mode === 'rotate' ? 'Rotate' : 'Scale')}`;
  };

  const captureTransform = (obj) => ({
    obj,
    pos: obj.position.clone(),
    rot: obj.rotation.clone(),
    scale: obj.scale.clone()
  });
  const hasTransformChanged = (obj, entry) => {
    if (!obj || !entry) return false;
    if (obj.position.distanceToSquared(entry.pos) > 1e-6) return true;
    if (Math.abs(obj.rotation.x - entry.rot.x) > 1e-5) return true;
    if (Math.abs(obj.rotation.y - entry.rot.y) > 1e-5) return true;
    if (Math.abs(obj.rotation.z - entry.rot.z) > 1e-5) return true;
    if (Math.abs(obj.scale.x - entry.scale.x) > 1e-5) return true;
    return false;
  };
  const pushUndo = (entry) => {
    if (!entry?.obj) return;
    if (!hasTransformChanged(entry.obj, entry)) return;
    undoStack.push(entry);
    if (undoStack.length > MAX_UNDO) undoStack.shift();
  };
  const applyUndo = () => {
    const entry = undoStack.pop();
    if (!entry?.obj) return;
    entry.obj.position.copy(entry.pos);
    entry.obj.rotation.copy(entry.rot);
    entry.obj.scale.copy(entry.scale);
    entry.obj.updateMatrixWorld(true);
    transform.updateMatrixWorld(true);
    entry.obj.userData.editorDirty = true;
    syncObjectToSpawns(entry.obj);
    if (selected === entry.obj) updatePanel();
  };

  const syncObjectToSpawns = (obj) => {
    if (!obj) return;
    const ref = obj.userData.editorRef;
    if (!ref || typeof ref !== 'object') return;
    ref.x = round(obj.position.x);
    ref.y = round(obj.position.y);
    ref.z = round(obj.position.z);
    if (typeof ref.yaw === 'number') {
      ref.yaw = round(obj.rotation.y, 4);
      return;
    }
    const shouldSetRot = SET_GROUPS.has(obj.userData.editorGroup)
      || ref.rotation
      || ref.rotationDeg;
    if (shouldSetRot) {
      if (ref.rotationDeg) {
        ref.rotationDeg = {
          x: round(radToDeg(obj.rotation.x), 2),
          y: round(radToDeg(obj.rotation.y), 2),
          z: round(radToDeg(obj.rotation.z), 2)
        };
      } else {
        ref.rotation = {
          x: round(obj.rotation.x, 4),
          y: round(obj.rotation.y, 4),
          z: round(obj.rotation.z, 4)
        };
      }
    }
    if (SET_GROUPS.has(obj.userData.editorGroup) || typeof ref.scale === 'number') {
      ref.scale = round(obj.scale.x, 3);
    }
  };

  const syncAllEditorObjectsToSpawns = () => {
    const unique = new Set(editorObjects);
    unique.forEach(obj => {
      if (obj?.userData?.editorDirty) syncObjectToSpawns(obj);
    });
    if (selected?.userData?.editorDirty) syncObjectToSpawns(selected);
  };

  const markDirty = (obj) => {
    if (!obj?.userData) return;
    obj.userData.editorDirty = true;
  };

  const applyInputsToSelected = () => {
    if (!selected) return;
    const read = (input, fallback) => {
      const val = parseFloat(input.value);
      return Number.isFinite(val) ? val : fallback;
    };
    const posX = read(posInputs[0], selected.position.x);
    const posY = read(posInputs[1], selected.position.y);
    const posZ = read(posInputs[2], selected.position.z);
    const rotX = read(rotInputs[0], radToDeg(selected.rotation.x));
    const rotY = read(rotInputs[1], radToDeg(selected.rotation.y));
    const rotZ = read(rotInputs[2], radToDeg(selected.rotation.z));
    const scl = Math.max(0.001, read(scaleInput, selected.scale.x));
    const before = captureTransform(selected);
    if (
      Math.abs(posX - selected.position.x) < 1e-6 &&
      Math.abs(posY - selected.position.y) < 1e-6 &&
      Math.abs(posZ - selected.position.z) < 1e-6 &&
      Math.abs(rotX - radToDeg(selected.rotation.x)) < 1e-3 &&
      Math.abs(rotY - radToDeg(selected.rotation.y)) < 1e-3 &&
      Math.abs(rotZ - radToDeg(selected.rotation.z)) < 1e-3 &&
      Math.abs(scl - selected.scale.x) < 1e-6
    ) {
      return;
    }
    selected.position.set(posX, posY, posZ);
    selected.rotation.set(degToRad(rotX), degToRad(rotY), degToRad(rotZ));
    selected.scale.setScalar(scl);
    selected.updateMatrixWorld(true);
    transform.updateMatrixWorld(true);
    markDirty(selected);
    pushUndo(before);
    syncSelectedToSpawns();
    updatePanel();
  };

  const syncSelectedToSpawns = () => {
    if (!selected) return;
    syncObjectToSpawns(selected);
  };

  const selectObject = (obj) => {
    selected = obj;
    if (selected) {
      transform.attach(selected);
      transform.visible = true;
      transform.enabled = true;
    } else {
      transform.detach();
      transform.visible = false;
    }
    updatePanel();
  };

  const rebuildPickables = () => {
    editorPickables.length = 0;
    const roots = Array.from(new Set(editorObjects));
    roots.forEach(root => {
      root.traverse(o => {
        if (o.isMesh) editorPickables.push(o);
      });
    });
  };

  const setDownloadUrl = (blob) => {
    if (downloadUrl) {
      URL.revokeObjectURL(downloadUrl);
      downloadUrl = null;
    }
    downloadUrl = URL.createObjectURL(blob);
    downloadLink.href = downloadUrl;
  };
  const triggerDownload = () => {
    syncAllEditorObjectsToSpawns();
    const blob = new Blob([formatSpawnsForSave(spawns)], { type: 'application/json' });
    setDownloadUrl(blob);
    const anchor = document.createElement('a');
    anchor.href = downloadLink.href;
    anchor.download = downloadLink.download || 'spawns.json';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  const saveSpawns = async () => {
    syncAllEditorObjectsToSpawns();
    const body = JSON.stringify({ spawns });
    statusLine.textContent = 'Saving...';
    try {
      const res = await fetch('/__save_spawns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body
      });
      if (!res.ok) throw new Error(await res.text());
      statusLine.textContent = 'Saved.';
      downloadBtn.style.display = 'none';
      if (downloadUrl) {
        URL.revokeObjectURL(downloadUrl);
        downloadUrl = null;
      }
    } catch (err) {
      statusLine.textContent = 'Save failed. Click download.';
      downloadBtn.style.display = 'inline-block';
      try {
        triggerDownload();
      } catch {
        // User can click the link manually if autoplay is blocked.
      }
    }
  };

  saveBtn.addEventListener('click', saveSpawns);
  downloadBtn.addEventListener('click', () => {
    triggerDownload();
  });
  moveBtn.addEventListener('click', () => setTransformMode('translate'));
  rotateBtn.addEventListener('click', () => setTransformMode('rotate'));
  scaleBtn.addEventListener('click', () => setTransformMode('scale'));

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    if (!editorPickables.length) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(editorPickables, false);
    if (!hits.length) {
      selectObject(null);
      return;
    }
    const root = hits[0].object.userData.__editorRoot ?? hits[0].object;
    selectObject(root);
    if (!selected || currentMode !== 'translate' || isTransformDragging) return;
    camera.getWorldDirection(dragNormal).normalize();
    dragPlane.setFromNormalAndCoplanarPoint(dragNormal, selected.position);
    if (raycaster.ray.intersectPlane(dragPlane, dragHit)) {
      dragOffset.copy(selected.position).sub(dragHit);
      dragUndoEntry = captureTransform(selected);
      dragging = true;
      orbit.enabled = false;
    }
  };
  renderer.domElement.addEventListener('pointerdown', onPointerDown);

  const onPointerMove = (e) => {
    if (!dragging || !selected) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    if (raycaster.ray.intersectPlane(dragPlane, dragHit)) {
      selected.position.copy(dragHit).add(dragOffset);
      selected.updateMatrixWorld(true);
      transform.updateMatrixWorld(true);
      markDirty(selected);
      syncSelectedToSpawns();
      updatePanel();
    }
  };
  const onPointerUp = () => {
    if (!dragging) return;
    dragging = false;
    orbit.enabled = !isTransformDragging;
    if (dragUndoEntry) {
      pushUndo(dragUndoEntry);
      dragUndoEntry = null;
    }
  };
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);

  const onKeyDown = (e) => {
    if (e.code === 'KeyG') {
      e.preventDefault();
      setTransformMode('translate');
    }
    if (e.code === 'KeyR') {
      e.preventDefault();
      setTransformMode('rotate');
    }
    if (e.code === 'KeyS' && !e.ctrlKey) {
      e.preventDefault();
      setTransformMode('scale');
    }
    if (e.code === 'Escape') selectObject(null);
    if (e.code === 'KeyZ' && e.ctrlKey) {
      e.preventDefault();
      applyUndo();
    }
    if (e.code === 'KeyS' && e.ctrlKey) {
      e.preventDefault();
      saveSpawns();
    }
  };
  window.addEventListener('keydown', onKeyDown);

  transform.addEventListener('objectChange', () => {
    markDirty(selected);
    syncSelectedToSpawns();
    updatePanel();
  });
  transform.addEventListener('dragging-changed', (e) => {
    isTransformDragging = Boolean(e.value);
    orbit.enabled = !e.value;
    if (e.value && selected) {
      gizmoUndoEntry = captureTransform(selected);
    } else if (!e.value && gizmoUndoEntry) {
      pushUndo(gizmoUndoEntry);
      gizmoUndoEntry = null;
    }
  });

  // materialize dynamic systems for editor view
  [
    enemySystem, blueEnemySystem, blueStraightSys, diagEnemySystem, diagRLSystem,
    zigzagWideSys, zigzagTightSys, hoverBobSys, spiralSys, spiderSys, jetEnemySys
  ].forEach(sys => {
    const ships = sys?.materializeSpawns?.();
    if (ships?.length) {
      ships.forEach(ship => {
        if (ship?.userData?.editorRef) {
          registerEditorObject(ship, {
            group: ship.userData.editorGroup,
            index: ship.userData.editorIndex,
            ref: ship.userData.editorRef
          });
        }
      });
    }
  });
  if (frigateEnemySys?.materializeSpawns) {
    const ships = frigateEnemySys.materializeSpawns();
    ships?.forEach(ship => {
      if (ship?.userData?.editorRef) {
        registerEditorObject(ship, {
          group: ship.userData.editorGroup,
          index: ship.userData.editorIndex,
          ref: ship.userData.editorRef
        });
      }
    });
  }
  if (pickupSystem?.materializeAll) {
    const pickupRoots = pickupSystem.materializeAll();
    pickupRoots?.forEach(root => {
      if (root?.userData?.editorRef) {
        registerEditorObject(root, {
          group: root.userData.editorGroup,
          ref: root.userData.editorRef
        });
      }
    });
  }

  if (bossSystem?.getMesh && spawns?.boss) {
    const bossMesh = bossSystem.getMesh();
    if (bossMesh) {
      bossMesh.visible = true;
      registerEditorObject(bossMesh, { group: 'boss', ref: spawns.boss });
    }
  }
  if (stationTurretSystems?.length && Array.isArray(spawns.stationTurret)) {
    stationTurretSystems.forEach((sys, idx) => {
      const mesh = sys?.getMesh?.();
      if (mesh) {
        mesh.visible = true;
        registerEditorObject(mesh, { group: 'stationTurret', index: idx, ref: spawns.stationTurret[idx] });
      }
    });
  }
  if (platSys?.length && Array.isArray(spawns.platform)) {
    platSys.forEach((sys, idx) => {
      const mesh = sys?.getMesh?.();
      if (mesh) {
        mesh.visible = true;
        registerEditorObject(mesh, { group: 'platform', index: idx, ref: spawns.platform[idx] });
      }
    });
  }

  rebuildPickables();
  setTransformMode('translate');
  updatePanel();

  [...posInputs, ...rotInputs, scaleInput].forEach((input) => {
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        applyInputsToSelected();
      }
    });
    input.addEventListener('change', () => applyInputsToSelected());
  });

  renderer.setAnimationLoop(() => {
    if (pendingResize?.size) {
      if (typeof pendingResize.dpr === 'number') {
        globalThis.devicePixelRatio = pendingResize.dpr;
      }
      syncViewportSize(true, pendingResize.size);
      pendingResize = null;
    } else {
      syncViewportSize();
    }
    orbit.update();
    renderer.render(scene, camera);
  });

  return true;
}

/* ─── main loop ─────────────────────────────────────────────── */
const BASE_SPEED_UU   = 35;                            // units / second
const BASE_SPEED_T    = BASE_SPEED_UU / railCurve.getLength(); // spline % / sec
const BURST_DURATION  = 1.25;                          // seconds of boost/brake (capacity)
const BURST_RECHARGE  = 3.0;                           // seconds to refill when empty
const BOOST_MULT      = 1.5;
const BRAKE_MULT      = 0.55;
const WING_DRIFT_PER_SEC = 6;
const BOOST_KEY       = 'KeyJ';
const BRAKE_KEY       = 'KeyN';
const INPUT_STALL_RESET_MS = 220;
let   railSpeedMult   = 1;
let   burstEnergy     = 1;                             // 0..1
let   burstActive     = false;
let   burstMode       = null;                          // 'boost' | 'brake' | null
let   burstLocked     = false;                         // true after empty until full
let   t               = 0;
const GAME_OVER_STOP_DELAY_MS = 120;
const GAME_OVER_STOP_DURATION_MS = 800;
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const smoothstep = (value) => value * value * (3 - 2 * value);
const getRailStopFactor = (nowMs) => {
  if (!gameOverActive) return 1;
  const elapsed = nowMs - gameOverStartMs;
  if (elapsed <= GAME_OVER_STOP_DELAY_MS) return 1;
  const tNorm = clamp01((elapsed - GAME_OVER_STOP_DELAY_MS) / GAME_OVER_STOP_DURATION_MS);
  return 1 - smoothstep(tNorm);
};

/* reset frame timer after load so preloading time doesn't inflate the first dt */
lastFrameMs = performance.now();
introStartMs = lastFrameMs;
introActive = !EDITOR_MODE && LEVEL_INTRO_DURATION_MS > 0;
if (introActive) {
  if (RUNNING_IN_WORKER && typeof self?.postMessage === 'function') {
    self.postMessage({
      type: 'introStart',
      payload: {
        durationMs: LEVEL_INTRO_DURATION_MS,
        title: LEVEL_INTRO_TITLE,
        objective: LEVEL_INTRO_OBJECTIVE
      }
    });
  } else {
    if (loadingUI) {
      loadingUI.finish(() => startLevelIntroOverlay({ instantBackdrop: true }));
    } else {
      startLevelIntroOverlay({ instantBackdrop: true });
    }
  }
} else if (EDITOR_MODE && loadingUI) {
  loadingUI.finish(() => {});
}
allowPause = true;

const interpState = {
  hasPrev: false,
  railPrevPos: new THREE.Vector3(),
  railPrevQuat: new THREE.Quaternion(),
  railCurrPos: new THREE.Vector3(),
  railCurrQuat: new THREE.Quaternion(),
  steerPrevPos: new THREE.Vector3(),
  steerPrevQuat: new THREE.Quaternion(),
  steerCurrPos: new THREE.Vector3(),
  steerCurrQuat: new THREE.Quaternion(),
  shipPrevQuat: new THREE.Quaternion(),
  shipCurrQuat: new THREE.Quaternion()
};
const tmpPlayerPos = new THREE.Vector3();
const tmpCameraPos = new THREE.Vector3();
const tmpForward = new THREE.Vector3();

function storePrevState() {
  interpState.railPrevPos.copy(railNode.position);
  interpState.railPrevQuat.copy(railNode.quaternion);
  interpState.steerPrevPos.copy(steerNode.position);
  interpState.steerPrevQuat.copy(steerNode.quaternion);
  if (playerShip) {
    interpState.shipPrevQuat.copy(playerShip.quaternion);
  }
  interpState.hasPrev = true;
}

function storeCurrentState() {
  interpState.railCurrPos.copy(railNode.position);
  interpState.railCurrQuat.copy(railNode.quaternion);
  interpState.steerCurrPos.copy(steerNode.position);
  interpState.steerCurrQuat.copy(steerNode.quaternion);
  if (playerShip) {
    interpState.shipCurrQuat.copy(playerShip.quaternion);
  }
}

function applyInterpolation(alpha) {
  if (!interpState.hasPrev) return;
  const tAlpha = THREE.MathUtils.clamp(alpha, 0, 1);
  railNode.position.lerpVectors(interpState.railPrevPos, interpState.railCurrPos, tAlpha);
  railNode.quaternion.slerpQuaternions(interpState.railPrevQuat, interpState.railCurrQuat, tAlpha);
  steerNode.position.lerpVectors(interpState.steerPrevPos, interpState.steerCurrPos, tAlpha);
  steerNode.quaternion.slerpQuaternions(interpState.steerPrevQuat, interpState.steerCurrQuat, tAlpha);
  if (playerShip) {
    playerShip.quaternion.slerpQuaternions(interpState.shipPrevQuat, interpState.shipCurrQuat, tAlpha);
  }
}

function restoreCurrentState() {
  if (!interpState.hasPrev) return;
  railNode.position.copy(interpState.railCurrPos);
  railNode.quaternion.copy(interpState.railCurrQuat);
  steerNode.position.copy(interpState.steerCurrPos);
  steerNode.quaternion.copy(interpState.steerCurrQuat);
  if (playerShip) {
    playerShip.quaternion.copy(interpState.shipCurrQuat);
  }
}

function simulateStep(stepDt, simNowMs) {
  storePrevState();

  const wasIntroActive = introActive;
  introActive = LEVEL_INTRO_DURATION_MS > 0 && (simNowMs - introStartMs) < LEVEL_INTRO_DURATION_MS;
  if (wasIntroActive && !introActive) {
    clearInputState();
    if (!EDITOR_MODE && !dialogueTimer && !shownDialogueIds.has('intro-alert')) {
      if (RUNNING_IN_WORKER && typeof self?.postMessage === 'function') {
        dialogueTimer = -1;
        self.postMessage({
          type: 'dialogue',
          payload: {
            id: 'intro-alert',
            delayMs: DIALOGUE_POP_DELAY_MS,
            durationMs: DIALOGUE_POP_DURATION_MS,
            portraitSrc: './textures/protag.png',
            textLines: ['Everybody, stay alert!']
          }
        });
      } else {
        dialogueTimer = setTimeout(() => {
          dialogueTimer = null;
          if (gameOverActive || levelCompleteActive) return;
          handleDialoguePayload({
            id: 'intro-alert',
            portraitSrc: './textures/protag.png',
            textLines: ['Everybody, stay alert!'],
            durationMs: DIALOGUE_POP_DURATION_MS
          });
        }, DIALOGUE_POP_DELAY_MS);
      }
    }
  }
  if (!EDITOR_MODE && stats.startMs === null && !introActive) {
    stats.startMs = simNowMs;
  }
  const inputLocked = introActive || pauseActive || gameOverActive || levelCompleteActive;
  const gameplayDt = (introActive || pauseActive || levelCompleteActive) ? 0 : stepDt;
  const movementDt = gameplayDt * getRailStopFactor(simNowMs);

  /* handle speed burst timers / energy */
  const wantMode = inputLocked
    ? null
    : (keys[BOOST_KEY] ? 'boost' : (keys[BRAKE_KEY] ? 'brake' : null));
  const canUse   = !burstLocked && burstEnergy > 0;
  burstActive    = Boolean(wantMode && canUse);

  if (burstActive) {
    burstMode     = wantMode;
    railSpeedMult = wantMode === 'boost' ? BOOST_MULT : BRAKE_MULT;
    burstEnergy   = Math.max(0, burstEnergy - gameplayDt / BURST_DURATION);
    if (burstEnergy === 0) {
      burstLocked  = true;
      burstActive  = false;
      railSpeedMult = 1;
    }
  } else {
    railSpeedMult = 1;
  }

  /* recharge when not actively draining */
  if (!burstActive && burstEnergy < 1) {
    const rechargeScale = burstLocked ? 1 : 0.66;
    burstEnergy = Math.min(1, burstEnergy + (gameplayDt / BURST_RECHARGE) * rechargeScale);
    if (burstEnergy === 1) {
      burstLocked = false;
      burstMode   = null;
    }
  }

  /* scale engine glow based on boost/brake */
  const glowMult = burstActive
    ? (burstMode === 'boost' ? 2 : 0.5)
    : 1;
  setEngineGlowScale && setEngineGlowScale(glowMult);

  setBurstMeter(burstEnergy, {
    active      : burstActive || burstEnergy < 0.999 || burstLocked,
    recharging  : !burstActive && burstEnergy < 1,
    mode        : burstMode ?? 'boost'
  });

  /* follow spline */
  t = Math.min(1, t + BASE_SPEED_T * railSpeedMult * movementDt);
  const p     = railCurve.getPointAt(t);
  const pNext = railCurve.getPointAt(Math.min(1, t + 0.0001));
  railNode.position.copy(p);
  railNode.lookAt(pNext);

  /* steering */
  const dx = inputLocked ? 0 : (keys[LEFT] ? 1 : 0) - (keys[RIGHT] ? 1 : 0);
  const dy = inputLocked ? 0 : (keys[UP]   ? 1 : 0) - (keys[DOWN]  ? 1 : 0);
  if (inputLocked || gameplayDt === 0) {
    steerDx = 0;
    steerDy = 0;
  } else {
    const alpha = Math.min(1, STEER_SMOOTH * gameplayDt);
    steerDx += (dx - steerDx) * alpha;
    steerDy += (dy - steerDy) * alpha;
  }
  const moveDir = (keys[LEFT] ? -1 : 0) + (keys[RIGHT] ? 1 : 0);
  const sideBankDir = (!inputLocked && shiftHeld)
    ? (moveDir !== 0 ? Math.sign(moveDir) : lastStrafeDir)
    : 0;
  const wingHpLeft = playerShip?.userData?.wingHpLeft;
  const wingHpRight = playerShip?.userData?.wingHpRight;
  const missingWings =
    (typeof wingHpLeft === 'number' && wingHpLeft <= 0 ? 1 : 0) +
    (typeof wingHpRight === 'number' && wingHpRight <= 0 ? 1 : 0);
  const wingDrift = missingWings > 0 ? WING_DRIFT_PER_SEC * missingWings : 0;
  steerNode.position.y = THREE.MathUtils.clamp(
    steerNode.position.y + steerDy * 30 * gameplayDt - wingDrift * gameplayDt,
    -35,
    35
  );
  let speed = 45;
  if (isRolling()){
    const dir = getRollDir();
    speed *= (dx === dir ? 1.3 : 0.7);       // boost / slow
  }
  steerNode.position.x = THREE.MathUtils.clamp(
    steerNode.position.x + steerDx * speed * gameplayDt,  -35, 35);
  updateShipAttitude(steerDx, steerDy, gameplayDt, sideBankDir);   // roll + nose-tilt
  updateTrail && updateTrail(gameplayDt);

  /* cull static hazards once safely behind the player */
  playerShip.getWorldPosition(tmpPlayerPos);
  const playerZ = tmpPlayerPos.z;
  if (!EDITOR_MODE && playerZ <= -5335 && !shownDialogueIds.has('heavy-fire')) {
    if (RUNNING_IN_WORKER && typeof self?.postMessage === 'function') {
      self.postMessage({
        type: 'dialogue',
        payload: {
          id: 'heavy-fire',
          portraitSrc: './textures/yellow.png',
          textLines: ['Heavy enemy fire ahead! Do a barrel roll! (Press Q/E)']
        }
      });
    } else {
      handleDialoguePayload({
        id: 'heavy-fire',
        portraitSrc: './textures/yellow.png',
        textLines: ['Heavy enemy fire ahead! Do a barrel roll! (Press Q/E)']
      });
    }
  }
  if (!EDITOR_MODE && playerZ <= -8400 && !shownDialogueIds.has('boss-8400')) {
    if (RUNNING_IN_WORKER && typeof self?.postMessage === 'function') {
      self.postMessage({
        type: 'dialogue',
        payload: {
          id: 'boss-8400',
          portraitSrc: './textures/boss.png',
          textLines: ['I will deal with these pestilent welps myself.']
        }
      });
    } else {
      handleDialoguePayload({
        id: 'boss-8400',
        portraitSrc: './textures/boss.png',
        textLines: ['I will deal with these pestilent welps myself.']
      });
    }
  }
  if (!EDITOR_MODE && playerZ <= -8600 && !shownDialogueIds.has('boss-8600')) {
    if (RUNNING_IN_WORKER && typeof self?.postMessage === 'function') {
      self.postMessage({
        type: 'dialogue',
        payload: {
          id: 'boss-8600',
          portraitSrc: './textures/boss.png',
          textLines: ['You will be destroyed.']
        }
      });
    } else {
      handleDialoguePayload({
        id: 'boss-8600',
        portraitSrc: './textures/boss.png',
        textLines: ['You will be destroyed.']
      });
    }
  }
  if (!EDITOR_MODE && playerZ <= -8200 && !shownDialogueIds.has('protag-ahead')) {
    if (RUNNING_IN_WORKER && typeof self?.postMessage === 'function') {
      self.postMessage({
        type: 'dialogue',
        payload: {
          id: 'protag-ahead',
          portraitSrc: './textures/protag.png',
          textLines: ["Something's up ahead. Looks different."]
        }
      });
    } else {
      handleDialoguePayload({
        id: 'protag-ahead',
        portraitSrc: './textures/protag.png',
        textLines: ["Something's up ahead. Looks different."]
      });
    }
  }
  if (!androssActive && playerZ <= ANDROSS_SPAWN_Z) {
    androssBoss.activate(t);
    androssActive = true;
  }
  queueCullTasks(playerZ);

  /* fade/activate large set pieces near the player */
  updateSetPieces(gameplayDt);

  /* subsystem updates */
  allySystem?.update(gameplayDt, t);
  laserUpdateOptions.allowFire = !inputLocked && playerAlive;
  lasers.update(gameplayDt, playerShip, laserUpdateOptions);
  updateAsteroids(gameplayDt, camera);
  collisions.update(gameplayDt);
  enemySystem.update(gameplayDt, t);
  blueEnemySystem.update(gameplayDt, t);
  blueStraightSys.update(gameplayDt, t);
  diagEnemySystem.update(gameplayDt, t);
  diagRLSystem.update(gameplayDt, t);
  zigzagWideSys.update(gameplayDt, t);
  zigzagTightSys.update(gameplayDt, t);
  hoverBobSys.update(gameplayDt, t);
  spiralSys.update(gameplayDt, t);
  pickupSystem.update(gameplayDt, introActive ? introStartMs : simNowMs);
  spiderSys.update(gameplayDt, t);
  jetEnemySys.update(gameplayDt, t);
  frigateEnemySys.update(gameplayDt, t);
  platSys.forEach(s => s.update(gameplayDt));
  bossSystem.update(gameplayDt, t);
  stationSystem.update(gameplayDt, t);
  stationTurretSystems.forEach(sys => sys.update(gameplayDt));
  sharedBoltPool.update(gameplayDt);
  explosions.update(gameplayDt, camera);
  largeExplosions.update(gameplayDt, camera);
  wingExplosions.update(gameplayDt, camera);
  asteroidExplosions.update(gameplayDt, camera);
  androssBoss?.update(gameplayDt, t, playerZ, pauseActive);
}

if (EDITOR_MODE) {
  initEditorMode();
  return;
}

renderer.setAnimationLoop(() => {
  if (pendingResize?.size) {
    if (typeof pendingResize.dpr === 'number') {
      globalThis.devicePixelRatio = pendingResize.dpr;
    }
    syncViewportSize(true, pendingResize.size);
    pendingResize = null;
  } else {
    syncViewportSize();
  }
  if (loadingPreviewActive) {
    renderer.render(scene, camera);
    return;
  }

  const now = performance.now();
  const elapsedMs = now - lastFrameMs;
  const intervalMs = frameIntervalMs();
  if (fpsCapEnabled && elapsedMs < intervalMs) {
    return; // wait until the desired frame interval passes
  }
  if (elapsedMs > INPUT_STALL_RESET_MS) {
    clearInputState();
    lasers?.clearInput?.();
  }

  const rawDt = elapsedMs / 1000;
  const cappedDt = fpsCapEnabled ? Math.min(rawDt, intervalMs / 1000) : rawDt;
  const frameDt = Math.min(MAX_FRAME_DT, cappedDt);
  lastFrameMs = fpsCapEnabled
    ? now - (elapsedMs % intervalMs)
    : now;

  // dynamic resolution scaling: track frame times and adjust pixel ratio
  frameTimes.push(elapsedMs);
  if (frameTimes.length > FRAME_WINDOW) frameTimes.shift();
  if (drsEnabled && frameTimes.length === FRAME_WINDOW) {
    const avgMs = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
    const targetMs = 1000 / targetFps;
    const over = avgMs > targetMs * 1.05;
    const under = avgMs < targetMs * 0.9;
    drsOverrunCount = over ? drsOverrunCount + 1 : 0;
    drsUnderrunCount = under ? drsUnderrunCount + 1 : 0;
    const step = laptopPreset ? 0.1 : 0.05; // ramp faster on laptop preset
    if (drsOverrunCount >= 3 && drsPixelRatio > DRS_MIN_PIXEL_RATIO) {
      drsPixelRatio = Math.max(DRS_MIN_PIXEL_RATIO, drsPixelRatio - step);
      renderer.setPixelRatio(drsPixelRatio);
      drsOverrunCount = 0;
    } else if (drsUnderrunCount >= 5 && drsPixelRatio < DRS_MAX_PIXEL_RATIO) {
      drsPixelRatio = Math.min(DRS_MAX_PIXEL_RATIO, drsPixelRatio + step);
      renderer.setPixelRatio(drsPixelRatio);
      drsUnderrunCount = 0;
    }
  }

  simAccumulator = Math.min(simAccumulator + frameDt, MAX_ACCUMULATED_DT);
  const fixedDt = 1 / targetFps;
  let simNowMs = now - simAccumulator * 1000;
  let steps = 0;
  while (simAccumulator >= fixedDt && steps < MAX_SIM_STEPS) {
    simNowMs += fixedDt * 1000;
    simulateStep(fixedDt, simNowMs);
    simAccumulator -= fixedDt;
    steps++;
  }

  storeCurrentState();
  const alpha = fixedDt > 0 ? (simAccumulator / fixedDt) : 0;
  applyInterpolation(alpha);


  /* camera look-ahead */
  railNode.getWorldDirection(tmpForward);
  camera.getWorldPosition(tmpCameraPos);
  camera.lookAt(tmpCameraPos.add(tmpForward));

  renderer.render(scene, camera);
  restoreCurrentState();
  /* diagnostics (fps + optional wing debug) */
  const diagLines = [
    fpsCapEnabled ? `FPS cap: ${Math.round(targetFps)}` : 'FPS cap: off',
    allowFpsToggle ? 'Toggle cap: unbound' : 'FPS cap locked (laptop preset)',
    drsEnabled ? `DRS: ${drsPixelRatio.toFixed(2)}x` : 'DRS: off'
  ];
  if (globalThis.__DEBUG_WINGS__ && playerShip?.userData) {
    const wingL = playerShip.userData.wingHpLeft ?? '?';
    const wingR = playerShip.userData.wingHpRight ?? '?';
    const wingVar = playerShip.userData.wingVariant ?? '?';
    const lastWing = playerShip.userData.lastWingHit ?? 'none';
    const lastWingAt = playerShip.userData.lastWingHitAt ?? 0;
    const wingAge = lastWingAt ? `${Math.max(0, now - lastWingAt).toFixed(0)}ms` : '-';
    const hitAt = playerShip.userData.lastHitAt ?? 0;
    const hitAge = hitAt ? `${Math.max(0, now - hitAt).toFixed(0)}ms` : '-';
    diagLines.push(`Wing HP L/R: ${wingL}/${wingR}  Variant: ${wingVar}`);
    diagLines.push(`Last wing hit: ${lastWing} (${wingAge})`);
    diagLines.push(`Last hit age: ${hitAge}`);
  }
  queueDiagnostics(rawDt, diagLines);
});

} // end runGame

fallbackRun = () => {
  try {
    runGame();
  } catch (err) {
    console.error('Fallback main-thread run failed', err);
  }
};

if (RUNNING_IN_WORKER) {
  runGame()
    .then(() => { self.postMessage && self.postMessage({ type: 'ready' }); })
    .catch(err => {
      self.postMessage && self.postMessage({
        type: 'fatal',
        error: { message: err?.message, stack: err?.stack }
      });
    });
} else if (!renderWorkerLaunched) {
  fallbackRun();
}
