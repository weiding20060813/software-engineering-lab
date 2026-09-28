// smoke.mjs —— 快速烟测（验证核心路径不卡死、性能可接受）
import { createBoard, findLegalMoves, findMatches, resolveSwap, isDeadlock, shuffleBoard } from '../src/board.js';

const t0 = Date.now();
const rng = (() => { let s = 42; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; })();

let boards = 0;
const tCreate = Date.now();
for (let i = 0; i < 50; i++) { createBoard({ rows: 7, cols: 7, colors: 4, rng }); boards++; }
console.log(`createBoard ×${boards}: ${Date.now() - tCreate} ms`);

const b = createBoard({ rows: 7, cols: 7, colors: 4, rng });
const tLegal = Date.now();
const legal = findLegalMoves(b);
console.log(`findLegalMoves: ${Date.now() - tLegal} ms，合法交换 ${legal.length} 个`);

const tMove = Date.now();
let total = 0, maxCombo = 0, shuffles = 0;
for (let i = 0; i < 200; i++) {
  const board = createBoard({ rows: 7, cols: 7, colors: 4, rng });
  const moves = findLegalMoves(board);
  if (!moves.length) { shuffleBoard(board, rng); continue; }
  const [a, c] = moves[Math.floor(rng() * moves.length)];
  const res = resolveSwap(board, a, c, rng);
  total += res.score;
  maxCombo = Math.max(maxCombo, res.combos.length);
  if (res.shuffled) shuffles++;
}
console.log(`200 次交换结算: ${Date.now() - tMove} ms（平均得分 ${Math.round(total / 200)}，最长连锁 ${maxCombo}，自动洗牌 ${shuffles} 次）`);

// 搜索一个死局棋盘（用于死局处理测试）
const tDead = Date.now();
let dead = null;
for (let i = 0; i < 20000 && !dead; i++) {
  const board = createBoard({ rows: 7, cols: 7, colors: 3, rng });
  if (isDeadlock(board)) dead = board;
}
console.log(`死局搜索: ${Date.now() - tDead} ms，${dead ? '已找到死局样本' : '未找到（3 色 7×7 罕见）'}`);

// 检查大棋盘（9×9/6 色）
const tBig = Date.now();
for (let i = 0; i < 30; i++) createBoard({ rows: 9, cols: 9, colors: 6, rng });
console.log(`createBoard 9×9/6 色 ×30: ${Date.now() - tBig} ms`);
console.log(`总耗时: ${Date.now() - t0} ms`);
