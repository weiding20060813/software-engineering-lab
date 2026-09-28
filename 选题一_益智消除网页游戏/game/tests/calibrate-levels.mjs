// calibrate-levels.mjs —— 关卡目标值与难度校准（AC-11 可通关性、FR-07 星级可达性的依据）
//
// 校准口径（可解释、可复跑）：
//   ① 用贪心求解器（消除型关卡为"目标色优先"策略）模拟对局；
//   ② 1 星线 scoreTarget 用不动点迭代求出：反复令
//        scoreTarget ← quantile_q( 以当前 scoreTarget 为停止条件的结算总分 )
//      迭代收敛后，q 即"贪心玩家的失败率"，因此三章分别取 q = 10% / 20% / 30%，
//      对应贪心通关率 ≈ 90% / 80% / 70%（逐章变难）；
//   ③ 消除型目标值 objectiveTarget = 目标色消除量的 P20；
//   ④ 步数奖励 bonusPerStep = BONUS_RATIO × scoreTarget / moves（BONUS_RATIO 见 config.js，
//      决定 2 星/3 星所需剩余步数比例）；
//   ⑤ 复核：贪心玩家与休闲玩家（随机合法走法）的通关率与星级分布。
//
// 运行：node tests/calibrate-levels.mjs
import { createBoard, findLegalMoves, findMatches, resolveSwap, shuffleBoard, isSpecial, cellAt } from '../src/board.js';
import { LEVELS } from '../src/levels.js';
import { bonusPerStepFor, BONUS_RATIO } from '../src/config.js';
import { finalScore, starsFor } from '../src/score.js';

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gainOf(board, a, b, targetColor) {
  const t = board.cells[a]; board.cells[a] = board.cells[b]; board.cells[b] = t;
  const set = new Set();
  findMatches(board).forEach((g) => g.cells.forEach((x) => set.add(x)));
  let target = 0;
  if (targetColor !== null && targetColor !== undefined) {
    for (const i of set) {
      const cell = board.cells[i];
      if (cell && cell.color === targetColor) target++;
    }
  }
  const t2 = board.cells[a]; board.cells[a] = board.cells[b]; board.cells[b] = t2;
  return { total: set.size, target };
}

function pickMove(board, legal, rng, style, targetColor) {
  if (style === 'casual') return legal[Math.floor(rng() * legal.length)];
  const sample = legal.length > 30 ? legal.slice(0, 30) : legal;
  let best = sample[0], bestScore = -Infinity;
  for (const [a, b] of sample) {
    const g = gainOf(board, a, b, targetColor);
    const specialBonus = isSpecial(cellAt(board, a)) || isSpecial(cellAt(board, b)) ? 8 : 0;
    const s = targetColor === null || targetColor === undefined
      ? g.total + specialBonus
      : g.target * 10 + g.total + specialBonus;
    if (s > bestScore) { bestScore = s; best = [a, b]; }
  }
  return best;
}

function play(level, rng, { style = 'greedy', stopScore = Infinity, stopColor = Infinity, bonusPerStep = 0 } = {}) {
  const board = createBoard({ rows: level.boardRows, cols: level.boardCols, colors: level.colors, rng });
  const targetColor = level.objectiveType === 'clear' ? level.targetColor : null;
  let score = 0, moves = level.moves, color = 0, invalid = 0, guard = 0;
  const met = () => (level.objectiveType === 'score' ? score >= stopScore : color >= stopColor);
  while (moves > 0 && guard++ < 3000) {
    if (met()) break;
    const legal = findLegalMoves(board);
    if (!legal.length) { shuffleBoard(board, rng); continue; }
    const pick = pickMove(board, legal, rng, style, targetColor);
    const res = resolveSwap(board, pick[0], pick[1], rng);
    if (!res.valid) { invalid++; if (invalid > 30) break; continue; }
    invalid = 0;
    score += res.score;
    moves--;
    color += res.clearedByColor[level.targetColor] || 0;
  }
  const won = met();
  return { score, movesLeft: moves, color, won, total: finalScore(score, moves, won, bonusPerStep) };
}

const quantile = (arr, q) => {
  const s = [...arr].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))));
  return s[i];
};
const median = (arr) => quantile(arr, 0.5);

const FAIL_RATE = { 1: 0.10, 2: 0.20, 3: 0.30 };   // 贪心玩家失败率（逐章变难）
const RUNS = 21;
const ITER = 6;

const scoreTargets = {};
const objectiveTargets = {};
const starDist = { greedy: [], casual: [] };
let greedyWins = 0, casualWins = 0, greedyRuns = 0, casualRuns = 0;

console.log('关卡 | 类型 | 步数 | 棋盘 | 目标值 | 星级基准 | 奖励/步 | 贪心通关 | 贪心星级 | 休闲通关 | 休闲星级');
console.log('-'.repeat(112));

for (const lv of LEVELS) {
  const rng = mulberry32(9100 + lv.chapter * 100 + lv.index);
  const q = FAIL_RATE[lv.chapter];

  // 消除型：先定目标色消除量
  let objectiveTarget = null;
  if (lv.objectiveType === 'clear') {
    const full = Array.from({ length: RUNS }, () => play(lv, rng, { style: 'greedy' }));
    objectiveTarget = Math.max(10, Math.round(quantile(full.map((r) => r.color), 0.2) / 2) * 2);
    objectiveTargets[lv.id] = objectiveTarget;
  }

  // 不动点迭代求 1 星线
  const stopScoreInit = lv.scoreTarget || 1000;
  let target = stopScoreInit;
  let bonusPerStep = bonusPerStepFor(target, lv.moves);
  for (let k = 0; k < ITER; k++) {
    bonusPerStep = bonusPerStepFor(target, lv.moves);
    const totals = Array.from({ length: RUNS }, () =>
      play(lv, rng, { style: 'greedy', stopScore: target, stopColor: objectiveTarget ?? Infinity, bonusPerStep })
    ).map((r) => r.total);
    target = Math.max(200, Math.round(quantile(totals, q) / 10) * 10);
  }
  scoreTargets[lv.id] = target;
  bonusPerStep = bonusPerStepFor(target, lv.moves);

  // 复核
  const verify = (style) => {
    const runs = Array.from({ length: RUNS }, () =>
      play(lv, rng, { style, stopScore: target, stopColor: objectiveTarget ?? Infinity, bonusPerStep })
    );
    return {
      winRate: runs.filter((r) => r.won).length,
      runs: runs.length,
      stars: runs.map((r) => starsFor(r.total, target, r.won)),
    };
  };
  const g = verify('greedy');
  const c = verify('casual');
  greedyWins += g.winRate; greedyRuns += g.runs;
  casualWins += c.winRate; casualRuns += c.runs;
  starDist.greedy.push(...g.stars);
  starDist.casual.push(...c.stars);

  console.log(
    `${lv.id.padEnd(5)}| ${lv.objectiveType.padEnd(5)}| ${String(lv.moves).padStart(4)} | ${(lv.boardRows + '×' + lv.boardCols).padEnd(4)} | ${String(objectiveTarget ?? target).padStart(6)} | ${String(target).padStart(8)} | ${String(bonusPerStep).padStart(7)} | ${String(g.winRate + '/' + g.runs).padStart(8)} | ${String(median(g.stars)).padStart(8)} | ${String(c.winRate + '/' + c.runs).padStart(8)} | ${String(median(c.stars)).padStart(8)}`
  );
}

const fmt = (arr) => [0, 1, 2, 3].map((s) => `${s}星 ${arr.filter((x) => x === s).length}`).join('  ');
const winDist = (arr) => {
  const wins = arr.filter((s) => s > 0);
  return [1, 2, 3].map((s) => `${s}星 ${((wins.filter((x) => x === s).length / wins.length) * 100).toFixed(0)}%`).join('  ');
};
console.log(`\nBONUS_RATIO = ${BONUS_RATIO}（2 星 ≈ 剩余 ${((0.3 / BONUS_RATIO) * 100).toFixed(0)}% 步数，3 星 ≈ 剩余 ${((0.6 / BONUS_RATIO) * 100).toFixed(0)}% 步数）`);
console.log('贪心玩家星级分布：' + fmt(starDist.greedy) + '   （通关局中：' + winDist(starDist.greedy) + '）');
console.log('休闲玩家星级分布：' + fmt(starDist.casual) + '   （通关局中：' + winDist(starDist.casual) + '）');
console.log(`贪心通关率：${((greedyWins / greedyRuns) * 100).toFixed(1)}%（${greedyWins}/${greedyRuns}）`);
console.log(`休闲通关率：${((casualWins / casualRuns) * 100).toFixed(1)}%（${casualWins}/${casualRuns}）`);

console.log('\n=== 可粘贴到 levels.js ===\n');
console.log('export const LEVEL_SCORE_TARGETS = ' + JSON.stringify(scoreTargets) + ';');
console.log('\nexport const LEVEL_OBJECTIVE_TARGETS = ' + JSON.stringify(objectiveTargets) + ';');
