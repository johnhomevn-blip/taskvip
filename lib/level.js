/**
 * He thong level:
 * Level 1->2: 2000 EXP
 * Level n->n+1: exp_truoc * 1.1 + 1000
 * Tinh den level 50
 */

// Tinh EXP can de len level tiep theo
function expToNextLevel(level) {
  if (level >= 50) return Infinity;
  let exp = 2000;
  for (let i = 1; i < level; i++) {
    exp = Math.round(exp * 1.1 + 1000);
  }
  return exp;
}

// Tinh tong EXP can de dat duoc level do
function totalExpForLevel(level) {
  let total = 0;
  for (let i = 1; i < level; i++) {
    total += expToNextLevel(i);
  }
  return total;
}

// Lay thong tin level tu tong EXP
function getLevelInfo(totalExp) {
  let level = 1;
  let expUsed = 0;
  while (level < 50) {
    const needed = expToNextLevel(level);
    if (expUsed + needed > totalExp) break;
    expUsed += needed;
    level++;
  }
  const expInLevel = totalExp - expUsed;
  const expNeeded = level < 50 ? expToNextLevel(level) : 0;
  return { level, expInLevel, expNeeded, totalExp };
}

// Name tag theo level
function getLevelTag(level) {
  if (level >= 50) return { label: 'Legend', color: '#a855f7', bg: 'linear-gradient(135deg,#7c3aed,#ec4899)', emoji: '👑' };
  if (level >= 40) return { label: 'Diamond', color: '#60a5fa', bg: 'linear-gradient(135deg,#2563eb,#7c3aed)', emoji: '💎' };
  if (level >= 30) return { label: 'Platinum', color: '#fb923c', bg: 'linear-gradient(135deg,#ea580c,#dc2626)', emoji: '🔥' };
  if (level >= 20) return { label: 'Gold', color: '#fbbf24', bg: 'linear-gradient(135deg,#d97706,#f59e0b)', emoji: '⭐' };
  if (level >= 10) return { label: 'Silver', color: '#10b981', bg: 'linear-gradient(135deg,#059669,#0d9488)', emoji: '🌿' };
  return { label: 'Rookie', color: '#60a5fa', bg: 'linear-gradient(135deg,#2563eb,#0ea5e9)', emoji: '🔵' };
}

// Tinh level tu exp (backward compat)
function calcLevel(exp) {
  return getLevelInfo(exp).level;
}

module.exports = { expToNextLevel, totalExpForLevel, getLevelInfo, getLevelTag, calcLevel };
