// Web Worker (module) chạy solver để trang không đứng: postMessage({raw, maxStates}) → {progress} … {done: report}.
import { checkLevel } from './solver.mjs';

self.onmessage = e => {
  const { raw, maxStates } = e.data || {};
  try {
    const report = checkLevel(raw, { maxStates, onProgress: states => self.postMessage({ progress: states }) });
    self.postMessage({ done: report });
  } catch (err) {
    self.postMessage({ done: { verdict: 'Invalid', detail: String(err?.message || err) } });
  }
};
