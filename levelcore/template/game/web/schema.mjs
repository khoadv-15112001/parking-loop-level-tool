// Luật level của __GAME__ — một nguồn cho app (chạy trực tiếp) và server (levelcore/runner/validate_runner.mjs qua node).
// Hợp đồng: validateLevel(level, {levelNo}) -> {isValid, errors: string[], warnings: string[]}.

export function validateLevel(level, { levelNo } = {}) {
  const errors = [], warnings = [];
  if (!level || typeof level !== 'object' || Array.isArray(level)) errors.push('Level phải là JSON object');
  // TODO: luật của game
  return { isValid: errors.length === 0, errors, warnings };
}

/** Level mới số n; template = level đang mở khi chọn "Sao chép" (null nếu không). */
export function blankLevel(n, template = null) {
  return template ? { ...JSON.parse(JSON.stringify(template)), level: n } : { level: n };
}
