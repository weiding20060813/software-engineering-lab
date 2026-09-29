// score.js —— 计分与星级（FR-06 / FR-07，公式唯一权威实现）
import {
  SCORE_PER_BLOCK,
  STAR_THRESHOLDS,
  comboMultiplier,
} from './config.js';

/** 某一次连锁的得分 = 该次消除方块数 × 20 × B(n) */
export function comboScore(clearedCount, comboIndex) {
  return clearedCount * SCORE_PER_BLOCK * comboMultiplier(comboIndex);
}

/**
 * 结算总分 = 局内累计得分 + 剩余步数 × 每步奖励（仅过关时计算剩余步数奖励）
 * 每步奖励由关卡给出（bonusPerStep = BONUS_RATIO × scoreTarget / moves），
 * 使星级比率 1.0 / 1.3 / 1.6 分别对应"恰好达成 / 余约 24% 步数 / 余约 48% 步数"。
 */
export function finalScore(inLevelScore, movesLeft, won, bonusPerStep = 0) {
  return won ? inLevelScore + movesLeft * bonusPerStep : inLevelScore;
}

/**
 * 星级：R = 结算总分 / scoreTarget
 * - 未过关 → 0 星（不得覆盖历史最好成绩）
 * - 过关（达成目标）→ **至少 1 星**，R ≥ 1.3 → 2 星，R ≥ 1.6 → 3 星
 *   （v1.2 修订：clear 型关卡"刚好达标"时的得分可能低于 scoreTarget，
 *    若按下限 0 星会产生"达成目标却 0 星"的逻辑空洞）
 */
export function starsFor(totalScore, scoreTarget, won = true) {
  if (!won) return 0;
  const r = totalScore / scoreTarget;
  if (r >= STAR_THRESHOLDS[2]) return 3;
  if (r >= STAR_THRESHOLDS[1]) return 2;
  return 1;
}
