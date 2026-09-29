// levels.js —— 30 关配置（FR-08：3 章 × 10 关，数据驱动，新增关卡不改代码）
// 章节基准：第 1 章 7×7/4 色/24 步；第 2 章 8×8/5 色/20 步；第 3 章 8×8~9×9/6 色/18 步
// 每关在章节基准上 ±3 步。
// 目标值来源：由 tests/calibrate-levels.mjs 用贪心求解器实测校准（AC-11 依据），
// 校准口径：scoreTarget = k(章) × 贪心"全打完可达分"；消除型 objectiveTarget = 实测目标色消除量的 65%。
import { bonusPerStepFor } from './config.js';

export const CHAPTERS = [
  { chapter: 1, name: '晨光草坪', rows: 7, cols: 7, colors: 4, baseMoves: 24 },
  { chapter: 2, name: '星辉海滩', rows: 8, cols: 8, colors: 5, baseMoves: 20 },
  { chapter: 3, name: '月影雪原', rows: 8, cols: 8, colors: 6, baseMoves: 18 },
];

// 章内逐关步数偏移（前松后紧）
const MOVE_OFFSETS = [3, 2, 1, 1, 0, 0, -1, -1, -2, -3];

// 校准后的星级基准分（tests/calibrate-levels.mjs 输出，2026-09-28）
// 校准口径见该脚本头部注释：1 星线由不动点迭代求得，使贪心玩家失败率 ≈ 10%/20%/30%（逐章变难）
export const LEVEL_SCORE_TARGETS = {
  '1-1': 12050, '1-2': 10350, '1-3': 10500, '1-4': 12140, '1-5': 9920,
  '1-6': 12000, '1-7': 7810, '1-8': 9800, '1-9': 8170, '1-10': 8050,
  '2-1': 4740, '2-2': 4410, '2-3': 4170, '2-4': 5190, '2-5': 4020,
  '2-6': 4220, '2-7': 3500, '2-8': 4860, '2-9': 3940, '2-10': 3050,
  '3-1': 2620, '3-2': 2760, '3-3': 2220, '3-4': 2450, '3-5': 2140,
  '3-6': 2590, '3-7': 2170, '3-8': 3040, '3-9': 1740, '3-10': 1770,
};

// 校准后的消除型目标值（目标色方块数）
export const LEVEL_OBJECTIVE_TARGETS = {
  '2-6': 36, '2-7': 34, '2-8': 34, '2-9': 30, '2-10': 38,
  '3-1': 20, '3-2': 16, '3-3': 18, '3-4': 18, '3-5': 16,
  '3-6': 16, '3-7': 22, '3-8': 20, '3-9': 16, '3-10': 14,
};

// 缺省回退（新增关卡未列入校准表时使用）
const FALLBACK_SCORE_K = { 1: 280, 2: 240, 3: 140 };
const FALLBACK_CLEAR_TARGET = { 2: 28, 3: 26 };

function makeLevel(chapterCfg, index) {
  const { chapter, rows, cols, colors, baseMoves } = chapterCfg;
  const moves = baseMoves + MOVE_OFFSETS[index - 1];
  const id = `${chapter}-${index}`;
  const boardRows = chapter === 3 && index >= 6 ? 9 : rows;
  const boardCols = boardRows;

  let objectiveType = 'score';
  if (chapter === 2 && index >= 6) objectiveType = 'clear';
  if (chapter === 3) objectiveType = 'clear';

  // 目标色：取模必须归一化为非负数（避免 JS 负数取模产生非法颜色）
  const targetColor = ((index - 6) % colors + colors) % colors;

  if (objectiveType === 'score') {
    const scoreTarget = LEVEL_SCORE_TARGETS[id] || Math.round((moves * FALLBACK_SCORE_K[chapter]) / 10) * 10;
    return {
      id, chapter, index, name: `第 ${chapter}-${index} 关`,
      boardRows, boardCols, colors, moves,
      objectiveType: 'score', objectiveTarget: scoreTarget, targetColor: null,
      scoreTarget, bonusPerStep: bonusPerStepFor(scoreTarget, moves),
    };
  }

  const objectiveTarget = LEVEL_OBJECTIVE_TARGETS[id] || FALLBACK_CLEAR_TARGET[chapter];
  const scoreTarget = LEVEL_SCORE_TARGETS[id] || Math.round((objectiveTarget * FALLBACK_SCORE_K[chapter]) / 10) * 10;
  return {
    id, chapter, index, name: `第 ${chapter}-${index} 关`,
    boardRows, boardCols, colors, moves,
    objectiveType: 'clear', objectiveTarget, targetColor,
    scoreTarget, bonusPerStep: bonusPerStepFor(scoreTarget, moves),
  };
}

export const LEVELS = CHAPTERS.flatMap((cfg) =>
  Array.from({ length: 10 }, (_, i) => makeLevel(cfg, i + 1))
);

export function levelById(id) {
  return LEVELS.find((l) => l.id === id) || null;
}

/** 配置校验（FR-05 异常处理）：字段约束见《01》7.1 */
export function validateLevel(level) {
  const errors = [];
  if (!/^\d+-\d+$/.test(level.id)) errors.push('id 格式应为 {章}-{关}');
  if (!Number.isInteger(level.boardRows) || level.boardRows < 7 || level.boardRows > 9) errors.push('棋盘行数须为 7~9 的整数');
  if (!Number.isInteger(level.boardCols) || level.boardCols < 7 || level.boardCols > 9) errors.push('棋盘列数须为 7~9 的整数');
  if (!Number.isInteger(level.colors) || level.colors < 4 || level.colors > 6) errors.push('颜色数须为 4~6 的整数');
  if (!Number.isInteger(level.moves) || level.moves < 15 || level.moves > 30) errors.push('步数须为 15~30 的整数');
  if (level.objectiveType !== 'score' && level.objectiveType !== 'clear') errors.push('objectiveType 只能为 score 或 clear');
  if (level.objectiveType === 'clear') {
    if (!Number.isInteger(level.targetColor)) errors.push('消除型必须指定整数 targetColor');
    else if (level.targetColor < 0 || level.targetColor >= level.colors) errors.push('targetColor 必须落在颜色池 [0, colors) 内');
    if (!Number.isInteger(level.objectiveTarget) || level.objectiveTarget <= 0) errors.push('消除型 objectiveTarget 必须为正整数');
  } else if (level.objectiveTarget <= 0) {
    errors.push('得分型 objectiveTarget 必须为正');
  }
  if (!(level.scoreTarget > 0)) errors.push('scoreTarget 必须为正');
  if (!(level.bonusPerStep > 0)) errors.push('bonusPerStep 必须为正');
  return errors;
}
