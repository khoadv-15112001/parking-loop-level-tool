// Luật của game mẫu khai bằng manifest — dùng chung cho test hợp đồng của cả hai server và cho web.
// Level: {"level": n, "time": giây, "items": ["rock", "gem", …], "hint"?: chuỗi, "hard"?: bool, "theme"?: chuỗi}.
// Chỉ validateLevel và blankLevel là bắt buộc; các hook còn lại core có mặc định.

export function validateLevel(level, { levelNo } = {}) {
  const errors = [], warnings = [];
  if (!level || typeof level !== 'object' || Array.isArray(level)) errors.push('level phải là object');
  else {
    if (!Number.isInteger(level.time) || level.time <= 0) errors.push('time phải > 0');
    if (!Array.isArray(level.items) || !level.items.length) errors.push('items trống');
    if (levelNo != null && level.level !== levelNo) warnings.push(`level=${level.level} khác số ${levelNo}`);
  }
  return { isValid: !errors.length, errors, warnings };
}

export function blankLevel(n, template = null) {
  return template ? { ...structuredClone(template), level: n } : { level: n, time: 60, items: ['gem'] };
}

export function levelSummary(level) {
  return { time: level.time ?? null, items: (level.items || []).length };
}

export function levelChanges(prev, cur) {
  if (!prev || !cur) return null;
  const out = prev.time !== cur.time ? [`time: ${prev.time} → ${cur.time}`] : [];
  if (JSON.stringify(prev.items) !== JSON.stringify(cur.items)) out.push('items');
  return out;
}

export function setLevelNumber(level, n) {
  return { ...level, level: n };
}

export function describeHub(level, n) {
  const items = level.items || [];
  return {
    mechanics: 'M01', difficulty: n % 3, uniqueColor: new Set(items).size, totalBlock: items.length,
    time: level.time || 0, obstacleCounts: { Rock: items.filter(x => x === 'rock').length },
  };
}
