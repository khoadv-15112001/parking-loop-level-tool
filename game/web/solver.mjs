// Giải level như người chơi bấm một xe rồi chờ vòng đứng yên: port ParkingLevelSolver.SolveSettled / ReplaySettled và
// ParkingLevelChecker.Check của bản Unity. Chạy được ở server, trình duyệt và Web Worker (solver_worker.mjs).
import { tryConvert, validateModel, whyImpossible } from './format.mjs';
import { ParkingModel } from './model.mjs';

export function settle(m, maxTicks = 0) {
  if (maxTicks <= 0) maxTicks = m.N * 4 + 32;
  for (let t = 0; t < maxTicks; t++) {
    if (m.state !== 'play' || m.isSettled()) return true;
    m.tick();
  }
  return m.state !== 'play' || m.isSettled();
}

/** Trả {solved, exhausted, states, moves: [id xe bãi]}. */
export function solveSettled(start, { maxStates = 200000, onProgress } = {}) {
  const res = { solved: false, exhausted: false, states: 0, moves: [] };
  const nodes = [{ parent: -1, move: 0 }];
  const seen = new Set();
  const root = start.clone();
  settle(root);
  root.events = [];
  seen.add(root.key());
  const stack = [[0, root]];
  while (stack.length) {
    const [id, m] = stack.pop();
    res.states++;
    if (onProgress && res.states % 2000 === 0) onProgress(res.states);
    if (m.state === 'won') { res.moves = path(nodes, id); res.solved = true; return res; }
    if (m.state !== 'play') continue;
    if (res.states >= maxStates) { res.exhausted = true; break; }
    const children = [];
    for (let i = 0; i < m.buses.length; i++) {
      if (m.buses[i].out) continue;
      const c = m.clone();
      const r = c.tap(i);
      if (r.r !== 'released') continue;
      let fits = false;
      for (let x = 0; x < c.W && !fits; x++) if (c.accepts(x, r.car)) fits = true;
      c.deliverAll(r);
      settle(c);
      c.events = [];
      const k = c.key();
      if (seen.has(k) && c.state !== 'won') continue;
      seen.add(k);
      children.push([c, i, fits]);
    }
    // Đẩy sau = thử trước: xe vào được làn ngay được thử trước.
    for (let pass = 0; pass < 2; pass++) {
      for (const [c, move, fits] of children) {
        if (fits === (pass === 0)) continue;
        nodes.push({ parent: id, move });
        stack.push([nodes.length - 1, c]);
      }
    }
  }
  return res;
}

export function replaySettled(lv, taps) {
  const m = new ParkingModel(lv);
  settle(m);
  for (const id of taps) {
    const r = m.tap(id);
    if (r.r !== 'released') return m;
    m.deliverAll(r);
    settle(m);
  }
  return m;
}

function path(nodes, id) {
  const moves = [];
  for (let n = id; nodes[n].parent >= 0; n = nodes[n].parent) moves.push(nodes[n].move);
  return moves.reverse();
}

/**
 * Kết luận cho một raw: verdict = Solvable | Impossible | Unsolvable | Unknown | Invalid, kèm taps (id xe bãi), tapOrder
 * ("cột:màu"), states, detail.
 */
export function checkLevel(raw, { maxStates = 200000, onProgress } = {}) {
  const { level: lv, notes, error } = tryConvert(raw);
  if (!lv) return { verdict: 'Invalid', detail: error, notes };
  const v = validateModel(lv);
  if (v.errors.length) return { verdict: 'Invalid', detail: v.errors.join('; '), notes };
  const why = whyImpossible(lv);
  if (why) return { verdict: 'Impossible', detail: why, notes };
  const res = solveSettled(new ParkingModel(lv), { maxStates, onProgress });
  if (res.solved) {
    const end = replaySettled(lv, res.moves);
    if (end.state !== 'won') return { verdict: 'Unknown', detail: 'lời giải không chạy lại được (báo dev)', states: res.states, notes };
    const m = new ParkingModel(lv);
    return {
      verdict: 'Solvable', taps: res.moves, states: res.states, notes,
      tapOrder: res.moves.map(i => `${m.buses[i].x + 1}:${m.buses[i].c}`).join(' '),
    };
  }
  if (res.exhausted) return { verdict: 'Unknown', detail: `chạm giới hạn ${maxStates} trạng thái`, states: res.states, notes };
  return { verdict: 'Unsolvable', detail: `không thứ tự bấm nào thắng (${res.states} trạng thái)`, states: res.states, notes };
}
