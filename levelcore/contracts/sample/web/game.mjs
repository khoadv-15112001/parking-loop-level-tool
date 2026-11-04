// Module web của game mẫu: chỉ khai danh sách field, core tự dựng form ở tab Tổng quan.
import { blankLevel, validateLevel } from './rules.mjs';

export default {
  toolName: 'SampleLevel',
  subtitle: 'Game mẫu của level-tool-core',
  envPrefix: 'SAMPLELEVEL',
  storagePrefix: 'sample',
  versionPrefix: 'sample-',
  webgame: { id: 'sample-game', tag: 'SAMPLE', title: 'Sample — xem / chơi level', buildHint: 'Build bản WebGL của game mẫu thành zip' },

  validateLevel,
  blankLevel,

  fields: [
    { path: ['time'], label: 'Thời gian (giây)', type: 'number', min: 1 },
    { path: ['hint'], label: 'Gợi ý cho người chơi', type: 'text' },
    { path: ['hard'], label: 'Level khó', type: 'bool' },
    { path: ['theme'], label: 'Theme', type: 'select', options: [{ value: 'forest', label: 'Rừng' }, { value: 'desert', label: 'Sa mạc' }] },
  ],

  searchText: summary => `${summary.time ?? ''}s ${summary.items ?? 0} vật`,
  listItem: summary => ({ tags: `<span class="badge">${summary.items ?? 0} vật</span>`, sub: `${summary.time ?? '?'} giây` }),
};
