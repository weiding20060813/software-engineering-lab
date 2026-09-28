// logic.test.mjs —— 核心逻辑自动化验证（对应《01_需求分析文档》8.2 节验收用例）
// 运行：node tests/logic.test.mjs
import {
  createBoard, findMatches, findLegalMoves, isDeadlock, shuffleBoard, cloneBoard,
  resolveSwap, applyHammer, applyShuffleItem, idx, isSpecial, SP,
} from '../src/board.js';
import { LEVELS, validateLevel } from '../src/levels.js';
import { comboScore, finalScore, starsFor } from '../src/score.js';
import { createStorage, defaultSave, isValidSave, migrateSave } from '../src/storage.js';
import { ITEM_PRICES, SCORE_PER_BLOCK, WIN_COINS, bonusPerStepFor, BONUS_RATIO } from '../src/config.js';
import { playLevel } from './sim-player.mjs';

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? '  [' + detail + ']' : ''}`); }
  else { fail++; failures.push(name); console.log(`  ❌ ${name}${detail ? '  [' + detail + ']' : ''}`); }
}
function section(t) { console.log(`\n=== ${t} ===`); }

// ---------- AC-01 / AC-02 ----------
section('AC-01 / AC-02  棋盘初始化（无 3 连 + 至少有 1 个合法交换）');
for (const cfg of [{ rows: 7, cols: 7, colors: 4 }, { rows: 8, cols: 8, colors: 5 }, { rows: 9, cols: 9, colors: 6 }]) {
  const rng = mulberry32(1000 + cfg.colors);
  let withMatch = 0, dead = 0;
  const N = 1000;
  for (let i = 0; i < N; i++) {
    const b = createBoard({ ...cfg, rng });
    if (findMatches(b).length > 0) withMatch++;
    if (findLegalMoves(b).length === 0) dead++;
  }
  check(`${cfg.rows}×${cfg.cols}/${cfg.colors} 色：初始无连线`, withMatch === 0, `违规 ${withMatch}/${N}`);
  check(`${cfg.rows}×${cfg.cols}/${cfg.colors} 色：初始非死局`, dead === 0, `死局 ${dead}/${N}`);
}

// ---------- AC-03 / AC-04 / AC-13 ----------
section('AC-03 / AC-04  有效交换消除、无效交换弹回、得分可复算');
{
  const rng = mulberry32(7);
  let validCount = 0, invalidCount = 0, invalidChangedBoard = 0, scoreOk = true, comboSeqOk = true;
  for (let round = 0; round < 60; round++) {
    const b = createBoard({ rows: 7, cols: 7, colors: 4, rng });
    for (let r = 0; r < b.rows; r++) {
      for (let c = 0; c + 1 < b.cols; c++) {
        const a = idx(b, r, c), d = idx(b, r, c + 1);
        const before = cloneBoard(b);
        const res = resolveSwap(b, a, d, rng);
        if (res.valid) {
          validCount++;
          // AC-13：得分可复算
          const recomputed = res.combos.reduce((s, e) => s + comboScore(e.cleared, e.comboIndex), 0);
          if (recomputed !== res.score) scoreOk = false;
          res.combos.forEach((e, k) => { if (e.comboIndex !== k + 1) comboSeqOk = false; });
        } else {
          invalidCount++;
          // AC-04：无效交换必须完全弹回（棋盘逐格一致）
          const same = b.cells.every((cell, i) => {
            const old = before.cells[i];
            if (!cell || !old) return cell === old;
            return cell.color === old.color && cell.special === old.special;
          });
          if (!same) invalidChangedBoard++;
        }
      }
    }
  }
  check('有效交换被判定为消耗步数的消除', validCount > 0, `${validCount} 次有效交换`);
  check('无效交换全部弹回（valid=false）', invalidCount > 0, `${invalidCount} 次无效交换`);
  check('AC-04 无效交换后棋盘完全还原（逐格一致）', invalidChangedBoard === 0, `异常 ${invalidChangedBoard} 次`);
  check('AC-13 得分 = Σ(消除数×20×倍率)，可复算', scoreOk);
  check('连锁序号从 1 连续递增', comboSeqOk);
}

// ---------- AC-05 / 计分常量 ----------
section('AC-05  连锁与倍率（B(n)=min(1+0.5(n-1),2.5)）');
{
  const rng = mulberry32(11);
  let cascades = 0, maxCombo = 0;
  for (let i = 0; i < 400; i++) {
    const b = createBoard({ rows: 8, cols: 8, colors: 5, rng });
    const legal = findLegalMoves(b);
    if (!legal.length) continue;
    const [a, c] = legal[Math.floor(rng() * legal.length)];
    const res = resolveSwap(b, a, c, rng);
    if (res.combos.length >= 2) cascades++;
    maxCombo = Math.max(maxCombo, res.combos.length);
  }
  check('连锁（≥2 次连续消除）可正常发生', cascades > 0, `${cascades} 局出现连锁，最长 ${maxCombo} 连`);
}
section('AC-13b 计分常量与公式');
{
  check('基础分 20/方块', SCORE_PER_BLOCK === 20);
  check('单次 3 消 = 60 分', comboScore(3, 1) === 60, `${comboScore(3, 1)}`);
  check('第 2 连锁倍率 1.5（3 消 = 90 分）', comboScore(3, 2) === 90, `${comboScore(3, 2)}`);
  check('倍率封顶 2.5（第 5 连锁 = 第 4 连锁）', comboScore(3, 5) === comboScore(3, 4), `${comboScore(3, 5)}`);
  check('剩余步数奖励与目标分挂钩：bonusPerStep = 0.8×T/moves',
    bonusPerStepFor(10000, 20) === Math.round(BONUS_RATIO * 10000 / 20), `${bonusPerStepFor(10000, 20)}`);
  const bps = bonusPerStepFor(13720, 27);
  check('过关总分 = 局内分 + 剩余步数×每步奖励', finalScore(10000, 5, true, bps) === 10000 + 5 * bps);
  check('失败不计算剩余步数奖励', finalScore(10000, 5, false, bps) === 10000);
}

// ---------- AC-06 / FR-03-3 ----------
section('AC-06  死局检测与自动洗牌');
{
  // 对角条纹（颜色 = (r+c) % 3）无相邻交换可形成 3 连 → 死局
  const rows = 7, cols = 7;
  const dead = { rows, cols, colors: 3, cells: [] };
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) dead.cells.push({ color: (r + c) % 3, special: null });
  check('对角条纹局面无既存连线', findMatches(dead).length === 0);
  check('对角条纹局面被判定为死局', isDeadlock(dead), `合法交换 ${findLegalMoves(dead).length} 个`);

  const rng = mulberry32(3);
  shuffleBoard(dead, rng);
  check('洗牌后不再是死局', !isDeadlock(dead));
  check('洗牌后无残留连线', findMatches(dead).length === 0);
  check('洗牌不改变方块总数', dead.cells.filter(Boolean).length === rows * cols);
}
{
  const rng = mulberry32(21);
  let errors = 0, cases = 0;
  for (let i = 0; i < 300; i++) {
    const b = createBoard({ rows: 7, cols: 7, colors: 4, rng });
    if (isDeadlock(b)) {
      cases++;
      if (!applyShuffleItem(b, rng).ok || isDeadlock(b)) errors++;
    }
  }
  check('洗牌道具始终产出可玩棋盘', errors === 0, `死局场景 ${cases} 次`);
}

// ---------- FR-04 ----------
section('FR-04  特殊方块合成与触发');
{
  const mk = (grid, colors = 6) => ({
    rows: grid.length, cols: grid[0].length, colors,
    cells: grid.flat().map((v) => (v === null ? null : { color: v, special: null })),
  });
  const base = [
    [1, 2, 3, 4, 5, 1],
    [2, 3, 4, 5, 1, 2],
    [0, 0, 0, 0, 0, 3],
    [4, 5, 1, 2, 3, 4],
    [5, 1, 2, 3, 4, 5],
    [1, 2, 3, 4, 5, 1],
  ];
  const g5 = findMatches(mk(base));
  check('5 连 → 彩虹方块', g5.length === 1 && g5[0].special === SP.RAINBOW, `识别 ${g5.length} 组`);

  const grid4 = base.map((row, r) => (r === 2 ? [0, 0, 0, 0, 3, 3] : row));
  const g4 = findMatches(mk(grid4));
  check('横 4 连 → 条纹方块（横）', g4.some((g) => g.special === SP.STRIPE_H), JSON.stringify(g4.map((g) => g.special)));

  const gridT = base.map((row, r) => (r === 2 ? [0, 0, 0, 5, 3, 3] : r === 1 ? [2, 0, 4, 5, 1, 2] : r === 3 ? [4, 0, 1, 2, 3, 4] : row));
  const gT = findMatches(mk(gridT));
  check('T 形 → 炸弹方块', gT.some((g) => g.special === SP.BOMB), JSON.stringify(gT.map((g) => g.special)));
}
{
  const rng = mulberry32(99);
  const created = { stripeH: 0, stripeV: 0, bomb: 0, rainbow: 0 };
  let crossBlasts = 0;
  for (let i = 0; i < 3000; i++) {
    const b = createBoard({ rows: 8, cols: 8, colors: 5, rng });
    const legal = findLegalMoves(b);
    if (!legal.length) continue;
    const [a, c] = legal[Math.floor(rng() * legal.length)];
    const res = resolveSwap(b, a, c, rng);
    res.specialsCreated.forEach((s) => { created[s.special] = (created[s.special] || 0) + 1; });
    if (res.crossBlast) crossBlasts++;
  }
  check('条纹方块可在实战中合成', created.stripeH + created.stripeV > 0, `横 ${created.stripeH} / 竖 ${created.stripeV}`);
  check('炸弹方块可在实战中合成', created.bomb > 0, `${created.bomb} 次`);
  check('彩虹方块可在实战中合成', created.rainbow > 0, `${created.rainbow} 次`);
}

// ---------- FR-09 ----------
section('FR-09  道具行为');
{
  const rng = mulberry32(31);
  const b = createBoard({ rows: 8, cols: 8, colors: 5, rng });
  const before = b.cells.filter(Boolean).length;
  const r = applyHammer(b, idx(b, 3, 3), rng);
  check('锤子可消除指定格且棋盘补满', r.ok && b.cells.filter(Boolean).length === before);
  check('锤子消除物不计分', r.scored === 0);
  check('道具价格符合文档（100/150/200）', ITEM_PRICES.shuffle === 100 && ITEM_PRICES.hammer === 150 && ITEM_PRICES.steps === 200);
  check('过关金币 +30', WIN_COINS === 30);
}

// ---------- AC-14 ----------
section('AC-14  星级阈值（R = 结算总分 / scoreTarget）');
{
  const T = 1000;
  check('R=0.99 → 0 星', starsFor(990, T, true) === 0);
  check('R=1.00 → 1 星（边界）', starsFor(1000, T, true) === 1);
  check('R=1.29 → 1 星', starsFor(1290, T, true) === 1);
  check('R=1.30 → 2 星（边界）', starsFor(1300, T, true) === 2);
  check('R=1.59 → 2 星', starsFor(1590, T, true) === 2);
  check('R=1.60 → 3 星（边界）', starsFor(1600, T, true) === 3);
  check('未过关一律 0 星', starsFor(9999, T, false) === 0);
}

// ---------- 关卡配置校验 ----------
section('FR-08 / 7.1  30 关配置校验（含 targetColor 越界回归测试）');
{
  let errors = 0;
  const details = [];
  LEVELS.forEach((lv) => {
    const errs = validateLevel(lv);
    if (errs.length) { errors++; details.push(`${lv.id}: ${errs.join('；')}`); }
  });
  check('30 关配置全部通过字段校验', errors === 0, details.join(' | ') || `${LEVELS.length} 关`);
  check('关卡总数为 30（3 章 × 10 关）', LEVELS.length === 30);
  const chCount = {};
  LEVELS.forEach((l) => { chCount[l.chapter] = (chCount[l.chapter] || 0) + 1; });
  check('每章 10 关', chCount[1] === 10 && chCount[2] === 10 && chCount[3] === 10);

  // 回归：负数取模曾导致 targetColor 为负（第 3 章 1~5 关）
  const clearLevels = LEVELS.filter((l) => l.objectiveType === 'clear');
  const badColor = clearLevels.filter((l) => !Number.isInteger(l.targetColor) || l.targetColor < 0 || l.targetColor >= l.colors);
  check('回归：所有消除型关卡的 targetColor 合法且非负', badColor.length === 0, `异常 ${badColor.length} 关`);
  const badValidate = validateLevel({ ...LEVELS[0], targetColor: -1, objectiveType: 'clear', objectiveTarget: 10 });
  check('回归：校验函数能拦截负数 targetColor', badValidate.some((e) => e.includes('targetColor')));
  const badMoves = validateLevel({ ...LEVELS[0], moves: 12 });
  check('配置校验能拦截超出 15~30 的步数', badMoves.some((e) => e.includes('步数')));
}

// ---------- AC-11 + FR-07 可达性 ----------
section('AC-11  30 关可通关性与星级可达性（模拟玩家）');
{
  const RUNS = 9;
  const rows = [];
  let levelsPassedByGreedy = 0, greedyWins = 0, casualWins = 0;
  const starCount = { greedy: [0, 0, 0, 0], casual: [0, 0, 0, 0] };

  LEVELS.forEach((lv) => {
    const rng = mulberry32(5100 + lv.chapter * 100 + lv.index);
    const g = Array.from({ length: RUNS }, () => playLevel(lv, rng, { style: 'greedy' }));
    const c = Array.from({ length: RUNS }, () => playLevel(lv, rng, { style: 'casual' }));
    const gw = g.filter((r) => r.won).length;
    const cw = c.filter((r) => r.won).length;
    if (gw > 0) levelsPassedByGreedy++;
    greedyWins += gw;
    casualWins += cw;
    g.forEach((r) => starCount.greedy[r.stars]++);
    c.forEach((r) => starCount.casual[r.stars]++);
    rows.push({ id: lv.id, type: lv.objectiveType, target: lv.objectiveType === 'score' ? lv.scoreTarget : lv.objectiveTarget, gw, cw, RUNS });
  });

  console.log('\n  关卡  | 类型  | 目标值 | 贪心通关 | 休闲通关');
  console.log('  ' + '-'.repeat(48));
  rows.forEach((r) => {
    console.log(`  ${r.id.padEnd(5)} | ${r.type.padEnd(5)} | ${String(r.target).padStart(6)} | ${String(r.gw + '/' + r.RUNS).padStart(8)} | ${String(r.cw + '/' + r.RUNS).padStart(8)}`);
  });

  check('AC-11 贪心求解器可通过全部 30 关（每关至少通关 1 次）', levelsPassedByGreedy === 30, `${levelsPassedByGreedy}/30`);
  const greedyRate = greedyWins / (LEVELS.length * RUNS);
  check('贪心玩家整体通关率处于合理区间（50%~100%）', greedyRate >= 0.5 && greedyRate <= 1, `${(greedyRate * 100).toFixed(1)}%`);
  const casualRate = casualWins / (LEVELS.length * RUNS);
  check('休闲玩家也能通关（20%~80%，关卡非不可能完成）', casualRate >= 0.2 && casualRate <= 0.8, `${(casualRate * 100).toFixed(1)}%`);
  check('FR-07 三档星级在实战中均可达成（1/2/3 星各出现）',
    starCount.greedy[1] > 0 && starCount.greedy[2] > 0 && starCount.greedy[3] > 0,
    `贪心星级分布 1星${starCount.greedy[1]} 2星${starCount.greedy[2]} 3星${starCount.greedy[3]}`);
  const threeStarShare = starCount.greedy[3] / Math.max(1, starCount.greedy[1] + starCount.greedy[2] + starCount.greedy[3]);
  check('3 星并非唾手可得（占通关局 < 40%）', threeStarShare < 0.4, `${(threeStarShare * 100).toFixed(0)}%`);
}

// ---------- AC-21 ~ AC-24 ----------
section('AC-21 ~ AC-24  存档读写、损坏、写入失败、存储不可用');
function mockBackend(initial = {}) {
  const store = { ...initial };
  return {
    store,
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
}
{
  const be = mockBackend();
  const st = createStorage(be, () => 1700000000000);
  check('无存档时返回新档（fresh）', st.load().status === 'fresh');
  const data = defaultSave();
  data.coins = 120;
  data.unlockedLevelId = '1-3';
  check('写入成功', st.save(data).ok);
  const loaded = st.load();
  check('AC-21 重新读取进度保留', loaded.status === 'ok' && loaded.data.coins === 120 && loaded.data.unlockedLevelId === '1-3');
}
{
  const be = mockBackend({ stardust_save: '{ 这不是合法 JSON' });
  const st = createStorage(be, () => 1700000000000);
  const res = st.load();
  check('AC-22 损坏存档被识别并重置', res.status === 'corrupt' && res.data.unlockedLevelId === '1-1');
  check('AC-22 损坏原文已备份到独立键', !!be.store['stardust_save_corrupt_1700000000000']);
}
{
  const be = mockBackend();
  be.setItem = () => { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; };
  const st = createStorage(be, () => 1700000000000);
  const r = st.save(defaultSave());
  check('AC-23 配额耗尽时写入失败被捕获（不抛出）', r.ok === false && r.error === 'QuotaExceededError');
}
{
  const st = createStorage(null, () => 1700000000000);
  check('AC-24 存储不可用 → 降级为内存模式', st.load().status === 'unavailable');
  const r = st.save(defaultSave());
  check('AC-24 降级模式下仍可游玩（memoryOnly）', r.ok === true && r.memoryOnly === true);
}
{
  check('结构校验能识别缺字段存档', isValidSave({ version: 1 }) === false);
  check('高版本存档无法迁移 → 触发重置保护', migrateSave({ version: 99 }) === null);
}

console.log('\n' + '='.repeat(60));
console.log(`测试汇总：通过 ${pass} 项，失败 ${fail} 项`);
if (fail) {
  console.log('失败项：');
  failures.forEach((f) => console.log('  - ' + f));
}
console.log('='.repeat(60));
process.exit(fail ? 1 : 0);
