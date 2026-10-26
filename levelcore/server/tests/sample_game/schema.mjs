// Validator của game mẫu (test core): cùng hợp đồng validateLevel(level, {levelNo}) -> {isValid, errors, warnings}.
export function validateLevel(level, { levelNo } = {}) {
  const errors = [], warnings = [];
  if (!level || typeof level !== 'object') errors.push('level phải là object');
  else {
    if (!Number.isInteger(level.time) || level.time <= 0) errors.push('time phải > 0');
    if (!Array.isArray(level.items) || !level.items.length) errors.push('items trống');
    if (levelNo != null && level.level !== levelNo) warnings.push(`level=${level.level} khác số ${levelNo}`);
  }
  return { isValid: !errors.length, errors, warnings };
}

export function blankLevel(n) { return { level: n, time: 60, items: ['gem'] }; }
