// config.js —— 全局常量（唯一权威定义，对应《01_需求分析文档》FR-06/FR-07/FR-09、7.1/7.2）
export const MAX_COLORS = 6;

// FR-06 计分规则
export const SCORE_PER_BLOCK = 20;          // 每个被消除方块基础分
export const COMBO_STEP = 0.5;              // 每级连锁倍率增量
export const COMBO_MAX_MULTIPLIER = 2.5;    // 连锁倍率封顶
// 剩余步数奖励：与关卡目标分挂钩（BONUS_RATIO × scoreTarget / moves）
export const BONUS_RATIO = 0.8;
export const REMAINING_MOVE_BONUS = 200;    // 遗留常量：仅用于新关卡缺省回退

export function bonusPerStepFor(scoreTarget, moves) {
  if (!moves || !scoreTarget) return REMAINING_MOVE_BONUS;
  return Math.max(20, Math.round((BONUS_RATIO * scoreTarget) / moves));
}

// FR-07 星级阈值（结算总分 / scoreTarget）
export const STAR_THRESHOLDS = [1.0, 1.3, 1.6];

// ===== FR-09 经济：通关金币按星级发放，该关首次通关双倍 =====
export const COIN_BY_STARS = { 1: 10, 2: 20, 3: 40 };
export const FIRST_CLEAR_MULTIPLIER = 2;

/** 通关金币：1/2/3 星 → 10/20/40；该关首次通关 → 20/40/80 */
export function coinsForClear(stars, firstClear) {
  const s = Math.max(0, Math.min(3, Math.floor(Number(stars) || 0)));
  if (s <= 0) return 0;
  const base = COIN_BY_STARS[s] || 0;
  return firstClear ? base * FIRST_CLEAR_MULTIPLIER : base;
}

// ===== FR-09 道具：6 个，随对应关卡「通关」解锁；使用消耗金币；每局最多携带 3 个 =====
// kind：hint = 仅提示；shuffle = 立即重排；cell = 需选格后生效；instant = 立即生效
// effectiveness：有效度评分（0~10），用于「价格越高 / 解锁越晚」的排序依据；
// 评分口径见《变更说明_道具与金币经济_v2.md》第 4 节。
// 规则：price 与 effectiveness 同步递增；unlock 按 effectiveness 升序排布（第一章 3 个、第二章 3 个）。
export const ITEMS = [
  { id: 'hint', name: '提示', price: 30, effectiveness: 3, unlock: '1-1', kind: 'hint', desc: '高亮一个可用的交换，持续 3 秒' },
  { id: 'shuffle', name: '洗牌', price: 60, effectiveness: 4, unlock: '1-5', kind: 'shuffle', desc: '重新排列棋盘（不消耗步数）' },
  { id: 'hammer', name: '锤子', price: 90, effectiveness: 5, unlock: '1-10', kind: 'cell', desc: '消除任意一个方块（计入消除目标、不计分）' },
  { id: 'bomb', name: '炸弹', price: 130, effectiveness: 6, unlock: '2-1', kind: 'cell', desc: '消除所选方块周围 3×3 范围（不计分）' },
  { id: 'color', name: '同色', price: 180, effectiveness: 7, unlock: '2-5', kind: 'cell', desc: '消除棋盘上该颜色的全部方块（不计分）' },
  { id: 'steps', name: '加五步', price: 250, effectiveness: 9, unlock: '2-10', kind: 'instant', desc: '剩余步数 +5（直接影响过关判定）' },
];
export const LOADOUT_MAX = 3;

/** 价格与解锁顺序必须与有效度一致（领域层不变量，测试中会断言） */
export function itemsAreOrdered(items = ITEMS) {
  for (let i = 1; i < items.length; i++) {
    if (items[i].effectiveness < items[i - 1].effectiveness) return false;
    if (items[i].price < items[i - 1].price) return false;
  }
  return true;
}

export function itemById(id) {
  return ITEMS.find((it) => it.id === id) || null;
}

/** 道具是否已解锁：其对应关卡已通关（星级 ≥ 1） */
export function isItemUnlocked(item, stars) {
  if (!item) return false;
  return !!stars && Math.floor(Number(stars[item.unlock]) || 0) >= 1;
}

export function unlockedItems(stars) {
  return ITEMS.filter((it) => isItemUnlocked(it, stars));
}

/** 规范化携带列表：过滤未知/未解锁/重复，保留顺序并截断到上限 */
export function sanitizeLoadout(ids, stars) {
  const out = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    const it = itemById(id);
    if (!it || !isItemUnlocked(it, stars) || out.includes(it.id)) continue;
    out.push(it.id);
    if (out.length >= LOADOUT_MAX) break;
  }
  return out;
}

// FR-01 初始化约束
export const INITIALIZE_MAX_TRIES = 50;

// FR-11 存档
export const SAVE_KEY = 'stardust_save';
export const SAVE_VERSION = 2;              // v2：items 计数 → loadout 携带列表
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
