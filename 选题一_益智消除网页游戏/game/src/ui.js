// ui.js —— 表现层（FR-12/FR-16/FR-19/FR-13、API-32~API-37）
// 设计约束（《01_设计文档》第 8 章）：
//   · 只读渲染：不修改传入的 state / board（DEC-01 依赖规则 5）
//   · 动画只是对"已确定结果"的回放，不参与判定（FR-16-2、DEC-16）
//   · 动画期间输入锁，丢弃新输入（UI-03、AC-07）
//   · 颜色 + 形状双编码，灰度下仍可区分（FR-19、AC-32）

import { ANIM } from './config.js';
import { SP, idx, rowOf, colOf } from './board.js';
import { CHAPTERS } from './levels.js';
import * as log from './log.js';

const CELL_COLORS = ['#ff6b81', '#ffc857', '#4ad9a4', '#4cc9f0', '#7c6cff', '#f072d8'];
const SHAPE_COUNT = 6;
const MIN_CELL = 30;
const MAX_BOARD_W = 460;

let dom = {};
let handlers = {};
let canvasCtx = null;
let cellSize = 0;
let boardRef = null;
let inputLocked = false;
let keyboardMode = false;          // 仅在键盘操作后为 true：鼠标/触屏点选不显示键盘光标
let hint = null;                   // 道具「提示」高亮的一对格子 {a, b, until}
let selection = null;
let cursor = 0;
let pointerStart = null;
let anim = null;
let bannerTimer = null;
let confirmResolver = null;
let lastRender = {};

/* ============================ API-32 mount ============================ */
export function mount(rootEl, h = {}) {
  handlers = h;
  dom = collect(rootEl || document);
  canvasCtx = dom.canvas ? dom.canvas.getContext('2d') : null;

  on(dom.homeContinue, 'click', () => emit('onContinue'));
  on(dom.homeRank, 'click', () => handlers.onNavigate && handlers.onNavigate('rank'));
  on(dom.homeItems, 'click', () => emit('onNavigateItems'));
  on(dom.homeSettings, 'click', () => handlers.onNavigate && handlers.onNavigate('settings'));
  on(dom.levelsBack, 'click', () => handlers.onNavigate && handlers.onNavigate('home'));
  on(dom.levelsItems, 'click', () => emit('onNavigateItems'));
  on(dom.playBack, 'click', () => handlers.onNavigate && handlers.onNavigate('levels'));
  on(dom.resultBack, 'click', () => handlers.onNavigate && handlers.onNavigate('levels'));
  on(dom.resultRetry, 'click', () => emit('onRetry'));
  on(dom.resultNext, 'click', () => emit('onNext'));
  on(dom.resultSteps, 'click', () => emit('onItem', 'steps'));
  on(dom.rankBack, 'click', () => handlers.onNavigate && handlers.onNavigate('home'));
  on(dom.settingsBack, 'click', () => handlers.onNavigate && handlers.onNavigate('home'));
  on(dom.itemsBack, 'click', () => emit('onItemsBack'));
  on(dom.itemsDone, 'click', () => emit('onItemsBack'));
  on(dom.itemsClear, 'click', () => emit('onLoadoutClear'));

  on(dom.guideNext, 'click', () => handlers.onGuideNext && handlers.onGuideNext());
  on(dom.guideSkip, 'click', () => handlers.onGuideSkip && handlers.onGuideSkip());

  on(dom.modalOk, 'click', () => closeConfirm(true));
  on(dom.modalCancel, 'click', () => closeConfirm(false));

  on(dom.settingsNickname, 'change', () => emit('onSettings', { nickname: dom.settingsNickname.value }));
  on(dom.settingsMusicOn, 'change', () => emit('onSettings', { musicOn: dom.settingsMusicOn.checked }));
  on(dom.settingsMusicVol, 'input', () => emit('onSettings', { musicVol: Number(dom.settingsMusicVol.value) }));
  on(dom.settingsSfxOn, 'change', () => emit('onSettings', { sfxOn: dom.settingsSfxOn.checked }));
  on(dom.settingsSfxVol, 'input', () => emit('onSettings', { sfxVol: Number(dom.settingsSfxVol.value) }));
  on(dom.settingsReset, 'click', () => emit('onReset'));

  if (dom.canvas) {
    dom.canvas.addEventListener('pointerdown', onPointerDown);
    dom.canvas.addEventListener('pointermove', onPointerMove);
    dom.canvas.addEventListener('pointerup', onPointerUp);
    dom.canvas.addEventListener('pointercancel', () => { pointerStart = null; });
    dom.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  on(rootEl && rootEl.ownerDocument ? rootEl.ownerDocument : document, 'keydown', onKeyDown);

  window.addEventListener('resize', () => { if (boardRef) layoutAndDraw(boardRef); });
  return { ok: true };
}

function collect(root) {
  const q = (id) => root.querySelector('#' + id) || document.getElementById(id);
  return {
    pages: {
      home: q('page-home'), levels: q('page-levels'), play: q('page-play'),
      result: q('page-result'), rank: q('page-rank'), settings: q('page-settings'),
      items: q('page-items'),
    },
    homeContinue: q('home-continue'), homeRank: q('home-rank'), homeSettings: q('home-settings'),
    homeItems: q('home-items'),
    homeStatus: q('home-status'),
    levelsBack: q('levels-back'), levelsTabs: q('levels-tabs'), levelsGrid: q('levels-grid'),
    levelsTotalStars: q('levels-total-stars'), levelsItems: q('levels-items'),
    levelsChapterKicker: q('levels-chapter-kicker'), levelsChapterName: q('levels-chapter-name'),
    levelsChapterProgress: q('levels-chapter-progress'),
    playBack: q('play-back'), playLevelName: q('play-level-name'), playMoves: q('play-moves'),
    playTarget: q('play-target'), playTargetLabel: q('play-target-label'),
    playTargetChip: q('play-target-chip'), playScore: q('play-score'),
    playCoins: q('play-coins'), playTip: q('play-tip'), playCombo: q('play-combo'),
    canvas: q('play-board'), items: q('play-items'), playItemsEmpty: q('play-items-empty'),
    itemsBack: q('items-back'), itemsList: q('items-list'), itemsCoins: q('items-coins'),
    itemsTip: q('items-tip'), itemsClear: q('items-clear'), itemsDone: q('items-done'),
    resultTitle: q('result-title'), resultStars: q('result-stars'), resultScore: q('result-score'),
    resultSub: q('result-sub'), resultNext: q('result-next'), resultRetry: q('result-retry'),
    resultSteps: q('result-steps'), resultBack: q('result-back'),
    rankTabs: q('rank-tabs'), rankTabTotal: q('rank-tab-total'), rankTabLevel: q('rank-tab-level'),
    rankLevelPick: q('rank-level-pick'), rankList: q('rank-list'), rankBack: q('rank-back'),
    settingsBack: q('settings-back'), settingsNickname: q('settings-nickname'),
    settingsMusicOn: q('settings-music-on'), settingsMusicVol: q('settings-music-vol'),
    settingsSfxOn: q('settings-sfx-on'), settingsSfxVol: q('settings-sfx-vol'),
    settingsReset: q('settings-reset'), settingsOffline: q('settings-offline'),
    settingsAudio: q('settings-audio'), settingsAbout: q('settings-about'),
    banner: q('banner'), guide: q('guide'), guideText: q('guide-text'),
    guideNext: q('guide-next'), guideSkip: q('guide-skip'),
    modal: q('modal'), modalTitle: q('modal-title'), modalText: q('modal-text'),
    modalOk: q('modal-ok'), modalCancel: q('modal-cancel'),
  };
}

function on(el, type, fn) { if (el) el.addEventListener(type, fn); }
function emit(name, ...args) { if (handlers[name]) handlers[name](...args); }
function $(id) { return document.getElementById(id); }

/* ============================ API-33 render ============================ */
export function render(state) {
  lastRender = state;
  renderPages(state.page);
  renderHome(state);
  renderLevels(state);
  renderPlay(state);
  renderResult(state);
  renderRank(state);
  renderSettings(state);
  renderItemsPage(state);
  return { ok: true };
}

function renderPages(page) {
  Object.keys(dom.pages).forEach((key) => {
    const el = dom.pages[key];
    if (el) el.classList.toggle('is-active', key === page);
  });
}

function renderHome(state) {
  if (!dom.homeStatus) return;
  const lv = state.save ? state.save.unlockedLevelId : '1-1';
  const totalStars = countStars(state.save);
  dom.homeStatus.textContent = `继续：第 ${lv} 关　·　已获得 ${totalStars} 颗星`;
  if (dom.homeContinue) dom.homeContinue.textContent = state.save && totalStars > 0 ? '继续游戏' : '开始游戏';
}

function renderLevels(state) {
  const list = state.levels.list || [];
  const chapter = state.levels.chapter || 1;
  const save = state.save || { stars: {}, unlockedLevelId: '1-1', bestScores: {} };
  const chapterLevels = list.filter((lv) => (lv.chapter || 1) === chapter);
  const chapterStars = chapterLevels.reduce((n, lv) => n + Math.max(0, Math.min(3, (save.stars || {})[lv.id] || 0)), 0);
  const chapterPassed = chapterLevels.filter((lv) => ((save.stars || {})[lv.id] || 0) > 0).length;
  const chapterCfg = CHAPTERS.find((c) => c.chapter === chapter) || CHAPTERS[0];
  const totalStars = countStars(save);

  if (dom.levelsTotalStars) dom.levelsTotalStars.textContent = '★ ' + totalStars;
  if (dom.levelsChapterKicker) dom.levelsChapterKicker.textContent = `第 ${chapter} 章`;
  if (dom.levelsChapterName) dom.levelsChapterName.textContent = chapterCfg ? chapterCfg.name : '';
  if (dom.levelsChapterProgress) {
    dom.levelsChapterProgress.textContent = `${chapterPassed} / ${chapterLevels.length} 关 · ${chapterStars} / ${chapterLevels.length * 3} ★`;
  }

  if (dom.levelsTabs && dom.levelsTabs.dataset.built !== '1') {
    dom.levelsTabs.innerHTML = '';
    for (let c = 1; c <= 3; c++) {
      const b = document.createElement('button');
      b.className = 'tab';
      b.textContent = `第 ${c} 章`;
      b.dataset.chapter = String(c);
      b.addEventListener('click', () => emit('onChapter', c));
      dom.levelsTabs.appendChild(b);
    }
    dom.levelsTabs.dataset.built = '1';
  }
  if (dom.levelsTabs) {
    Array.from(dom.levelsTabs.children).forEach((b) => {
      b.classList.toggle('is-active', Number(b.dataset.chapter) === chapter);
    });
  }
  if (!dom.levelsGrid) return;
  const broken = state.levels.broken || [];
  dom.levelsGrid.innerHTML = '';
  // 按章节过滤：只渲染当前章节的 10 关（FR-12，选关页分章展示）
  chapterLevels.forEach((lv) => {
    const btn = document.createElement('button');
    const unlocked = isUnlocked(save, lv.id);
    const stars = Math.max(0, Math.min(3, save.stars ? (save.stars[lv.id] || 0) : 0));
    const best = Number((save.bestScores || {})[lv.id] || 0);
    const isCurrent = save.unlockedLevelId === lv.id;
    // 星级固定 3 个槽位：实心为已获得，空心为未获得（1 星 → ★☆☆）
    const starText = '★'.repeat(stars) + '☆'.repeat(3 - stars);
    btn.className = 'level-cell' + (broken.includes(lv.id) ? ' is-broken' : '') + (isCurrent ? ' is-current' : '');
    btn.disabled = !unlocked || broken.includes(lv.id);
    const target = targetInfo(lv);
    const aria = [`第 ${lv.id} 关`];
    if (target) aria.push(`目标 ${target.colorName}${target.shapeName} ${lv.objectiveTarget} 个`);
    else aria.push(`目标 ${lv.scoreTarget} 分`);
    if (best > 0) aria.push(`最佳 ${best} 分`);
    if (!unlocked) aria.push('未解锁');
    btn.setAttribute('aria-label', aria.join('，'));
    btn.innerHTML = `<span class="lv-id">${lv.id}</span>`
      + `<span class="lv-stars">${starText}</span>`
      + `<span class="lv-obj">${objectiveHtml(lv)}</span>`
      + (best > 0 ? `<span class="lv-best">最佳 ${best}</span>` : '')
      + (!unlocked ? '<span class="lv-lock" aria-hidden="true">🔒</span>' : '');
    if (unlocked && !broken.includes(lv.id)) btn.addEventListener('click', () => emit('onStartLevel', lv.id));
    dom.levelsGrid.appendChild(btn);
  });
}

function renderPlay(state) {
  const p = state.play;
  if (!p) return;
  if (dom.playLevelName) {
    const nm = p.level.name ? String(p.level.name) : '';
    dom.playLevelName.textContent = nm && !nm.includes(p.level.id) ? `${p.level.id}　${nm}` : p.level.id;
  }
  if (dom.playMoves) dom.playMoves.textContent = `剩余 ${p.movesLeft} 步`;
  if (dom.playScore) dom.playScore.textContent = String(p.inLevelScore);
  if (dom.playCoins) dom.playCoins.textContent = String(state.save.coins);
  if (dom.playTarget) dom.playTarget.textContent = p.targetLabel;
  const target = targetInfo(p.level);
  if (dom.playTargetChip) {
    dom.playTargetChip.innerHTML = target
      ? `${shapeSvg(target.shape, target.color)}<span class="target-chip-text">${target.colorName}${target.shapeName}</span>`
      : '';
    dom.playTargetChip.classList.toggle('hidden', !target);
    dom.playTargetChip.setAttribute('aria-label', target ? `目标颜色：${target.colorName}${target.shapeName}` : '');
  }
  if (dom.playTargetLabel) dom.playTargetLabel.textContent = p.level.objectiveType === 'clear' ? '目标色' : '目标分';
  renderItemsBar(state);
  const modeItem = p.itemMode ? (state.itemsList || []).find((it) => it.id === p.itemMode) : null;
  if (dom.playTip) {
    dom.playTip.textContent = modeItem
      ? `${modeItem.name}：点击目标方块生效（再点一次道具或按 Esc 取消）`
      : '点击或拖动交换相邻方块（键盘：方向键移动，空格选/换）';
  }
  if (dom.canvas) dom.canvas.classList.toggle('is-selecting', !!p.itemMode);
  boardRef = p.board;
  layoutAndDraw(p.board);
}

/** 局内道具条：只渲染当前携带（最多 3 个）的道具，金币不足时置灰 */
function renderItemsBar(state) {
  const wrap = dom.items;
  if (!wrap) return;
  const p = state.play;
  const list = state.itemsList || [];
  const key = list.map((it) => it.id + ':' + it.price).join(',');
  if (wrap.dataset.key !== key) {
    wrap.innerHTML = '';
    list.forEach((it) => {
      const btn = document.createElement('button');
      btn.className = 'btn item';
      btn.id = 'item-' + it.id;
      btn.dataset.item = it.id;
      btn.innerHTML = `<span class="item-name">${it.name}</span><span class="item-cost">${it.price} 金币</span>`;
      btn.addEventListener('click', () => emit('onItem', it.id));
      wrap.appendChild(btn);
    });
    wrap.dataset.key = key;
  }
  Array.from(wrap.children).forEach((btn) => {
    const it = list.find((x) => x.id === btn.dataset.item);
    const afford = !it || state.save.coins >= it.price;
    btn.disabled = !afford;
    btn.classList.toggle('is-on', !!(p && p.itemMode === btn.dataset.item));
  });
  if (dom.playItemsEmpty) dom.playItemsEmpty.classList.toggle('hidden', list.length > 0);
}

/** 道具库页：6 个道具的解锁状态、价格、效果与携带开关 */
function renderItemsPage(state) {
  if (!dom.itemsList) return;
  if (dom.itemsCoins) dom.itemsCoins.textContent = `${state.save.coins} 金币`;
  const all = state.itemsAll || [];
  const equipped = state.save.loadout || [];
  const key = all.map((it) => `${it.id}:${it.unlocked ? 1 : 0}`).join(',') + '|' + equipped.join(',') + '|' + state.save.coins;
  if (dom.itemsList.dataset.key === key) return;
  dom.itemsList.dataset.key = key;
  dom.itemsList.innerHTML = '';
  all.forEach((it) => {
    const on = equipped.includes(it.id);
    const row = document.createElement('div');
    row.className = 'item-row' + (it.unlocked ? '' : ' is-locked') + (on ? ' is-equipped' : '');
    row.innerHTML = `<div class="item-row-text">
        <div class="item-row-name">${it.name}<span class="item-row-price">${it.price} 金币</span></div>
        <div class="item-row-desc">${it.desc}${it.unlocked ? '' : `　·　通关 ${it.unlock} 解锁`}</div>
      </div>`;
    const btn = document.createElement('button');
    btn.className = 'btn btn-small' + (on ? ' btn-primary' : '');
    btn.textContent = on ? '已携带' : (it.unlocked ? '携带' : '未解锁');
    btn.disabled = !it.unlocked;
    btn.addEventListener('click', () => emit('onLoadoutToggle', it.id));
    row.appendChild(btn);
    dom.itemsList.appendChild(row);
  });
  if (dom.itemsTip) {
    dom.itemsTip.textContent = `通关对应关卡解锁；每局最多携带 3 个（当前 ${equipped.length}/${3}），使用消耗金币。`;
  }
}

function renderResult(state) {
  const r = state.result;
  if (!r) return;
  if (dom.resultTitle) dom.resultTitle.textContent = r.won ? '通关成功' : '步数用尽';
  if (dom.resultStars) {
    dom.resultStars.innerHTML = r.won
      ? '★'.repeat(r.stars) + '☆'.repeat(3 - r.stars)
      : '☆☆☆';
  }
  if (dom.resultScore) dom.resultScore.textContent = String(r.total);
  if (dom.resultSub) {
    const parts = [];
    if (r.won) {
      const target = targetInfo(r.level);
      parts.push(target
        ? `目标色 ${targetChipHtml(r.level)} ${r.level.objectiveTarget} 个`
        : `本关目标 ${r.level.scoreTarget} 分`);
    }
    if (r.coinsGained) parts.push(`金币 +${r.coinsGained}${r.firstClear ? '（首次通关双倍）' : ''}`);
    if (r.isNewBest) parts.push('新纪录！');
    if (!r.won && r.coinsGained === 0) parts.push('未通关无金币奖励');
    dom.resultSub.innerHTML = parts.join('　·　');
  }
  if (dom.resultNext) {
    dom.resultNext.disabled = !r.canNext;
    dom.resultNext.classList.toggle('hidden', !r.won);
  }
  if (dom.resultSteps) {
    const stepsItem = (state.itemsAll || []).find((it) => it.id === 'steps');
    const carried = (state.save.loadout || []).includes('steps');
    const price = stepsItem ? stepsItem.price : 0;
    const usable = !r.won && carried && state.save.coins >= price;
    dom.resultSteps.textContent = `用「加五步」续玩（${price} 金币）`;
    dom.resultSteps.disabled = !usable;
    dom.resultSteps.classList.toggle('hidden', r.won || !carried);
  }
}

function renderRank(state) {
  const r = state.rank || { tab: 'total' };
  if (dom.rankTabTotal) dom.rankTabTotal.classList.toggle('is-active', r.tab === 'total');
  if (dom.rankTabLevel) dom.rankTabLevel.classList.toggle('is-active', r.tab === 'level');
  if (dom.rankTabTotal && dom.rankTabTotal.dataset.bound !== '1') {
    dom.rankTabTotal.dataset.bound = '1';
    dom.rankTabTotal.addEventListener('click', () => emit('onRankTab', 'total'));
    dom.rankTabLevel.addEventListener('click', () => emit('onRankTab', 'level'));
  }
  if (!dom.rankList) return;

  if (r.tab === 'level') {
    if (dom.rankLevelPick && dom.rankLevelPick.dataset.built !== '1') {
      dom.rankLevelPick.dataset.built = '1';
      (state.levels.list || []).forEach((lv) => {
        const b = document.createElement('button');
        b.className = 'tab';
        b.textContent = lv.id;
        b.addEventListener('click', () => emit('onRankLevel', lv.id));
        dom.rankLevelPick.appendChild(b);
      });
    }
    if (dom.rankLevelPick) {
      Array.from(dom.rankLevelPick.children).forEach((b) => {
        b.classList.toggle('is-active', b.textContent === r.levelId);
      });
    }
  } else if (dom.rankLevelPick) {
    dom.rankLevelPick.innerHTML = '';
    dom.rankLevelPick.dataset.built = '';
  }

  const rows = (r.tab === 'total'
    ? (state.save.leaderboard.total || []).map((e) => ({ name: e.nickname, val: `${e.stars} ★`, sub: `${e.score} 分`, ts: e.ts }))
    : ((state.save.leaderboard.levels || {})[r.levelId] || []).map((e) => ({ name: e.nickname, val: `${e.score} 分`, sub: '', ts: e.ts })));

  dom.rankList.innerHTML = '';
  if (!rows.length) {
    const li = document.createElement('li');
    li.className = 'rank-empty';
    li.textContent = r.tab === 'total' ? '还没有成绩，先去玩一局吧' : `第 ${r.levelId} 关还没有成绩`;
    dom.rankList.appendChild(li);
    return;
  }
  rows.slice(0, 10).forEach((row, i) => {
    const li = document.createElement('li');
    if (row.name === state.save.nickname) li.className = 'is-me';
    const time = row.ts ? new Date(row.ts).toLocaleDateString('zh-CN') : '';
    li.innerHTML = `<span class="rk-no">${i + 1}</span>`
      + `<span class="rk-name">${escapeHtml(row.name)}</span>`
      + `<span class="rk-val">${row.val}</span>`
      + `<span class="rk-time">${time}</span>`;
    dom.rankList.appendChild(li);
  });
}

function renderSettings(state) {
  const s = state.settings;
  if (!s) return;
  if (dom.settingsNickname && document.activeElement !== dom.settingsNickname) dom.settingsNickname.value = s.nickname || '';
  if (dom.settingsMusicOn) dom.settingsMusicOn.checked = !!s.musicOn;
  if (dom.settingsMusicVol) dom.settingsMusicVol.value = String(s.musicVol);
  if (dom.settingsSfxOn) dom.settingsSfxOn.checked = !!s.sfxOn;
  if (dom.settingsSfxVol) dom.settingsSfxVol.value = String(s.sfxVol);
  if (dom.settingsOffline) dom.settingsOffline.textContent = offlineText(state.offline);
  if (dom.settingsAudio) dom.settingsAudio.textContent = state.audioAvailable ? '可用' : '不可用（已静默降级）';
  if (dom.settingsAbout) {
    dom.settingsAbout.textContent = '《星尘消除》v1.0　·　存档保存在本机浏览器（清除浏览数据会丢失）　·　无账号、无联网上传。';
  }
}

function offlineText(offline) {
  const sw = offline && offline.sw;
  if (sw === 'ok') return '可用（首次加载后断网也能玩）';
  if (sw === 'unavailable') return '不可用（当前环境不支持，请保持联网）';
  return '检测中…';
}

/* ==================== API-34 playSequence（动画回放） ==================== */
export function playSequence(events, opts = {}) {
  const speed = Math.max(0.35, Math.min(2, opts.speed || 1));
  const list = Array.isArray(events) ? events : [events];
  const end = log.time('perf.playSequence', { steps: list.length, speed, kinds: list.map((e) => e && e.type) });
  setInputLocked(true);
  log.debug('anim.lock', { locked: true, steps: list.length });
  return list.reduce((chain, ev) => chain.then(() => runOne(ev, speed)), Promise.resolve())
    .then(() => {
      setInputLocked(false);
      log.debug('anim.lock', { locked: false });
      end({ ok: true });
      return { ok: true };
    })
    .catch((e) => {
      setInputLocked(false);
      log.error('anim.failed', { message: e && e.message ? e.message : String(e) });
      end({ ok: false });
      return { ok: false };
    });
}

function runOne(ev, speed) {
  if (!ev || !boardRef) return Promise.resolve();
  switch (ev.type) {
    case 'swap':
      return animateTiles([ev.a, ev.b], 'swap', ANIM.swap / speed);
    case 'bounce':
      return animateTiles([ev.a, ev.b], 'bounce', ANIM.bounceBack / speed);
    case 'cascade':
      return animateCascade(ev, speed);
    case 'shuffle':
      return animateShuffle(speed);
    case 'combo':
      showCombo(ev.combo);
      return Promise.resolve();
    default:
      return Promise.resolve();
  }
}

function animateTiles(cells, kind, dur) {
  const board = boardRef;
  return new Promise((resolve) => {
    const start = now();
    anim = {
      kind, dur, board, cells,
      draw: (t) => {
        const e = kind === 'swap' ? easeOut(t) : Math.sin(Math.PI * t);
        drawBoard(board, { offsetFor: (i) => {
          if (i !== cells[0] && i !== cells[1]) return null;
          const from = i === cells[0] ? cells[1] : cells[0];
          return lerpCell(from, i, kind === 'swap' ? e : e);
        } });
      },
      done: resolve,
    };
    requestFrame();
  });
}

function lerpCell(fromIndex, toIndex, t) {
  const board = boardRef;
  const r0 = rowOf(board, fromIndex) - rowOf(board, toIndex);
  const c0 = colOf(board, fromIndex) - colOf(board, toIndex);
  return { dx: c0 * cellSize * (1 - t), dy: r0 * cellSize * (1 - t) };
}

/** 通用定时动画：drawFrame(t∈[0,1])；自驱动 rAF，返回 Promise */
function animateTimed(dur, drawFrame) {
  return new Promise((resolve) => {
    const start = now();
    const tick = () => {
      const t = Math.min(1, (now() - start) / dur);
      drawFrame(t);
      if (t < 1) { requestAnimationFrame(tick); return; }
      resolve();
    };
    requestAnimationFrame(tick);
  });
}

/** 按"方块描述列表"渲染一帧（消除/下落阶段用，允许任意坐标、缩放与透明度） */
function renderFrame(tiles) {
  if (!canvasCtx || !boardRef) return;
  const ctx = canvasCtx;
  ctx.clearRect(0, 0, cellSize * boardRef.cols, cellSize * boardRef.rows);
  const pad = Math.max(2, cellSize * 0.06);
  const base = cellSize - pad * 2;
  tiles.forEach(({ cell, x, y, scale = 1, alpha = 1 }) => {
    const size = base * scale;
    const left = x * cellSize + pad + (base - size) / 2;
    const top = y * cellSize + pad + (base - size) / 2;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    drawTile(ctx, left, top, size, cell, 0);
    ctx.restore();
  });
}

/**
 * 消除动画（三段式，对齐开心消消乐手感；FR-16：动画只回放已确定结果）
 *   ① 被消除方块缩小淡出 → 留出空位
 *   ② 同列上方方块下落填补
 *   ③ 新方块从棋盘上方落入顶部空位
 * 数据来自 resolveSwap / applyHammer 返回的 steps（每步 cleared + snapshot）。
 */
function animateCascade(ev, speed) {
  const steps = Array.isArray(ev.steps) ? ev.steps.filter((s) => s && Array.isArray(s.cleared)) : [];
  if (!steps.length) return animateCascadeFallback(ev, speed);

  const startBoard = ev.before || boardRef;
  boardRef = startBoard;
  log.debug('anim.cascade.steps', { steps: steps.length, cleared: steps.map((s) => s.cleared.length) });

  let current = startBoard;
  return steps.reduce((chain, step, k) => chain.then(() => {
    const ease = 1 / (1 + 0.12 * k);            // 连锁越深节奏略快
    return playCascadeStep(current, step, speed * ease).then((next) => {
      current = next;
      boardRef = next;
      return next;
    });
  }), Promise.resolve(startBoard)).then((finalBoard) => {
    boardRef = finalBoard;
    drawBoard(finalBoard, {});
    return finalBoard;
  });
}

/** 单步：淡出 → 下落 + 补位 */
function playCascadeStep(current, step, speed) {
  const rows = current.rows;
  const cols = current.cols;
  const clearedSet = new Set(step.cleared.filter((i) => current.cells[i]));
  if (!clearedSet.size) return Promise.resolve(current);

  const clearedRowsByCol = Array.from({ length: cols }, () => []);
  clearedSet.forEach((i) => clearedRowsByCol[colOf(current, i)].push(rowOf(current, i)));
  clearedRowsByCol.forEach((arr) => arr.sort((x, y) => x - y));

  const snapshot = step.snapshot || current;
  const dOut = Math.max(70, ANIM.clear / speed / 1.6);
  const dFall = Math.max(140, ANIM.fall / speed);

  return animateTimed(dOut, (t) => {
    const tiles = [];
    for (let i = 0; i < current.cells.length; i++) {
      const cell = current.cells[i];
      if (!cell) continue;
      const r = rowOf(current, i);
      const c = colOf(current, i);
      if (clearedSet.has(i)) tiles.push({ cell, x: c, y: r, scale: 1 - 0.8 * t, alpha: 1 - t });
      else tiles.push({ cell, x: c, y: r });
    }
    renderFrame(tiles);
  }).then(() => animateTimed(dFall, (t) => {
    const e = easeOut(t);
    const tiles = [];
    for (let c = 0; c < cols; c++) {
      const gone = clearedRowsByCol[c];
      const k = gone.length;
      for (let r = 0; r < rows; r++) {
        const i = idx(current, r, c);
        const cell = current.cells[i];
        if (!cell || clearedSet.has(i)) continue;
        const below = gone.filter((gr) => gr > r).length;
        tiles.push({ cell, x: c, y: r + below * e });
      }
      for (let j = 0; j < k; j++) {
        const cell = snapshot.cells[idx(snapshot, j, c)];
        if (!cell) continue;
        const from = j - k;
        tiles.push({ cell, x: c, y: from + (j - from) * e });
      }
    }
    renderFrame(tiles);
  })).then(() => snapshot);
}

/** 兜底：事件不带 steps 时，按前后差异做简单回放 */
function animateCascadeFallback(ev, speed) {
  const before = ev.before;
  const after = ev.after || boardRef;
  const changed = [];
  const cleared = [];
  for (let i = 0; i < after.cells.length; i++) {
    const b = before ? before.cells[i] : null;
    const a = after.cells[i];
    const sameCell = b && a && b.color === a.color && b.special === a.special;
    if (!sameCell) changed.push(i);
    if (b && (!a || b.color !== a.color || b.special !== a.special)) cleared.push(i);
  }
  boardRef = after;
  log.debug('anim.cascade', { cleared: cleared.length, changed: changed.length, beforeIsNull: !before });
  const d1 = Math.max(1, ANIM.clear / speed);
  const d2 = Math.max(1, ANIM.fall / speed);
  return animateTimed(d1, (t) => drawBoard(after, { flash: cleared, flashStrength: 1 - t }))
    .then(() => animateTimed(d2, (t) => drawBoard(after, {
      offsetFor: (i) => (changed.includes(i) ? { dx: 0, dy: -cellSize * 1.6 * (1 - easeOut(t)) } : null),
    })))
    .then(() => drawBoard(after, {}));
}

function animateShuffle(speed) {
  const board = boardRef;
  const dur = Math.max(140, ANIM.fall / speed);
  return animateTimed(dur, (t) => drawBoard(board, { globalAlpha: 0.25 + 0.75 * t, scale: 0.94 + 0.06 * t }))
    .then(() => drawBoard(board, {}));
}

function requestFrame() {
  requestAnimationFrame(() => {
    if (!anim) return;
    const t = Math.min(1, (now() - (anim.t0 || (anim.t0 = now()))) / anim.dur);
    anim.draw(t);
    if (t >= 1) { const done = anim.done; anim = null; if (done) done(); }
    else requestFrame();
  });
}

function now() { return (globalThis.performance && performance.now) ? performance.now() : Date.now(); }
function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

function showCombo(combo) {
  if (!dom.playCombo || !combo || combo < 2) return;
  dom.playCombo.textContent = `连击 ×${combo}`;
  dom.playCombo.classList.add('is-show');
  setTimeout(() => dom.playCombo && dom.playCombo.classList.remove('is-show'), 700);
}

/* ==================== API-35 输入锁 ==================== */
export function setInputLocked(flag) {
  inputLocked = !!flag;
  return { ok: true };
}
export function isInputLocked() { return inputLocked; }

/* ==================== 输入处理（UI-02/UI-03） ==================== */
function cellFromEvent(e) {
  if (!boardRef || !dom.canvas) return null;
  const rect = dom.canvas.getBoundingClientRect();
  const c = Math.floor((e.clientX - rect.left) / cellSize);
  const r = Math.floor((e.clientY - rect.top) / cellSize);
  if (r < 0 || c < 0 || r >= boardRef.rows || c >= boardRef.cols) return null;
  return idx(boardRef, r, c);
}

function onPointerDown(e) {
  keyboardMode = false;            // 指针操作接管后隐藏键盘光标
  if (!boardRef) return;
  const i = cellFromEvent(e);
  if (i === null) return;
  const p = lastRender.play;
  if (p && p.itemMode) { emit('onItemPick', i); return; }
  if (inputLocked) { emit('onBlockedInput'); return; }
  pointerStart = { index: i, x: e.clientX, y: e.clientY };
  select(i);
}

function onPointerMove(e) {
  if (!pointerStart || inputLocked) return;
  const dx = e.clientX - pointerStart.x;
  const dy = e.clientY - pointerStart.y;
  if (Math.abs(dx) < cellSize * 0.45 && Math.abs(dy) < cellSize * 0.45) return;
  const from = pointerStart.index;
  const horizontal = Math.abs(dx) > Math.abs(dy);
  const to = neighbor(from, horizontal ? (dx > 0 ? 1 : -1) : 0, horizontal ? 0 : (dy > 0 ? 1 : -1));
  pointerStart = null;
  if (to !== null) emit('onSwap', from, to);
}

function onPointerUp(e) {
  if (!pointerStart || inputLocked) { pointerStart = null; return; }
  const i = cellFromEvent(e);
  const from = pointerStart.index;
  pointerStart = null;
  if (i === null || i === from) return;
  if (isAdjacent(from, i)) { emit('onSwap', from, i); return; }
  select(i);
}

function onKeyDown(e) {
  if (!boardRef) return;
  if (/^Arrow(Left|Right|Up|Down)$/.test(e.key) || e.key === ' ' || e.key === 'Enter') keyboardMode = true;   // 键盘操作后显示光标
  if (e.key === 'Escape') {
    const pl = lastRender.play;
    if (pl && pl.itemMode) { emit('onItemModeCancel'); return; }   // 选格模式优先取消
    selection = null; cursor = 0; drawBoard(boardRef, {}); return;
  }
  const map = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
  if (map[e.key]) {
    e.preventDefault();
    const [dr, dc] = map[e.key];
    const r = Math.max(0, Math.min(boardRef.rows - 1, rowOf(boardRef, cursor) + dr));
    const c = Math.max(0, Math.min(boardRef.cols - 1, colOf(boardRef, cursor) + dc));
    cursor = idx(boardRef, r, c);
    drawBoard(boardRef, { cursor });
    return;
  }
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    const p = lastRender.play;
    if (p && p.itemMode) { emit('onItemPick', cursor); return; }
    if (inputLocked) { emit('onBlockedInput'); return; }
    if (selection === null) { selection = cursor; drawBoard(boardRef, { cursor, selection }); return; }
    if (selection === cursor) { selection = null; drawBoard(boardRef, { cursor }); return; }
    if (isAdjacent(selection, cursor)) { const a = selection; selection = null; emit('onSwap', a, cursor); return; }
    selection = cursor;
    drawBoard(boardRef, { cursor, selection });
  }
}

function select(i) {
  if (selection === null) { selection = i; drawBoard(boardRef, { selection, cursor }); return; }
  if (selection === i) { selection = null; drawBoard(boardRef, { cursor }); return; }
  if (isAdjacent(selection, i)) { const a = selection; selection = null; emit('onSwap', a, i); return; }
  selection = i;
  drawBoard(boardRef, { selection, cursor });
}

export function clearSelection() { selection = null; if (boardRef) drawBoard(boardRef, {}); }
export function setCursor(i) { cursor = i; if (boardRef) drawBoard(boardRef, { cursor }); }

function isAdjacent(a, b) {
  const dr = Math.abs(rowOf(boardRef, a) - rowOf(boardRef, b));
  const dc = Math.abs(colOf(boardRef, a) - colOf(boardRef, b));
  return dr + dc === 1;
}

function neighbor(i, dr, dc) {
  const r = rowOf(boardRef, i) + dr;
  const c = colOf(boardRef, i) + dc;
  if (r < 0 || c < 0 || r >= boardRef.rows || c >= boardRef.cols) return null;
  return idx(boardRef, r, c);
}

/* ==================== 道具提示（hint） ==================== */
/** 高亮一对可交换的方块，3 秒后自动消失（道具「提示」） */
export function showHint(a, b) {
  hint = { a, b, until: now() + 3000 };
  if (boardRef) drawBoard(boardRef, {});
  setTimeout(() => { hint = null; if (boardRef) drawBoard(boardRef, {}); }, 3100);
  return { ok: true };
}

export function clearHint() {
  hint = null;
  if (boardRef) drawBoard(boardRef, {});
  return { ok: true };
}

/* ==================== API-36 横幅 ==================== */
export function showBanner(text, opts = {}) {
  if (!dom.banner) return { ok: false };
  dom.banner.textContent = text;
  dom.banner.classList.remove('hidden');
  if (bannerTimer) clearTimeout(bannerTimer);
  if (!opts.sticky) bannerTimer = setTimeout(() => dom.banner && dom.banner.classList.add('hidden'), 2400);
  return { ok: true };
}
export function hideBanner() {
  if (dom.banner) dom.banner.classList.add('hidden');
  if (bannerTimer) { clearTimeout(bannerTimer); bannerTimer = null; }
  return { ok: true };
}

/* ==================== API-37 新手引导 ==================== */
const GUIDE_TEXT = {
  1: '拖动或点击交换相邻的两个方块，让 3 个及以上同色方块连成一线即可消除。',
  2: '消除后会连锁下落并自动结算分数，连锁次数越多，单次得分倍率越高（最高 ×2.5）。',
  3: '顶部显示关卡目标与剩余步数：达成目标即可通关；剩余步数会折算成额外分数，冲更高星级。',
  tips: '特殊方块：4 连生成条纹（清整行/列），T/L 形生成炸弹（清周围 3×3），5 连生成彩虹（清除同色）。',
};
export function showGuide(step) {
  if (!dom.guide) return { ok: false };
  dom.guideText.textContent = GUIDE_TEXT[step] || '';
  dom.guide.classList.remove('hidden');
  if (dom.guideNext) dom.guideNext.textContent = step === 3 || step === 'tips' ? '开始游戏' : '下一步';
  return { ok: true };
}
export function hideGuide() {
  if (dom.guide) dom.guide.classList.add('hidden');
  return { ok: true };
}

/* ==================== 二次确认弹窗 ==================== */
export function confirm({ title = '确认', text = '', okText = '确定', cancelText = '取消' } = {}) {
  if (!dom.modal) return Promise.resolve(false);
  dom.modalTitle.textContent = title;
  dom.modalText.textContent = text;
  dom.modalOk.textContent = okText;
  dom.modalCancel.textContent = cancelText;
  dom.modal.classList.remove('hidden');
  return new Promise((resolve) => { confirmResolver = resolve; });
}

function closeConfirm(value) {
  if (dom.modal) dom.modal.classList.add('hidden');
  const r = confirmResolver;
  confirmResolver = null;
  if (r) r(value);
}

/* ==================== Canvas 绘制 ==================== */
function layoutAndDraw(board) {
  if (!dom.canvas || !canvasCtx) return;
  const maxW = Math.min(MAX_BOARD_W, (dom.canvas.parentElement ? dom.canvas.parentElement.clientWidth : MAX_BOARD_W) || MAX_BOARD_W);
  cellSize = Math.max(MIN_CELL, Math.floor(maxW / board.cols));
  const cssW = cellSize * board.cols;
  const cssH = cellSize * board.rows;
  const dpr = Math.min(3, globalThis.devicePixelRatio || 1);
  dom.canvas.style.width = cssW + 'px';
  dom.canvas.style.height = cssH + 'px';
  dom.canvas.width = Math.floor(cssW * dpr);
  dom.canvas.height = Math.floor(cssH * dpr);
  canvasCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawBoard(board, {});
}

function drawBoard(board, opts = {}) {
  if (!canvasCtx || !board) return;
  const ctx = canvasCtx;
  const { offsetFor, flash, flashStrength = 1, globalAlpha = 1, scale = 1, selection: sel = selection, cursor: cur = null } = opts;
  ctx.save();
  ctx.globalAlpha = globalAlpha;
  ctx.clearRect(0, 0, cellSize * board.cols, cellSize * board.rows);
  const pad = Math.max(2, cellSize * 0.06);
  const size = (cellSize - pad * 2) * scale;

  for (let i = 0; i < board.cells.length; i++) {
    const cell = board.cells[i];
    if (!cell) continue;
    const r = rowOf(board, i);
    const c = colOf(board, i);
    const off = offsetFor ? offsetFor(i) : null;
    const x = c * cellSize + pad + (off ? off.dx : 0);
    const y = r * cellSize + pad + (off ? off.dy : 0);
    const isFlash = flash && flash.includes(i);
    drawTile(ctx, x, y, size, cell, isFlash ? flashStrength : 0);
  }

  if (sel !== null && sel !== undefined && board.cells[sel]) {
    const r = rowOf(board, sel);
    const c = colOf(board, sel);
    ctx.beginPath();                       // 必须新起路径，否则会连带描边上一个方块的残留子路径
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.setLineDash([]);
    roundRect(ctx, c * cellSize + 2, r * cellSize + 2, cellSize - 4, cellSize - 4, cellSize * 0.22);
    ctx.stroke();
  }
  // 键盘光标只在"键盘操作模式"下显示（鼠标/触屏点选时不应出现虚线框）
  if (keyboardMode && cur !== null && cur !== undefined && board.cells[cur]) {
    const r = rowOf(board, cur);
    const c = colOf(board, cur);
    ctx.beginPath();
    ctx.strokeStyle = '#7c6cff';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    roundRect(ctx, c * cellSize + 3, r * cellSize + 3, cellSize - 6, cellSize - 6, cellSize * 0.2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // 道具「提示」：高亮一对可交换的方块（3 秒后自动消失）
  if (hint && now() < hint.until) {
    [hint.a, hint.b].forEach((hi) => {
      if (hi === null || hi === undefined || !board.cells[hi]) return;
      const hr = rowOf(board, hi);
      const hc = colOf(board, hi);
      ctx.beginPath();
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 5]);
      roundRect(ctx, hc * cellSize + 2, hr * cellSize + 2, cellSize - 4, cellSize - 4, cellSize * 0.22);
      ctx.stroke();
      ctx.setLineDash([]);
    });
  }
  ctx.restore();
}

function drawTile(ctx, x, y, size, cell, flash) {
  const colorIndex = ((cell.color % CELL_COLORS.length) + CELL_COLORS.length) % CELL_COLORS.length;
  const base = CELL_COLORS[colorIndex];
  const cx = x + size / 2;
  const cy = y + size / 2;
  const shape = colorIndex % SHAPE_COUNT;

  ctx.save();
  if (flash > 0) {
    ctx.globalAlpha = Math.max(0.15, flash);
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 18 * flash;
  }
  if (cell.special === SP.RAINBOW) {
    const g = ctx.createLinearGradient(x, y, x + size, y + size);
    g.addColorStop(0, '#ff6b81');
    g.addColorStop(0.35, '#ffc857');
    g.addColorStop(0.7, '#4ad9a4');
    g.addColorStop(1, '#7c6cff');
    fillPath(ctx, shape, cx, cy, size * 0.46);
    ctx.fillStyle = g;
    ctx.fill();
  } else {
    fillPath(ctx, shape, cx, cy, size * 0.44);
    ctx.fillStyle = base;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = Math.max(1, size * 0.05);
    ctx.stroke();
  }

  if (cell.special === SP.STRIPE_H || cell.special === SP.STRIPE_V) {
    ctx.save();
    ctx.beginPath();
    fillPath(ctx, shape, cx, cy, size * 0.44);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = Math.max(2, size * 0.09);
    for (let k = -2; k <= 2; k++) {
      ctx.beginPath();
      if (cell.special === SP.STRIPE_H) {
        ctx.moveTo(cx - size, cy + k * size * 0.28);
        ctx.lineTo(cx + size, cy + k * size * 0.28);
      } else {
        ctx.moveTo(cx + k * size * 0.28, cy - size);
        ctx.lineTo(cx + k * size * 0.28, cy + size);
      }
      ctx.stroke();
    }
    ctx.restore();
  } else if (cell.special === SP.BOMB) {
    ctx.strokeStyle = 'rgba(20,16,44,0.85)';
    ctx.lineWidth = Math.max(2, size * 0.08);
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - size * 0.3, cy); ctx.lineTo(cx + size * 0.3, cy);
    ctx.moveTo(cx, cy - size * 0.3); ctx.lineTo(cx, cy + size * 0.3);
    ctx.stroke();
  } else if (cell.special === SP.RAINBOW) {
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = Math.max(1.5, size * 0.05);
    fillPath(ctx, shape, cx, cy, size * 0.44);
    ctx.stroke();
  }
  ctx.restore();
}

function fillPath(ctx, shape, cx, cy, r) {
  ctx.beginPath();
  switch (shape) {
    case 0: ctx.arc(cx, cy, r, 0, Math.PI * 2); break;
    case 1: roundRect(ctx, cx - r, cy - r, r * 2, r * 2, r * 0.25); break;
    case 2:
      ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r * 0.92, cy + r * 0.72); ctx.lineTo(cx - r * 0.92, cy + r * 0.72); ctx.closePath();
      break;
    case 3:
      ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy); ctx.closePath();
      break;
    case 4: polygon(ctx, cx, cy, r, 5); break;
    default: polygon(ctx, cx, cy, r, 6); break;
  }
}

function polygon(ctx, cx, cy, r, sides) {
  for (let i = 0; i < sides; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / sides;
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/* ==================== 小工具 ==================== */
function countStars(save) {
  if (!save || !save.stars) return 0;
  return Object.values(save.stars).reduce((a, b) => a + (Number(b) || 0), 0);
}

function objectiveHtml(lv) {
  if (lv.objectiveType === 'clear') {
    return `${targetChipHtml(lv)}<span class="lv-obj-text">${lv.objectiveTarget} 个</span>`;
  }
  return `<span class="lv-obj-text">${lv.scoreTarget} 分</span>`;
}

/* ---------- 目标颜色双编码（颜色 + 形状） ---------- */
const COLOR_NAMES = ['红', '黄', '绿', '蓝', '紫', '粉'];
const SHAPE_NAMES = ['圆', '方', '三角', '菱形', '五边形', '六边形'];

function targetInfo(level) {
  if (!level || level.objectiveType !== 'clear') return null;
  const raw = Number(level.targetColor);
  if (!Number.isInteger(raw) || raw < 0) return null;
  const index = raw % CELL_COLORS.length;
  return {
    index,
    color: CELL_COLORS[index],
    colorName: COLOR_NAMES[index] || `色${index + 1}`,
    shape: index % SHAPE_COUNT,
    shapeName: SHAPE_NAMES[index % SHAPE_COUNT] || '形状',
  };
}

function targetChipHtml(level, opts = {}) {
  const t = targetInfo(level);
  if (!t) return '';
  const label = `${t.colorName}${t.shapeName}`;
  const text = opts.text === false ? '' : `<span class="target-chip-text">${label}</span>`;
  return `<span class="target-chip" role="img" title="目标：${label}" aria-label="目标：${label}">${shapeSvg(t.shape, t.color)}${text}</span>`;
}

function shapeSvg(shape, color) {
  const stroke = ' stroke="rgba(255,255,255,0.75)" stroke-width="1"';
  const shapes = [
    `<circle cx="8" cy="8" r="6.4" fill="${color}"${stroke}/>`,
    `<rect x="2.2" y="2.2" width="11.6" height="11.6" rx="2.6" fill="${color}"${stroke}/>`,
    `<polygon points="8,1.4 14.9,13.9 1.1,13.9" fill="${color}"${stroke}/>`,
    `<polygon points="8,1 15,8 8,15 1,8" fill="${color}"${stroke}/>`,
    `<polygon points="8,1 14.7,5.9 12.2,14 3.8,14 1.3,5.9" fill="${color}"${stroke}/>`,
    `<polygon points="8,1 13.7,4.3 13.7,11.7 8,15 2.3,11.7 2.3,4.3" fill="${color}"${stroke}/>`,
  ];
  return `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">${shapes[shape] || shapes[0]}</svg>`;
}

function isUnlocked(save, levelId) {
  const order = lastRender.levels && lastRender.levels.list ? lastRender.levels.list.map((l) => l.id) : [];
  const unlockedIdx = order.indexOf(save.unlockedLevelId);
  const idxHere = order.indexOf(levelId);
  if (unlockedIdx < 0) return levelId === '1-1';
  return idxHere >= 0 && idxHere <= unlockedIdx;
}

function passedLevelId(save) {
  return save ? save.unlockedLevelId : '1-1';
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const __internals = {
  drawBoard, layoutAndDraw, CELL_COLORS, GUIDE_TEXT, showHint, clearHint, targetInfo,
  /** 仅测试版使用：暴露渲染/输入状态，便于端到端断言 */
  getDebugFlags: () => ({ keyboardMode, cellSize, selection, cursor, inputLocked }),
};
