// Luật level của __GAME__: server (Node hoặc Python) và trình duyệt cùng dùng file này, nên chỉ là JS thuần (không DOM,
// không import node:*). Hook bắt buộc và hook thêm khi cần: levelcore/contracts/README.md, mục "Game khai bằng manifest".
// Viết theo raw thật của game (game/tests/raw/), không chép từ game khác.

export function validateLevel(level, { levelNo, formatVersion } = {}) {
  const errors = [], warnings = [];
  if (!level || typeof level !== 'object' || Array.isArray(level)) errors.push('Level phải là JSON object');
  return { isValid: errors.length === 0, errors, warnings };
}

export function blankLevel(n, template = null) {
  return template ? structuredClone(template) : {};
}
