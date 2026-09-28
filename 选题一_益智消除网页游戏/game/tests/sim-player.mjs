// sim-player.mjs —— 模拟玩家（用于可通关性与难度验证，不参与游戏运行）
// style: 'greedy' 选当前消除数最多（消除型关卡优先清目标色）的走法；'casual' 随机选一个合法走法
import { createBoard, findLegalMoves, findMatches, resolveSwap, shuffleBoard, isSpecial, cellAt } from '../src/board.js';
import { finalScore, starsFor } from '../src/score.js';

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

/** 模拟一局：达成目标即停（与游戏内规则一致），返回结算结果 */
export function playLevel(level, rng, { style = 'greedy' } = {}) {
  const board = createBoard({ rows: level.boardRows, cols: level.boardCols, colors: level.colors, rng });
  const targetColor = level.objectiveType === 'clear' ? level.targetColor : null;
  let score = 0, moves = level.moves, color = 0, invalid = 0, guard = 0;
  const met = () => (level.objectiveType === 'score' ? score >= level.objectiveTarget : color >= level.objectiveTarget);
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
  const total = finalScore(score, moves, won, level.bonusPerStep);
  return { won, score, total, movesLeft: moves, color, stars: starsFor(total, level.scoreTarget, won) };
}
