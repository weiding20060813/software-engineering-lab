// config.js —— 全局常量（唯一权威定义，对应《01_需求分析文档》FR-06/FR-07/FR-09、7.1/7.2）
export const MAX_COLORS = 6;

// FR-06 计分规则
export const SCORE_PER_BLOCK = 20;          // 每个被消除方块基础分
export const COMBO_STEP = 0.5;              // 每级连锁倍率增量
export const COMBO_MAX_MULTIPLIER = 2.5;    // 连锁倍率封顶
// 剩余步数奖励：与关卡目标分挂钩（BONUS_RATIO × scoreTarget / moves）
// 依据：《01》要求的星级比率 1.0/1.3/1.6 在"达成即结算"规则下的数值可达性推导
// （详见《02_AI协作记录》M-14 与 game/README.md）。系数 0.8 使
//   2 星 ≈ 剩余 37.5% 步数、3 星 ≈ 剩余 75% 步数，1 星为"恰好达成"。
export const BONUS_RATIO = 0.8;
export const REMAINING_MOVE_BONUS = 200;    // 遗留常量：仅用于新关卡缺省回退

export function bonusPerStepFor(scoreTarget, moves) {
  if (!moves || !scoreTarget) return REMAINING_MOVE_BONUS;
  return Math.max(20, Math.round((BONUS_RATIO * scoreTarget) / moves));
}

// FR-07 星级阈值（结算总分 / scoreTarget）
export const STAR_THRESHOLDS = [1.0, 1.3, 1.6];

// FR-07 / FR-09 经济
export const WIN_COINS = 30;                // 过关奖励金币
export const FIRST_THREE_STAR_COINS = 20;   // 首次 3 星额外奖励
export const ITEM_PRICES = { shuffle: 100, hammer: 150, steps: 200 };
export const ITEM_INITIAL = { shuffle: 1, hammer: 1, steps: 1 };
export const ITEM_CAP = 99;

// FR-01 初始化约束
export const INITIALIZE_MAX_TRIES = 50;

// FR-11 存档
export const SAVE_KEY = 'stardust_save';
export const SAVE_VERSION = 1;
export const NICKNAME_MAX = 8;

// 动画时长约束（FR-16，供 UI 层使用）
export const ANIM = {
  swap: 220,
  bounceBack: 260,
  clear: 220,
  fall: 280,
  special: 380,
  result: 1800,
};

export function comboMultiplier(comboIndex) {
  return Math.min(1 + COMBO_STEP * (comboIndex - 1), COMBO_MAX_MULTIPLIER);
}
