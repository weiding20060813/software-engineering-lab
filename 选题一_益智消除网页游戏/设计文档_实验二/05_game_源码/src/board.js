// board.js —— 核心玩法引擎（对应 FR-01 ~ FR-06、FR-09 部分）
// 纯逻辑、无 DOM 依赖，可在浏览器与 Node 中复用（便于自动化验证 AC-01~AC-07/AC-11/AC-13）
import { INITIALIZE_MAX_TRIES } from './config.js';
import { comboScore } from './score.js';

/** 特殊方块类型（FR-04） */
export const SP = {
  STRIPE_H: 'stripeH',   // 横 4 连合成：触发时清除整行
  STRIPE_V: 'stripeV',   // 竖 4 连合成：触发时清除整列
  BOMB: 'bomb',          // T/L 形 5 个合成：触发时清除 3×3
  RAINBOW: 'rainbow',    // 横/竖 5 连合成：与任意方块交换时清除全屏该色
};

export const defaultRng = () => Math.random();
const rInt = (rng, n) => Math.floor(rng() * n);

export const idx = (board, r, c) => r * board.cols + c;
export const rowOf = (board, i) => Math.floor(i / board.cols);
export const colOf = (board, i) => i % board.cols;
export const cellAt = (board, i) => board.cells[i];
export const isSpecial = (cell) => !!(cell && cell.special);
export const isRainbow = (cell) => !!(cell && cell.special === SP.RAINBOW);

export function cloneBoard(board) {
  return {
    rows: board.rows,
    cols: board.cols,
    colors: board.colors,
    cells: board.cells.map((c) => (c ? { color: c.color, special: c.special } : null)),
  };
}

function swapCells(board, a, b) {
  const t = board.cells[a];
  board.cells[a] = board.cells[b];
  board.cells[b] = t;
}

function createsImmediateMatch(board, r, c, color) {
  if (c >= 2) {
    const a = board.cells[idx(board, r, c - 1)];
    const b = board.cells[idx(board, r, c - 2)];
    if (a && b && a.color === color && b.color === color) return true;
  }
  if (r >= 2) {
    const a = board.cells[idx(board, r - 1, c)];
    const b = board.cells[idx(board, r - 2, c)];
    if (a && b && a.color === color && b.color === color) return true;
  }
  return false;
}

/** FR-01：生成初始棋盘（无 3 连 + 至少 1 个合法交换），失败则重新生成（最多 50 次后强制洗牌修正） */
export function createBoard({ rows, cols, colors, rng = defaultRng }) {
  let board;
  let tries = 0;
  do {
    board = { rows, cols, colors, cells: new Array(rows * cols).fill(null) };
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let color;
        let guard = 0;
        do {
          color = rInt(rng, colors);
          guard++;
        } while (guard < 50 && createsImmediateMatch(board, r, c, color));
        board.cells[idx(board, r, c)] = { color, special: null };
      }
    }
    tries++;
  } while (
    tries < INITIALIZE_MAX_TRIES &&
    (findMatches(board).length > 0 || findLegalMoves(board).length === 0)
  );

  // 兜底：仍不满足则洗牌修正，保证"开局可玩"（不阻塞游戏）
  if (findLegalMoves(board).length === 0) shuffleBoard(board, rng);
  let guard = 0;
  while (findMatches(board).length > 0 && guard < 200) {
    shuffleBoard(board, rng);
    guard++;
  }
  return board;
}

/** 找出所有长度 ≥3 的同色横/竖连线 */
export function findRuns(board) {
  const runs = [];
  for (let r = 0; r < board.rows; r++) {
    let start = 0;
    for (let c = 1; c <= board.cols; c++) {
      const prev = board.cells[idx(board, r, c - 1)];
      const cur = c < board.cols ? board.cells[idx(board, r, c)] : null;
      const same = !!(prev && cur && cur.color === prev.color);
      if (!same) {
        const len = c - start;
        if (len >= 3 && prev) {
          const cells = [];
          for (let k = start; k < c; k++) cells.push(idx(board, r, k));
          runs.push({ dir: 'h', len, color: prev.color, cells });
        }
        start = c;
      }
    }
  }
  for (let c = 0; c < board.cols; c++) {
    let start = 0;
    for (let r = 1; r <= board.rows; r++) {
      const prev = board.cells[idx(board, r - 1, c)];
      const cur = r < board.rows ? board.cells[idx(board, r, c)] : null;
      const same = !!(prev && cur && cur.color === prev.color);
      if (!same) {
        const len = r - start;
        if (len >= 3 && prev) {
          const cells = [];
          for (let k = start; k < r; k++) cells.push(idx(board, k, c));
          runs.push({ dir: 'v', len, color: prev.color, cells });
        }
        start = r;
      }
    }
  }
  return runs;
}

/** 将相交连线合并为"组"，并按形状决定要合成的特殊方块（FR-04） */
export function findMatches(board) {
  const runs = findRuns(board);
  if (runs.length === 0) return [];

  const parent = runs.map((_, i) => i);
  const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  for (let i = 0; i < runs.length; i++) {
    for (let j = i + 1; j < runs.length; j++) {
      if (runs[i].color !== runs[j].color) continue;
      const setJ = new Set(runs[j].cells);
      if (runs[i].cells.some((x) => setJ.has(x))) union(i, j);
    }
  }

  const buckets = new Map();
  runs.forEach((run, i) => {
    const root = find(i);
    if (!buckets.has(root)) buckets.set(root, []);
    buckets.get(root).push(run);
  });

  const groups = [];
  for (const rs of buckets.values()) {
    const cellSet = new Set();
    rs.forEach((run) => run.cells.forEach((x) => cellSet.add(x)));
    const maxLen = Math.max(...rs.map((r) => r.len));
    const hasH = rs.some((r) => r.dir === 'h');
    const hasV = rs.some((r) => r.dir === 'v');

    let special = null;
    if (maxLen >= 5) special = SP.RAINBOW;
    else if (hasH && hasV) special = SP.BOMB;
    else if (maxLen === 4) special = rs.find((r) => r.len === 4).dir === 'h' ? SP.STRIPE_H : SP.STRIPE_V;

    groups.push({ cells: [...cellSet], color: rs[0].color, special, runs: rs });
  }
  return groups;
}

/** 单点匹配判定：以 (r,c) 为中心的横/竖是否达到 3 连（O(1)，用于快速合法性判断） */
export function matchAt(board, r, c) {
  const cell = board.cells[idx(board, r, c)];
  if (!cell) return false;
  const color = cell.color;
  let n = 1;
  for (let cc = c - 1; cc >= 0; cc--) {
    const x = board.cells[idx(board, r, cc)];
    if (!x || x.color !== color) break;
    n++;
  }
  for (let cc = c + 1; cc < board.cols; cc++) {
    const x = board.cells[idx(board, r, cc)];
    if (!x || x.color !== color) break;
    n++;
  }
  if (n >= 3) return true;
  n = 1;
  for (let rr = r - 1; rr >= 0; rr--) {
    const x = board.cells[idx(board, rr, c)];
    if (!x || x.color !== color) break;
    n++;
  }
  for (let rr = r + 1; rr < board.rows; rr++) {
    const x = board.cells[idx(board, rr, c)];
    if (!x || x.color !== color) break;
    n++;
  }
  return n >= 3;
}

/** 列出全部合法交换（含特殊方块交换，FR-04） */
export function findLegalMoves(board) {
  const moves = [];
  for (let r = 0; r < board.rows; r++) {
    for (let c = 0; c < board.cols; c++) {
      const i = idx(board, r, c);
      const neighbours = [];
      if (c + 1 < board.cols) neighbours.push([idx(board, r, c + 1), r, c + 1]);
      if (r + 1 < board.rows) neighbours.push([idx(board, r + 1, c), r + 1, c]);
      for (const [j, r2, c2] of neighbours) {
        const a = board.cells[i];
        const b = board.cells[j];
        if (!a || !b) continue;
        // FR-04-2：仅"双特殊组合爆发"与"彩虹与任意方块交换"可无条件成立；
        // 条纹/炸弹仍需形成 3 连才可交换（否则弹回，不消耗步数）
        if (a.special && b.special) {
          moves.push([i, j]);
          continue;
        }
        if (isRainbow(a) || isRainbow(b)) {
          moves.push([i, j]);
          continue;
        }
        swapCells(board, i, j);
        const ok = matchAt(board, r, c) || matchAt(board, r2, c2);
        swapCells(board, i, j);
        if (ok) moves.push([i, j]);
      }
    }
  }
  return moves;
}

export function isDeadlock(board) {
  return findLegalMoves(board).length === 0;
}

/**
 * FR-03-3：洗牌（不消耗步数），保证洗牌后"无残留连线 + 可玩"。
 * 采用构造式排布（逐格挑一个不成 3 连的颜色）而非纯随机重排：
 * 颜色数少时（如 3 色）纯随机重排几乎必然产生连线，无法满足要求。
 */
export function shuffleBoard(board, rng = defaultRng) {
  const specials = board.cells.map((c) => (c && c.special ? c.special : null));
  const colorPool = board.cells.filter(Boolean).map((c) => c.color);

  for (let attempt = 0; attempt < 80; attempt++) {
    const pool = colorPool.slice();
    const grid = new Array(board.cells.length).fill(null);
    let ok = true;
    for (let i = 0; i < grid.length; i++) {
      const r = rowOf(board, i);
      const c = colOf(board, i);
      const candidates = [];
      for (let k = 0; k < pool.length; k++) {
        const color = pool[k];
        if (c >= 2) {
          const a = grid[i - 1], b = grid[i - 2];
          if (a && b && a.color === color && b.color === color) continue;
        }
        if (r >= 2) {
          const a = grid[i - board.cols], b = grid[i - 2 * board.cols];
          if (a && b && a.color === color && b.color === color) continue;
        }
        candidates.push(k);
      }
      if (!candidates.length) { ok = false; break; }
      const pickIdx = candidates[rInt(rng, candidates.length)];
      grid[i] = { color: pool[pickIdx], special: null };
      pool.splice(pickIdx, 1);
    }
    if (!ok) continue;
    // 特殊方块保留在原位置（不参与重排）
    for (let i = 0; i < grid.length; i++) {
      if (specials[i]) grid[i] = { color: grid[i].color, special: specials[i] };
    }
    board.cells = grid;
    if (!isDeadlock(board)) return board;
  }

  // 兜底：随机改色直到不再是死局（极端情况，可能残留连线，由调用方继续结算）
  let guard = 0;
  while (isDeadlock(board) && guard++ < 500) {
    const i = rInt(rng, board.cells.length);
    if (board.cells[i]) board.cells[i].color = rInt(rng, board.colors);
  }
  return board;
}

function cellsOfColor(board, color) {
  const out = [];
  board.cells.forEach((cell, i) => {
    if (cell && cell.color === color) out.push(i);
  });
  return out;
}

function mostCommonColor(board) {
  const counts = new Array(board.colors).fill(0);
  board.cells.forEach((cell) => {
    if (cell) counts[cell.color]++;
  });
  let best = 0;
  for (let i = 1; i < counts.length; i++) if (counts[i] > counts[best]) best = i;
  return best;
}

/** 特殊方块被触发时的影响格（FR-04-2） */
function specialEffectCells(board, i, cell) {
  const out = [];
  const r = rowOf(board, i);
  const c = colOf(board, i);
  switch (cell.special) {
    case SP.STRIPE_H:
      for (let cc = 0; cc < board.cols; cc++) out.push(idx(board, r, cc));
      break;
    case SP.STRIPE_V:
      for (let rr = 0; rr < board.rows; rr++) out.push(idx(board, rr, c));
      break;
    case SP.BOMB:
      for (let rr = r - 1; rr <= r + 1; rr++) {
        for (let cc = c - 1; cc <= c + 1; cc++) {
          if (rr >= 0 && rr < board.rows && cc >= 0 && cc < board.cols) out.push(idx(board, rr, cc));
        }
      }
      break;
    case SP.RAINBOW:
      out.push(...cellsOfColor(board, mostCommonColor(board)));
      break;
    default:
      break;
  }
  return out;
}

/** 组合爆发：以交换位置为中心清除 3 行 + 3 列（FR-04-3） */
function crossBlastCells(board, center) {
  const out = new Set();
  const r = rowOf(board, center);
  const c = colOf(board, center);
  for (let dr = -1; dr <= 1; dr++) {
    const rr = r + dr;
    if (rr >= 0 && rr < board.rows) for (let cc = 0; cc < board.cols; cc++) out.add(idx(board, rr, cc));
  }
  for (let dc = -1; dc <= 1; dc++) {
    const cc = c + dc;
    if (cc >= 0 && cc < board.cols) for (let rr = 0; rr < board.rows; rr++) out.add(idx(board, rr, cc));
  }
  return [...out];
}

function gravityAndRefill(board, rng) {
  for (let c = 0; c < board.cols; c++) {
    let write = board.rows - 1;
    for (let r = board.rows - 1; r >= 0; r--) {
      const i = idx(board, r, c);
      if (board.cells[i]) {
        if (write !== r) {
          board.cells[idx(board, write, c)] = board.cells[i];
          board.cells[i] = null;
        }
        write--;
      }
    }
    for (let r = write; r >= 0; r--) {
      board.cells[idx(board, r, c)] = { color: rInt(rng, board.colors), special: null };
    }
  }
}

/**
 * FR-02/FR-03/FR-04/FR-06：执行一次交换并完整结算（消除 → 连锁 → 下落补充 → 死局洗牌）
 * @returns {{valid:boolean, score:number, clearedTotal:number, clearedByColor:Object,
 *            combos:Array, specialsCreated:Array, crossBlast:boolean, shuffled:boolean,
 *            steps:Array<{comboIndex:number, cleared:number[], score:number, snapshot:Object}>}}
 *          steps 供表现层逐帧回放：每一步的「被消除格」与「下落补充后的棋盘快照」。
 */
export function resolveSwap(board, a, b, rng = defaultRng) {
  const result = {
    valid: false, score: 0, clearedTotal: 0, clearedByColor: {},
    combos: [], specialsCreated: [], crossBlast: false, shuffled: false, steps: [],
  };

  swapCells(board, a, b);
  const ca = board.cells[a];
  const cb = board.cells[b];
  const bothSpecial = !!(ca && cb && ca.special && cb.special);
  const rainbowInvolved = isRainbow(ca) || isRainbow(cb);
  const groupsNow = findMatches(board);

  // 无效交换：弹回，不消耗步数（FR-02-2）
  if (groupsNow.length === 0 && !bothSpecial && !rainbowInvolved) {
    swapCells(board, a, b);
    return result;
  }
  result.valid = true;

  let queue = [];
  if (bothSpecial) {
    result.crossBlast = true;
    queue.push(...crossBlastCells(board, a));
  } else if (rainbowInvolved) {
    const rainbowIdx = isRainbow(board.cells[a]) ? a : b;
    const otherIdx = rainbowIdx === a ? b : a;
    const other = board.cells[otherIdx];
    if (other && other.special) {
      result.crossBlast = true;
      queue.push(...crossBlastCells(board, rainbowIdx));
    } else if (other) {
      queue.push(...cellsOfColor(board, other.color));
    }
    queue.push(rainbowIdx);
  }

  const clearedEver = new Set();
  let comboIndex = 0;
  let shuffleGuard = 0;

  for (;;) {
    const groups = findMatches(board);
    if (groups.length === 0 && queue.length === 0) {
      // FR-03-3：连锁结束且无待处理效果时检查死局 → 自动洗牌（不消耗步数）
      if (isDeadlock(board) && shuffleGuard++ < 5) {
        shuffleBoard(board, rng);
        result.shuffled = true;
        continue;   // 洗牌兜底路径可能引入连线，回到循环顶部继续结算
      }
      break;
    }
    comboIndex++;

    const toClear = new Set(queue);
    queue = [];
    groups.forEach((g) => g.cells.forEach((x) => toClear.add(x)));

    // 触发被消除的特殊方块：效果格**并入本次消除**，并递归展开被波及的特殊方块
    // （FR-04-4：触发者与被触发者必须同一批消失，而不是分成两次消除）
    const triggered = [];
    const expanded = new Set();
    const pending = [...toClear];
    while (pending.length) {
      const i = pending.pop();
      const cell = board.cells[i];
      if (!cell || !cell.special || expanded.has(i) || clearedEver.has(i)) continue;
      expanded.add(i);
      triggered.push({ index: i, special: cell.special });
      for (const j of specialEffectCells(board, i, cell)) {
        if (board.cells[j] && !toClear.has(j) && !clearedEver.has(j)) {
          toClear.add(j);
          pending.push(j);       // 被波及的格子里若有特殊方块，在同一批里继续展开
        }
      }
    }
    // 一次触发多个特殊方块时，按「离交换点由近及远」排序（参考开心消消乐的连锁顺序感）
    if (triggered.length > 1) {
      const distToSwap = (i) => Math.min(
        Math.abs(rowOf(board, i) - rowOf(board, a)) + Math.abs(colOf(board, i) - colOf(board, a)),
        Math.abs(rowOf(board, i) - rowOf(board, b)) + Math.abs(colOf(board, i) - colOf(board, b)),
      );
      triggered.sort((x, y) => distToSwap(x.index) - distToSwap(y.index) || x.index - y.index);
    }

    // 计分与颜色统计（FR-06：特殊方块按普通方块计分）
    const byColor = {};
    let count = 0;
    for (const i of toClear) {
      const cell = board.cells[i];
      if (!cell) continue;
      count++;
      byColor[cell.color] = (byColor[cell.color] || 0) + 1;
      clearedEver.add(i);
    }
    const gained = comboScore(count, comboIndex);
    result.score += gained;
    result.clearedTotal += count;
    Object.entries(byColor).forEach(([k, v]) => {
      result.clearedByColor[k] = (result.clearedByColor[k] || 0) + v;
    });
    result.combos.push({ comboIndex, cleared: count, score: gained, triggered });

    // 合成特殊方块（优先落在交换位）
    const createdStart = result.specialsCreated.length;
    for (const g of groups) {
      if (!g.special) continue;
      let spawn = g.cells.find((x) => x === a || x === b);
      if (spawn === undefined) spawn = g.cells[Math.floor(g.cells.length / 2)];
      toClear.delete(spawn);
      board.cells[spawn] = { color: g.color, special: g.special };
      result.specialsCreated.push({ index: spawn, special: g.special, color: g.color });
    }
    const createdNow = result.specialsCreated.slice(createdStart);

    const clearedNow = [...toClear].filter((i) => board.cells[i]);
    for (const i of toClear) board.cells[i] = null;
    gravityAndRefill(board, rng);
    // 供 UI 逐帧回放：本步消除格、触发的特殊方块、新合成的特殊方块 + 补充后的快照（FR-16）
    result.steps.push({
      comboIndex, cleared: clearedNow, score: gained, snapshot: cloneBoard(board),
      triggered: triggered.map((t) => ({ ...t })), created: createdNow,
    });
  }

  return result;
}

/**
 * FR-09 道具共用：清除给定格子并「静默结算」
 * 静默 = 补位后若又形成连线，只做清除与补位，**不计分、不生成特殊方块**（道具不直接买分）；
 * 最后做死局检查。返回消除格、按色统计与快照（供 UI 回放与目标计数）。
 */
export function clearCellsAndSettle(board, cells, rng = defaultRng) {
  const cleared = [];
  const byColor = {};
  for (const i of cells) {
    const cell = board.cells[i];
    if (!cell) continue;
    cleared.push(i);
    byColor[cell.color] = (byColor[cell.color] || 0) + 1;
    board.cells[i] = null;
  }
  if (!cleared.length) return { ok: false, cleared: [], byColor, snapshot: cloneBoard(board), shuffled: false };
  gravityAndRefill(board, rng);

  let guard = 0;
  let silentRounds = 0;
  while (guard++ < 20) {
    const groups = findMatches(board);
    if (!groups.length) break;
    silentRounds++;
    for (const g of groups) {
      for (const c of g.cells) {
        const cell = board.cells[c];
        if (!cell) continue;
        byColor[cell.color] = (byColor[cell.color] || 0) + 1;
        cleared.push(c);
        board.cells[c] = null;
      }
    }
    gravityAndRefill(board, rng);
  }

  const shuffled = isDeadlock(board);
  if (shuffled) shuffleBoard(board, rng);
  return { ok: true, cleared, byColor, silentRounds, snapshot: cloneBoard(board), shuffled };
}

/** FR-09 锤子：消除任意 1 格；计入消除目标但不计分、不触发特殊效果 */
export function applyHammer(board, i, rng = defaultRng) {
  const cell = board.cells[i];
  if (!cell) return { ok: false };
  const color = cell.color;
  const res = clearCellsAndSettle(board, [i], rng);
  return { ...res, color, scored: 0 };
}

/** FR-09 炸弹：以所选格为中心的 3×3 范围清除（不计分） */
export function applyBombItem(board, i, rng = defaultRng) {
  const cell = board.cells[i];
  if (!cell) return { ok: false };
  const r = rowOf(board, i);
  const c = colOf(board, i);
  const cells = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr;
      const cc = c + dc;
      if (rr >= 0 && rr < board.rows && cc >= 0 && cc < board.cols) cells.push(idx(board, rr, cc));
    }
  }
  const res = clearCellsAndSettle(board, cells, rng);
  return { ...res, color: cell.color, scored: 0 };
}

/** FR-09 同色：清除棋盘上该颜色的全部方块（不计分） */
export function applyColorClear(board, i, rng = defaultRng) {
  const cell = board.cells[i];
  if (!cell) return { ok: false };
  const color = cell.color;
  const cells = [];
  board.cells.forEach((c2, j) => {
    if (c2 && c2.color === color) cells.push(j);
  });
  const res = clearCellsAndSettle(board, cells, rng);
  return { ...res, color, scored: 0 };
}

/** FR-09 洗牌道具：与死局洗牌效果相同（不消耗步数） */
export function applyShuffleItem(board, rng = defaultRng) {
  shuffleBoard(board, rng);
  return { ok: true };
}
