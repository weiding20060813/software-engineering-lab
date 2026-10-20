#!/usr/bin/env node
// e2e.mjs —— 端到端冒烟测试（Edge/Chrome DevTools Protocol）
// 能力：启动无头浏览器 → 打开游戏 → 读取/驱动 window.__game → 抓控制台与页面日志 → 按时间点截图。
// 用法：node tools/e2e.mjs [--base=http://127.0.0.1:8123] [--out=..\_e2e] [--keep]
// 依赖：仅 Node 内置（fetch / WebSocket / child_process），不装任何包。

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
}));
const BASE = args.base || 'http://127.0.0.1:8123';
const PAGE = args.page || '/dev.html';        // 默认打测试版；--page=/index.html 可测正式版
const OUT = path.resolve(args.out || path.join(process.cwd(), '_e2e'));
const PORT = Number(args.port || 9333);
const KEEP = !!args.keep;
const VIEW = { width: Number(args.width || 420), height: Number(args.height || 900) };

fs.mkdirSync(OUT, { recursive: true });
const shots = path.join(OUT, 'shots');
fs.mkdirSync(shots, { recursive: true });

const log = (...a) => console.log(...a);
const fail = [];
function check(name, cond, detail = '') {
  if (cond) log(`  ✅ ${name}${detail ? '  [' + detail + ']' : ''}`);
  else { fail.push(name); log(`  ❌ ${name}${detail ? '  [' + detail + ']' : ''}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- 找浏览器 ---------------- */
function findBrowser() {
  const cands = [
    process.env.EDGE_PATH,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ].filter(Boolean);
  for (const c of cands) if (fs.existsSync(c)) return c;
  return null;
}

/* ---------------- 极简 CDP 客户端 ---------------- */
class CDP {
  constructor(wsUrl, timeoutMs = 20000) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    this.ready = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('WebSocket 连接超时')), timeoutMs);
      this.ws.addEventListener('open', () => { clearTimeout(t); resolve(); });
      this.ws.addEventListener('error', (e) => { clearTimeout(t); reject(new Error('WebSocket 错误')); });
    });
    this.ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        (this.handlers.get(msg.method) || []).forEach((fn) => fn(msg.params));
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`CDP 超时: ${method}`)); } }, 30000);
    });
  }
  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }
}

/* ---------------- 主流程 ---------------- */
const browserPath = findBrowser();
if (!browserPath) {
  console.error('未找到 Edge/Chrome，可用 --browser 或设置 EDGE_PATH');
  process.exit(2);
}
log(`浏览器: ${browserPath}`);
log(`目标: ${BASE}${PAGE}?demo=1&debug=1    输出: ${OUT}\n`);

const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stardust-e2e-'));
const child = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--hide-scrollbars', '--mute-audio',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  `--window-size=${VIEW.width},${VIEW.height}`, 'about:blank',
], { stdio: 'ignore' });

async function waitEndpoint(timeoutMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return await r.json();
    } catch (e) { /* 还没起来 */ }
    await sleep(200);
  }
  throw new Error('调试端口未就绪');
}

let cdp = null;
const consoleLines = [];
const pageErrors = [];

try {
  await (async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 15000) {
      try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) return; } catch (e) {}
      await sleep(200);
    }
    throw new Error('调试端口未就绪');
  })();

  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  let page = targets.find((t) => t.type === 'page');
  if (!page) {
    const created = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
    page = created;
  }

  cdp = new CDP(page.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: VIEW.width, height: VIEW.height, deviceScaleFactor: 2, mobile: true,
  });

  cdp.on('Runtime.consoleAPICalled', (p) => {
    const text = (p.args || []).map((a) => (a.value !== undefined ? String(a.value) : a.description || a.type)).join(' ');
    consoleLines.push(`[${p.type}] ${text}`);
    if (p.type === 'error') pageErrors.push(text);
  });
  cdp.on('Runtime.exceptionThrown', (p) => {
    const d = p.exceptionDetails || {};
    const msg = (d.exception && d.exception.description) || d.text || '未知异常';
    pageErrors.push(msg);
    consoleLines.push('[exception] ' + msg);
  });
  cdp.on('Log.entryAdded', (p) => {
    const e = p.entry || {};
    consoleLines.push(`[log:${e.level}] ${e.text}`);
    if (e.level === 'error') pageErrors.push(e.text);
  });

  async function evaluate(expression, awaitPromise = true) {
    const r = await cdp.send('Runtime.evaluate', {
      expression, awaitPromise, returnByValue: true, userGesture: true,
    });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error((d.exception && d.exception.description) || d.text || 'evaluate 异常');
    }
    return r.result ? r.result.value : undefined;
  }
  async function waitFor(expression, timeoutMs = 8000, label = expression) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      try { if (await evaluate(`!!(${expression})`)) return true; } catch (e) {}
      await sleep(120);
    }
    throw new Error('等待超时: ' + label);
  }
  async function panel(show) {
    await evaluate(`(() => {
      const el = document.getElementById('debug-panel');
      if (!el) return false;
      el.classList.toggle('hidden', ${show ? 'false' : 'true'});
      return true;
    })()`).catch(() => {});
  }
  /** 拍用户视角截图：临时收起调试面板 */
  async function shotClean(name) {
    await panel(false);
    await sleep(80);
    const file = await shot(name);
    await panel(true);
    return file;
  }
  async function shot(name) {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const file = path.join(shots, name.endsWith('.png') ? name : name + '.png');
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    log(`  📷 ${path.basename(file)}`);
    return file;
  }

  /* ---------- 1. 打开游戏 ---------- */
  log('=== 1) 启动与首屏 ===');
  await cdp.send('Page.navigate', { url: `${BASE}${PAGE}?demo=1&debug=1` });
  await waitFor('window.__game && window.__game.state && window.__game.state.page', 12000, 'game boot');
  const boot = await evaluate(`(() => {
    const g = window.__game;
    return {
      page: g.state.page,
      unlock: g.state.save.unlockedLevelId,
      coins: g.state.save.coins,
      hudCoins: Number(String((document.getElementById('play-coins') || {}).textContent || '').replace(/[^0-9]/g, '')),
      stars: g.api.totalStars(g.state.save),
      demo: /demo=1/.test(location.search),
      hasPanel: !!document.getElementById('debug-panel'),
      logs: g.log.get().length,
    };
  })()`);
  check('启动完成且进入首页', boot.page === 'home', JSON.stringify(boot));
  check('演示存档已载入（解锁 2-6 / 860 金币）', boot.unlock === '2-6' && boot.coins === 860);
  check('调试面板已注入', boot.hasPanel === true);
  check('启动日志已采集', boot.logs > 0, `${boot.logs} 条`);
  await shot('01_home');

  /* ---------- 2. 选关页：章节过滤 ---------- */
  log('\n=== 2) 选关页章节过滤 ===');
  await evaluate(`document.getElementById('home-continue').click()`);
  await waitFor(`window.__game.state.page === 'levels'`);
  const ch2 = await evaluate(`(() => {
    const cells = [...document.querySelectorAll('#levels-grid .level-cell')].map(b => b.querySelector('.lv-id').textContent);
    const active = document.querySelector('#levels-tabs .tab.is-active')?.textContent || '';
    return { cells, active, count: cells.length };
  })()`);
  check('选关页只渲染当前章节（10 关）', ch2.count === 10, `实际 ${ch2.count} 关: ${ch2.cells.join(',')}`);
  check('默认定位到进度所在章节（第 2 章）', /第\s*2\s*章/.test(ch2.active) && ch2.cells[0] === '2-1');
  await shot('02_levels_ch2');

  await evaluate(`[...document.querySelectorAll('#levels-tabs .tab')][0].click()`);
  await sleep(250);
  const ch1 = await evaluate(`(() => {
    const cells = [...document.querySelectorAll('#levels-grid .level-cell')].map(b => b.querySelector('.lv-id').textContent);
    return { cells, count: cells.length };
  })()`);
  check('切到第 1 章后只显示 1-1~1-10', ch1.count === 10 && ch1.cells[0] === '1-1' && ch1.cells[9] === '1-10', ch1.cells.join(','));
  const starText = await evaluate(`(() => {
    const first = document.querySelector('#levels-grid .level-cell .lv-stars');
    return first ? first.textContent : '';
  })()`);
  check('星级为 3 槽位填空式（1-1 应为 ★★★ 或 ★★☆ 等 3 字符）', [...starText].length === 3, `"${starText}"`);
  await shot('03_levels_ch1');

  /* ---------- 3. 局内：交换与动画 ---------- */
  log('\n=== 3) 局内交换与动画 ===');
  await evaluate(`window.__game.api.startLevel('2-3')`);
  await waitFor(`window.__game.state.page === 'play'`);
  const hud0 = await evaluate(`(() => ({
    moves: document.getElementById('play-moves').textContent,
    score: document.getElementById('play-score').textContent,
    target: document.getElementById('play-target').textContent,
  }))()`);
  check('HUD 步数/得分/目标均有数值（无 undefined/空白）',
    !/undefined|NaN/.test(JSON.stringify(hud0)) && hud0.score.trim() !== '' && hud0.target.trim() !== '',
    JSON.stringify(hud0));
  await shot('04_play');

  // 取一个合法交换
  const pair = await evaluate(`(() => {
    const g = window.__game;
    const moves = g.api.findLegalMoves(g.state.play.board);
    return moves && moves.length ? moves[0] : null;
  })()`);
  check('能取到合法交换', Array.isArray(pair) || (pair && pair.length === 2), JSON.stringify(pair));

  if (pair && pair.length === 2) {
    const startMoves = await evaluate('window.__game.state.play.movesLeft');
    // 同步触发（不 await Promise），按时间点抓动画关键帧
    await evaluate(`window.__game.api.onSwap(${pair[0]}, ${pair[1]})`, false);
    await sleep(260);
    await shot('05_anim_fade');       // 应看到被消除方块缩小淡出、留出空位
    await sleep(140);
    await shot('06_anim_fall');       // 应看到同列方块下落、顶部新方块进入
    await sleep(900);
    await shot('07_after_swap');
    const after = await evaluate(`(() => {
      const g = window.__game;
      return { movesLeft: g.state.play.movesLeft, score: g.state.play.inLevelScore, hudScore: document.getElementById('play-score').textContent };
    })()`);
    check('交换后步数减少且得分增加', after.movesLeft === startMoves - 1 && after.score > 0, JSON.stringify({ startMoves, ...after }));
    check('HUD 得分与状态一致', Number(String(after.hudScore).replace(/[^\d]/g, '')) === after.score, `HUD=${after.hudScore} state=${after.score}`);
  }

  /* ---------- 3.4 动画首帧不得闪现"结算终态"（回归：第一次消除的闪烁） ---------- */
  {
    // 在页面内用 rAF 逐帧记录画布指纹：若动画早期就出现终态指纹，即判定为闪烁
    const pair = await evaluate(`(() => {
      const g = window.__game;
      const mv = g.api.findLegalMoves(g.state.play.board);
      return mv && mv.length ? mv[0] : null;
    })()`);
    if (!pair) {
      check('能取到用于动画检查的合法交换', false);
    } else {
      const frames = await evaluate(`(async () => {
        const cv = document.getElementById('play-board');
        const ctx = cv.getContext('2d');
        const hash = () => {
          const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
          let h = 0;
          for (let i = 0; i < d.length; i += 2048) h = (h * 33 + d[i]) >>> 0;
          return h;
        };
        const rec = [];
        let stop = false;
        const tick = () => {
          rec.push(hash());
          if (!stop) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        await window.__game.api.onSwap(${pair[0]}, ${pair[1]});
        await new Promise((r) => setTimeout(r, 260));
        stop = true;
        const finalHash = hash();
        return { rec, finalHash };
      })()`);
      const { rec, finalHash } = frames;
      const early = rec.slice(0, Math.max(1, Math.floor(rec.length * 0.5)));
      const hitEarly = early.indexOf(finalHash) >= 0;
      check('动画前半程不出现结算终态画面（无"闪一下"）', !hitEarly,
        `${rec.length} 帧，其中前 ${early.length} 帧${hitEarly ? '出现' : '未出现'}终态`);
      check('动画结束画面为结算终态', rec.length > 0 && rec[rec.length - 1] === finalHash);
    }
  }

  /* ---------- 3.5 选中框与键盘光标（回归：鼠标点选不应出现虚线/角落描边） ---------- */
  log('\n=== 3.5) 选中框与键盘光标 ===');
  {
    const geom = await evaluate(`(() => {
      const cv = document.getElementById('play-board');
      const r = cv.getBoundingClientRect();
      const f = window.__game.ui.getDebugFlags();
      return { left: r.left, top: r.top, cell: f.cellSize, dpr: window.devicePixelRatio || 1, cols: window.__game.state.play.board.cols, rows: window.__game.state.play.board.rows };
    })()`);
    const clickCell = async (row, col) => evaluate(`(() => {
      const cv = document.getElementById('play-board');
      const r = cv.getBoundingClientRect();
      const f = window.__game.ui.getDebugFlags();
      const x = r.left + f.cellSize * (${col} + 0.5);
      const y = r.top + f.cellSize * (${row} + 0.5);
      const opt = { clientX: x, clientY: y, bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true };
      cv.dispatchEvent(new PointerEvent('pointerdown', opt));
      cv.dispatchEvent(new PointerEvent('pointerup', opt));
      return true;
    })()`);
    // 统计某个格子里"接近纯白"的像素数（选中框是白色 3px 描边）
    const whiteCount = (row, col) => evaluate(`(() => {
      const cv = document.getElementById('play-board');
      const ctx = cv.getContext('2d');
      const f = window.__game.ui.getDebugFlags();
      const dpr = window.devicePixelRatio || 1;
      const cs = f.cellSize * dpr;
      const x = Math.round(${col} * cs), y = Math.round(${row} * cs), s = Math.round(cs);
      const d = ctx.getImageData(x, y, s, s).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] > 235 && d[i + 1] > 235 && d[i + 2] > 235 && d[i + 3] > 200) n++;
      }
      return n;
    })()`);

    const before = { tl: await whiteCount(0, 0), br: await whiteCount(geom.rows - 1, geom.cols - 1) };
    await clickCell(Math.floor(geom.rows / 2), Math.floor(geom.cols / 2));
    await sleep(150);
    const flags = await evaluate(`window.__game.ui.getDebugFlags()`);
    const after = { tl: await whiteCount(0, 0), br: await whiteCount(geom.rows - 1, geom.cols - 1), mid: await whiteCount(Math.floor(geom.rows / 2), Math.floor(geom.cols / 2)) };
    check('鼠标点选后有选中项', flags.selection !== null && flags.selection !== undefined, String(flags.selection));
    check('鼠标点选不进入键盘光标模式', flags.keyboardMode === false);
    check('左上角无白色描边残留（原 bug）', Math.abs(after.tl - before.tl) <= 2, `before=${before.tl} after=${after.tl}`);
    check('右下角无白色描边残留（原 bug）', Math.abs(after.br - before.br) <= 2, `before=${before.br} after=${after.br}`);
    check('被选中格出现高亮描边', after.mid > 20, `mid=${after.mid}`);
    await shot('13_selection');

    // 键盘操作后应显示虚线光标，再次点击则隐藏
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))`);
    await sleep(120);
    check('按方向键后进入键盘光标模式', (await evaluate(`window.__game.ui.getDebugFlags()`)).keyboardMode === true);
    await shot('14_keyboard_cursor');
    await clickCell(0, 1);
    await sleep(120);
    check('再次点选后退出键盘光标模式', (await evaluate(`window.__game.ui.getDebugFlags()`)).keyboardMode === false);
  }

  /* ---------- 3.6 特殊方块触发特效（回归：条纹/炸弹/彩虹必须有明显视觉反馈） ---------- */
  {
    const res = await evaluate(`(async () => {
      const g = window.__game;
      const p = g.state.play;
      const moves = g.api.findLegalMoves(p.board);
      // 1) 找一个能合成特殊方块的交换
      // 1) 找一步合法交换，并在"交换后"的棋盘上定位一个匹配组
      let plan = null;
      for (const mv of moves) {
        const probeBoard = g.api.cloneBoard(p.board);
        const t = probeBoard.cells[mv[0]]; probeBoard.cells[mv[0]] = probeBoard.cells[mv[1]]; probeBoard.cells[mv[1]] = t;
        const groups = g.api.findMatches(probeBoard);
        const hit = groups.find((gr) => gr.cells.length >= 3);
        if (hit) { plan = { mv, cell: hit.cells[0] }; break; }
      }
      if (!plan) return { error: 'no-plan', moves: moves.length };
      // 2) 在该格植入横向条纹（只改 special，不改颜色 → 不会产生预置连线）
      const planted = p.board.cells[plan.cell];
      if (!planted) return { error: 'no-cell' };
      const expectedRow = Math.floor(plan.cell / p.board.cols);
      p.board.cells[plan.cell] = { color: planted.color, special: 'stripeH' };
      g.ui.drawBoard(p.board, {});
      const fireMove = plan.mv;
      const kind = 'stripeH';
      const idx = plan.cell;
      // 4) 逐帧统计每行平均亮度：触发瞬间若有扫光，整行亮度会明显上升
      const cv = document.getElementById('play-board');
      const ctx = cv.getContext('2d');
      const rows = p.board.rows;
      // 扫光是纯白（RGB 三通道都极高），方块本身的颜色/描边达不到 → 用"近白像素数"作为特征
      const rowWhite = () => {
        const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
        const out = [];
        const cellH = cv.height / rows;
        for (let r2 = 0; r2 < rows; r2++) {
          let n = 0;
          const y0 = Math.floor(r2 * cellH), y1 = Math.floor((r2 + 1) * cellH);
          for (let y = y0; y < y1; y += 2) {
            for (let x = 0; x < cv.width; x += 2) {
              const i = (y * cv.width + x) * 4;
              if (d[i] > 235 && d[i + 1] > 235 && d[i + 2] > 235) n++;
            }
          }
          out.push(n);
        }
        return out;
      };
      const base = rowWhite();
      const frames = [];
      let stop = false;
      const tick = () => { frames.push(rowWhite()); if (!stop) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      await g.api.onSwap(fireMove[0], fireMove[1]);
      await new Promise((r) => setTimeout(r, 150));
      stop = true;
      let best = { row: -1, count: 0, gain: 0 };
      for (const fr of frames) {
        for (let r2 = 0; r2 < rows; r2++) {
          const gain = fr[r2] - base[r2];
          if (gain > best.gain) best = { row: r2, count: fr[r2], gain };
        }
      }
      const after = p.board.cells[idx];
      const consumed = !after || after.special !== 'stripeH';
      return { kind, idx, expectedRow, frames: frames.length, best, baseWhite: base[expectedRow], consumed };
    })()`);
    check('能构造并触发特殊方块', !res.error, JSON.stringify(res.error || { kind: res.kind, idx: res.idx }));
    if (!res.error) {
      check('特殊方块被真正消耗（触发成功）', res.consumed === true, `idx=${res.idx}`);
      check('触发过程有动画帧', res.frames > 5, `${res.frames} 帧`);

      // 确定性像素断言：把四种特效各固定在 t=0.5 渲染一帧再测，避免帧率/时序抖动
      const px = await evaluate(`(() => {
        const g = window.__game;
        const ui = g.ui;
        const b = g.state.play.board;
        const cv = document.getElementById('play-board');
        const ctx = cv.getContext('2d');
        const rows = b.rows, cols = b.cols;
        const idx = 3 * cols + 3;
        const cellW = cv.width / cols;
        const cellH = cv.height / rows;
        const read = () => ctx.getImageData(0, 0, cv.width, cv.height).data;
        const isWhite = (d, p) => d[p * 4] > 235 && d[p * 4 + 1] > 235 && d[p * 4 + 2] > 235;
        const whiteInRow = (d, r) => {
          let n = 0;
          const y0 = Math.floor(r * cellH), y1 = Math.floor((r + 1) * cellH);
          for (let y = y0; y < y1; y += 2) for (let x = 0; x < cv.width; x += 2) if (isWhite(d, y * cv.width + x)) n++;
          return n;
        };
        const whiteInCol = (d, c2) => {
          let n = 0;
          const x0 = Math.floor(c2 * cellW), x1 = Math.floor((c2 + 1) * cellW);
          for (let x = x0; x < x1; x += 2) for (let y = 0; y < cv.height; y += 2) if (isWhite(d, y * cv.width + x)) n++;
          return n;
        };
        const meanBright = (d, r0, c0, span) => {
          let sum = 0, n = 0;
          const y0 = span ? Math.floor((r0 - span) * cellH) : 0;
          const y1 = span ? Math.floor((r0 + span + 1) * cellH) : cv.height;
          const x0 = span ? Math.floor((c0 - span) * cellW) : 0;
          const x1 = span ? Math.floor((c0 + span + 1) * cellW) : cv.width;
          for (let y = Math.max(0, y0); y < Math.min(cv.height, y1); y += 2) {
            for (let x = Math.max(0, x0); x < Math.min(cv.width, x1); x += 2) {
              const p = (y * cv.width + x) * 4;
              sum += (d[p] + d[p + 1] + d[p + 2]) / 3; n++;
            }
          }
          return n ? sum / n : 0;
        };
        ui.drawBoard(b, {});
        const base = read();
        const out = { baseRow: whiteInRow(base, 3), baseCol: whiteInCol(base, 3), baseBomb: meanBright(base, 3, 3, 1), baseAll: meanBright(base, 0, 0, 0) };
        ui.drawSpecialPreview('stripeH', idx, 0.5);
        const dH = read();
        out.rowH = whiteInRow(dH, 3); out.rowOther = whiteInRow(dH, 0);
        ui.drawSpecialPreview('stripeV', idx, 0.5);
        const dV = read();
        out.colV = whiteInCol(dV, 3); out.colOther = whiteInCol(dV, 0);
        ui.drawSpecialPreview('bomb', idx, 0.4);
        out.bomb = meanBright(read(), 3, 3, 1);
        ui.drawSpecialPreview('rainbow', idx, 0.5);
        out.rainAll = meanBright(read(), 0, 0, 0);
        ui.drawBoard(b, {});
        return out;
      })()`);
      check('横向条纹：扫光沿整行铺开（近白像素激增，且集中在目标行）',
        px.rowH > 3000 && px.rowOther < px.rowH * 0.25,
        `目标行 ${px.rowH} / 其它行 ${px.rowOther}（基线 ${px.baseRow}）`);
      check('纵向条纹：扫光沿整列铺开',
        px.colV > 3000 && px.colOther < px.colV * 0.25,
        `目标列 ${px.colV} / 其它列 ${px.colOther}（基线 ${px.baseCol}）`);
      check('炸弹：中心区域亮度明显上升',
        px.bomb > px.baseBomb + 15,
        `${px.baseBomb.toFixed(1)} → ${px.bomb.toFixed(1)}`);
      check('彩虹：全盘亮度上升（闪光）',
        px.rainAll > px.baseAll + 10,
        `${px.baseAll.toFixed(1)} → ${px.rainAll.toFixed(1)}`);
    }

    // 单独渲染一次特效用于留档截图（不跑整段动画）
    const preview = await evaluate(`(() => {
      const g = window.__game;
      const ui = g.ui;
      const b = g.state.play.board;
      if (!ui || !ui.animateSpecialTrigger) return false;
      ui.animateSpecialTrigger(b, { index: 0, special: 'stripeH' }, 900);
      return true;
    })()`);
    if (preview) {
      await sleep(220);
      await shotClean('19_special_stripe');
      await sleep(900);
    }
    // 四种特效都能正常渲染（画面确实发生变化）
    for (const kind of ['stripeH', 'stripeV', 'bomb', 'rainbow']) {
      const r = await evaluate(`(async () => {
        const g = window.__game;
        const b = g.state.play.board;
        const cv = document.getElementById('play-board');
        const ctx = cv.getContext('2d');
        const hash = () => {
          const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
          let h = 0;
          for (let i = 0; i < d.length; i += 4096) h = (h * 31 + d[i]) >>> 0;
          return h;
        };
        g.ui.drawBoard(b, {});
        const before = hash();
        const p = g.ui.animateSpecialTrigger(b, { index: 12, special: '${kind}' }, 200);
        await new Promise((res) => setTimeout(res, 90));
        const during = hash();
        await p;
        return { changed: during !== before };
      })()`);
      check(`特效可渲染：${kind}`, r.changed === true);
    }
  }
  /* ---------- 4. 交互流程：无效交换 / 道具 / 结算 / 排行 / 设置 / 引导 ---------- */
  log('\n=== 4) 交互流程 ===');
  const hudState = () => evaluate(`(() => {
    const g = window.__game;
    return {
      page: g.state.page,
      moves: g.state.play ? g.state.play.movesLeft : null,
      score: g.state.play ? g.state.play.inLevelScore : null,
      coins: g.state.save.coins,
      hudCoins: Number(String((document.getElementById('play-coins') || {}).textContent || '').replace(/[^0-9]/g, '')),
      items: g.state.save.items,
      level: g.state.play ? g.state.play.level.id : null,
      board: g.state.play ? g.state.play.board.cells.map((c) => (c ? c.color + ':' + (c.special || '') : '-')).join('|') : '',
    };
  })()`);
  const click = (id) => evaluate(`document.getElementById('${id}').click()`);
  const modalVisible = () => evaluate(`!document.getElementById('modal').classList.contains('hidden')`);

  // 4.1 无效交换：弹回、不扣步、棋盘还原
  const invalid = await evaluate(`(() => {
    const g = window.__game, b = g.state.play.board;
    for (let r = 0; r < b.rows; r++) {
      for (let c = 0; c < b.cols - 1; c++) {
        const i = r * b.cols + c;
        const probe = g.api.cloneBoard(b);
        if (!g.api.resolveSwap(probe, i, i + 1).valid) return [i, i + 1];
      }
    }
    return null;
  })()`);
  if (invalid) {
    const s0 = await hudState();
    await evaluate(`window.__game.api.onSwap(${invalid[0]}, ${invalid[1]})`);
    await sleep(500);
    const s1 = await hudState();
    check('无效交换：不扣步数', s1.moves === s0.moves, `${s0.moves}→${s1.moves}`);
    check('无效交换：棋盘完全还原', s1.board === s0.board);
    check('无效交换：得分不变', s1.score === s0.score);
  } else {
    check('能构造出无效交换对（用于 AC-04 验证）', false);
  }

  // 道具单价从页面读取（避免把价格写死在测试里，调价后无需改测试）
  const priceOf = (id) => evaluate(`window.__game.items.find((i) => i.id === '${id}').price`);

  // 4.2 道具库：6 个道具 / 解锁态 / 携带上限
  {
    await evaluate(`window.__game.api.navigate('items')`);
    await sleep(250);
    const rows = await evaluate(`document.querySelectorAll('#items-list .item-row').length`);
    const locked = await evaluate(`document.querySelectorAll('#items-list .item-row.is-locked').length`);
    const equipped = await evaluate(`document.querySelectorAll('#items-list .item-row.is-equipped').length`);
    check('道具库展示 6 个道具', rows === 6, `rows=${rows}`);
    check('演示存档下只有「加五步」未解锁（1 个锁定）', locked === 1, `locked=${locked}`);
    check('默认已携带 3 个（=上限）', equipped === 3, `equipped=${equipped}`);
    await shotClean('15_items_page');
    const addMore = await evaluate(`window.__game.api.toggleLoadoutItem('hint')`);
    check('携带已满时拒绝继续添加', addMore && addMore.ok === false, JSON.stringify(addMore));
  }

  // 4.3 重新配置携带：只带 提示 / 洗牌 / 锤子，局内道具条应随之变化
  {
    await evaluate(`window.__game.api.setLoadout(['hint', 'shuffle', 'hammer'])`);
    const loadout = await evaluate(`window.__game.state.save.loadout`);
    check('可重新配置携带列表', loadout.join(',') === 'hint,shuffle,hammer', loadout.join(','));
    await evaluate(`window.__game.api.startLevel('2-3')`);
    await waitFor(`window.__game.state.page === 'play'`);
    const btns = await evaluate(`[...document.querySelectorAll('#play-items .item')].map((b) => b.dataset.item)`);
    check('局内道具条只显示携带的 3 个', btns.join(',') === 'hint,shuffle,hammer', btns.join(','));
    await shotClean('16_items_bar');
  }

  // 4.4 锤子：确认 → 选格（不扣费）→ 点中才扣费 → 动画结束
  {
    const hammerPrice = await priceOf('hammer');
    const s0 = await hudState();
    await click('item-hammer');
    await waitFor(`!document.getElementById('modal').classList.contains('hidden')`, 4000, '锤子确认弹窗');
    check('点击锤子弹出二次确认', await modalVisible());
    await click('modal-ok');
    await waitFor(`window.__game.state.itemMode === 'hammer'`, 4000, '进入选格模式');
    check('确认后进入选格模式（未扣费）', (await hudState()).coins === s0.coins);
    await evaluate(`window.__game.api.onItemPick(0)`);
    await sleep(900);
    const s1 = await hudState();
    check('锤子选定后按标价扣费', s1.coins === s0.coins - hammerPrice, `${s0.coins}→${s1.coins}，标价 ${hammerPrice}`);
    check('锤子后退出选格模式', (await evaluate(`window.__game.state.itemMode`)) === null);
    check('锤子后无错误日志', !(await evaluate(`window.__game.log.get().some((l) => l.lv === 'error')`)));
  }

  // 4.5 洗牌：确认 → 扣费 → 棋盘变化 → 不扣步
  {
    const shufflePrice = await priceOf('shuffle');
    const s0 = await hudState();
    await click('item-shuffle');
    await waitFor(`!document.getElementById('modal').classList.contains('hidden')`, 4000, '洗牌确认弹窗');
    await click('modal-ok');
    await sleep(900);
    const s1 = await hudState();
    check('洗牌按标价扣费', s1.coins === s0.coins - shufflePrice, `${s0.coins}→${s1.coins}，标价 ${shufflePrice}`);
    check('洗牌不消耗步数', s1.moves === s0.moves);
    check('洗牌后棋盘发生变化', s1.board !== s0.board);
  }

  // 4.6 提示：无需确认，直接扣费并高亮
  {
    const hintPrice = await priceOf('hint');
    const countGold = () => evaluate(`(() => {
      const cv = document.getElementById('play-board');
      const ctx = cv.getContext('2d');
      const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        // 提示框颜色 #ffd166，与方块里的芥末黄（约 230,180,70）区分开
        if (d[i] > 248 && d[i + 1] > 204 && d[i + 1] < 216 && d[i + 2] > 96 && d[i + 2] < 110) n++;
      }
      return n;
    })()`);
    const s0 = await hudState();
    const gold0 = await countGold();
    await evaluate(`window.__game.api.useItem('hint')`);
    await sleep(300);
    const s1 = await hudState();
    const gold1 = await countGold();
    check('提示按标价扣费', s1.coins === s0.coins - hintPrice, `${s0.coins}→${s1.coins}，标价 ${hintPrice}`);
    check('HUD 金币已同步刷新', s1.hudCoins === s1.coins, `HUD=${s1.hudCoins} state=${s1.coins}`);
    check('提示在棋盘上画出金色高亮框', gold1 > gold0 + 300, `金色像素 ${gold0}→${gold1}`);
    check('未提示时无提示色（基线接近 0）', gold0 < 500, `基线 ${gold0}`);
    check('提示不消耗步数、不改棋盘', s1.moves === s0.moves && s1.board === s0.board);
    await shotClean('17_items_hint');
  }

  // 4.7 结算：结果页 → 下一关
  {
    const before = await hudState();
    await evaluate(`window.__game.api.onSettle(true)`);
    await sleep(300);
    const res = await evaluate(`(() => ({
      page: window.__game.state.page,
      stars: document.getElementById('result-stars').textContent,
      score: document.getElementById('result-score').textContent,
      sub: document.getElementById('result-sub').textContent,
      nextDisabled: document.getElementById('result-next').disabled,
      levelId: window.__game.state.play.level.id,
      unlocked: window.__game.state.save.unlockedLevelId,
    }))()`);
    check('过关后进入结算页', res.page === 'result');
    check('结算页星级为 3 槽位', [...res.stars.trim()].length === 3, `"${res.stars}"`);
    check('结算页显示总分（数值）', Number(String(res.score).replace(/[^\d]/g, '')) > 0, res.score);
    check('结算页显示金币奖励', /\+/.test(res.sub) || /金币/.test(res.sub), res.sub);
    await shot('08_result');
    if (!res.nextDisabled) {
      await click('result-next');
      await waitFor(`window.__game.state.page === 'play'`);
      const nxt = await hudState();
      check('点"下一关"进入下一关', nxt.level !== res.levelId, `${res.levelId}→${nxt.level}`);
    }
  }

  // 4.8 首通双倍金币：2-6 从未通关 → +20；再打一次 → +10（无双倍）
  {
    const coins0 = (await hudState()).coins;
    await evaluate(`window.__game.api.startLevel('2-6')`);
    await waitFor(`window.__game.state.page === 'play'`);
    await evaluate(`window.__game.api.onSettle(true)`);
    await sleep(350);
    const r1 = await evaluate(`(() => ({
      coins: window.__game.state.save.coins,
      sub: document.getElementById('result-sub').textContent,
      firstClear: window.__game.state.result.firstClear,
    }))()`);
    check('首次通关得到双倍金币（1 星 +20）', r1.coins - coins0 === 20, `Δ${r1.coins - coins0}`);
    check('result.firstClear 为 true', r1.firstClear === true);
    check('结算文案标注"首次通关双倍"', /首次通关双倍/.test(r1.sub), r1.sub);
    await shot('18_result_first_clear');
    await evaluate(`window.__game.api.startLevel('2-6')`);
    await waitFor(`window.__game.state.page === 'play'`);
    await evaluate(`window.__game.api.onSettle(true)`);
    await sleep(350);
    const r2 = await evaluate(`(() => ({ coins: window.__game.state.save.coins, sub: document.getElementById('result-sub').textContent }))()`);
    check('同一关重复通关只给基础金币（+10）', r2.coins - r1.coins === 10, `Δ${r2.coins - r1.coins}`);
    check('重复通关不再标注双倍', !/双倍/.test(r2.sub), r2.sub);
  }
  // 4.5 排行榜：两榜都有内容且可切换
  {
    await evaluate(`window.__game.api.navigate('rank')`);
    await sleep(200);
    const total = await evaluate(`document.querySelectorAll('#rank-list li').length`);
    check('总星榜有条目', total > 0, `${total} 条`);
    await shot('09_rank');
    await click('rank-tab-level');
    await sleep(200);
    const lv = await evaluate(`document.querySelectorAll('#rank-list li').length`);
    const picks = await evaluate(`document.querySelectorAll('#rank-level-pick .tab').length`);
    check('单关榜可切换且有关卡选择', lv > 0 && picks > 0, `${lv} 条 / ${picks} 个关卡`);
  }

  // 4.6 设置：音量生效；重置弹确认且取消不生效
  {
    await evaluate(`window.__game.api.navigate('settings')`);
    await sleep(200);
    await evaluate(`(() => { const el = document.getElementById('settings-music-vol'); el.value = '40'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await sleep(200);
    check('调音量写入存档', (await evaluate(`window.__game.state.save.settings.musicVol`)) === 40);
    const coinsBefore = (await hudState()).coins;
    await click('settings-reset');
    await waitFor(`!document.getElementById('modal').classList.contains('hidden')`, 4000, '重置确认弹窗');
    check('重置弹出二次确认', await modalVisible());
    await shot('10_settings_reset');
    await click('modal-cancel');
    await sleep(200);
    check('取消重置后数据未变', (await hudState()).coins === coinsBefore);
  }

  // 4.7 新手引导：guided=false 时进 1-1 应弹出，走完三步后置位
  {
    await evaluate(`window.__game.state.save.guided = false; window.__game.api.startLevel('1-1')`);
    await sleep(400);
    const shown = await evaluate(`!document.getElementById('guide').classList.contains('hidden')`);
    check('首次进入 1-1 弹出引导', shown);
    if (shown) {
      await shot('11_guide');
      for (let i = 0; i < 3; i++) { await click('guide-next'); await sleep(150); }
      const done = await evaluate(`({ guided: window.__game.state.save.guided, hidden: document.getElementById('guide').classList.contains('hidden') })`);
      check('走完引导后置 guided=true 且关闭遮罩', done.guided === true && done.hidden === true, JSON.stringify(done));
    }
  }

  /* ---------- 5. 日志与错误 ---------- */
  log('\n=== 5) 运行日志 ===');
  const logs = await evaluate(`window.__game.log.get()`);
  const events = logs.map((l) => l.event);
  const errs = logs.filter((l) => l.lv === 'error');
  check('采集到 level.start 事件', events.includes('level.start'));
  check('采集到 swap.ok 事件', events.includes('swap.ok'));
  check('采集到动画解锁事件', events.includes('anim.lock'));
  check('页面日志无 error 级条目', errs.length === 0, errs.slice(0, 3).map((e) => e.event + ':' + JSON.stringify(e.data)).join(' | '));
  check('控制台无未捕获异常', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

  const timing = logs.filter((l) => /perf\./.test(l.event)).map((l) => `${l.event}=${l.data && l.data.ms}ms`);
  log('  耗时打点: ' + (timing.join(', ') || '（无）'));

  fs.writeFileSync(path.join(OUT, 'page-logs.json'), JSON.stringify(logs, null, 2), 'utf8');
  fs.writeFileSync(path.join(OUT, 'console.txt'), consoleLines.join('\n'), 'utf8');
  log(`\n  日志已导出: ${path.join(OUT, 'page-logs.json')}（${logs.length} 条）`);
  log(`  控制台输出: ${path.join(OUT, 'console.txt')}（${consoleLines.length} 行）`);

  /* ---------- 6. 正式版隔离检查（放在最后：会离开测试版页面） ---------- */
  log('\n=== 6) 正式版隔离检查（index.html）===');
  await cdp.send('Page.navigate', { url: `${BASE}/index.html?demo=1&debug=1` });
  await sleep(1600);
  const prod = await evaluate(`({
    hasGame: typeof window.__game !== 'undefined',
    hasPanel: !!document.getElementById('debug-panel'),
    hasBadge: !!document.getElementById('dev-badge'),
    activePage: document.querySelector('.page.is-active') ? document.querySelector('.page.is-active').id : null,
    title: document.title,
  })`);
  check('正式版不暴露 window.__game', prod.hasGame === false, String(prod.hasGame));
  check('正式版无调试面板', prod.hasPanel === false);
  check('正式版无"测试版"角标', prod.hasBadge === false);
  check('正式版标题不含"测试版"', !/测试版/.test(prod.title), prod.title);
  check('正式版正常启动到首页', prod.activePage === 'page-home', String(prod.activePage));
  await shot('12_production');
} catch (e) {
  console.error('\n运行失败:', e && e.message ? e.message : e);
  fail.push('harness: ' + (e && e.message));
} finally {
  try { cdp && cdp.ws.close(); } catch (e) {}
  if (!KEEP) {
    try { child.kill(); } catch (e) {}
    await sleep(400);
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (e) {}
  }
}

log('\n' + '='.repeat(56));
log(fail.length ? `端到端测试：失败 ${fail.length} 项 -> ${fail.join(' / ')}` : '端到端测试：全部通过');
log(`截图目录: ${shots}`);
log('='.repeat(56));
process.exit(fail.length ? 1 : 0);
