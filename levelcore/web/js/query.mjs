// Tìm level: số (12), dải (10-20, 10–20), danh sách (2,5,9) và chữ tiếng Việt không dấu.
// Chép từ sand-jam-level-tool core/query.mjs.
export function fold(text) {
  return String(text ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
}

export function parseLevelQuery(input) {
  const numbers = new Set();
  const ranges = [];
  const terms = [];
  const text = fold(input).replace(/(\d)\s*[-–]\s*(\d)/g, '$1-$2');
  for (const raw of text.split(/[\s,;]+/)) {
    const token = raw.replace(/^#/, '');
    if (!token) continue;
    const range = /^(\d+)-(\d+)$/.exec(token);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      ranges.push([Math.min(a, b), Math.max(a, b)]);
    } else if (/^\d+$/.test(token)) {
      numbers.add(Number(token));
    } else {
      terms.push(token);
    }
  }
  return { numbers: [...numbers], ranges, terms, empty: !numbers.size && !ranges.length && !terms.length };
}

export function queryMatches(query, number, haystack) {
  const hay = fold(haystack);
  if (query.numbers.length || query.ranges.length) {
    if (Number.isInteger(number)) {
      if (!query.numbers.includes(number) && !query.ranges.some(([a, b]) => number >= a && number <= b)) return false;
    } else if (query.ranges.length || !query.numbers.some(n => new RegExp(`(^|\\D)0*${n}(\\D|$)`).test(hay))) {
      return false;
    }
  }
  return query.terms.every(term => hay.includes(term));
}
