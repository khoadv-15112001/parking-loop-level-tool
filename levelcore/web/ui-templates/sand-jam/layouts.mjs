const slot = (name, className, tag = 'div', label = '') =>
  `<${tag} data-sj-slot="${name}" class="${className}"${label ? ` aria-label="${label}"` : ''}></${tag}>`;

const layouts = {
  login: `
    <section class="sj-login-card" aria-label="Đăng nhập">
      ${slot('brand', 'sj-login-brand', 'header')}
      ${slot('credentials', 'sj-login-credentials')}
      ${slot('help', 'sj-login-help')}
    </section>`,

  workspace: `
    <header class="sj-workspace-header">
      ${slot('brand', 'sj-workspace-brand')}
      ${slot('nav', 'sj-workspace-nav', 'nav', 'Màn')}
      ${slot('headerTools', 'sj-workspace-tools')}
    </header>
    ${slot('notice', 'sj-workspace-notice')}
    <div class="sj-workspace-body">
      ${slot('main', 'sj-workspace-main', 'main')}
      ${slot('playtest', 'sj-workspace-playtest', 'aside', 'Chơi thử')}
    </div>
    ${slot('status', 'sj-workspace-status', 'footer')}`,

  library: `
    ${slot('toolbar', 'sj-layout-toolbar', 'header')}
    <div class="sj-library-body">
      ${slot('filters', 'sj-library-filters', 'aside', 'Bộ lọc')}
      <section class="sj-library-main" aria-label="Kho level">
        ${slot('selection', 'sj-layout-selection')}
        ${slot('results', 'sj-layout-scroll')}
      </section>
      ${slot('detail', 'sj-library-detail', 'aside', 'Chi tiết level')}
    </div>`,

  collections: `
    ${slot('toolbar', 'sj-layout-toolbar', 'header')}
    ${slot('groups', 'sj-layout-scroll sj-collection-groups')}`,

  sequence: `
    ${slot('toolbar', 'sj-layout-toolbar', 'header')}
    ${slot('navigator', 'sj-sequence-navigator')}
    ${slot('selection', 'sj-layout-selection')}
    <div class="sj-sequence-body">
      ${slot('table', 'sj-sequence-table sj-layout-scroll', 'section', 'Thứ tự level')}
      <aside class="sj-sequence-detail" aria-label="Phân tích bộ">
        ${slot('selected', 'sj-sequence-selected')}
        ${slot('tabs', 'sj-layout-tabs')}
        ${slot('analysis', 'sj-layout-scroll sj-sequence-analysis')}
      </aside>
    </div>`,

  editor: `
    ${slot('toolbar', 'sj-layout-toolbar', 'header')}
    <div class="sj-editor-body">
      ${slot('levels', 'sj-editor-levels sj-layout-scroll', 'aside', 'Danh sách level')}
      <section class="sj-editor-board" aria-label="Lưới sửa level">
        ${slot('stageToolbar', 'sj-editor-stage-toolbar')}
        <div class="sj-editor-canvas">
          ${slot('tools', 'sj-editor-tools')}
          ${slot('stage', 'sj-editor-stage')}
        </div>
        ${slot('metrics', 'sj-editor-metrics')}
      </section>
      <aside class="sj-editor-inspector" aria-label="Thông tin level">
        ${slot('inspectorTabs', 'sj-layout-tabs')}
        ${slot('inspector', 'sj-layout-scroll sj-editor-inspector-content')}
      </aside>
      ${slot('playtest', 'sj-editor-playtest', 'aside', 'Chơi thử')}
    </div>
    ${slot('shortcuts', 'sj-editor-shortcuts', 'footer')}`,

  overview: `
    ${slot('toolbar', 'sj-layout-toolbar', 'header')}
    <div class="sj-layout-scroll sj-overview-body">
      ${slot('metrics', 'sj-overview-metrics')}
      ${slot('chart', 'sj-overview-chart')}
      ${slot('reports', 'sj-overview-reports')}
    </div>`,

  activity: `
    ${slot('toolbar', 'sj-layout-toolbar', 'header')}
    <div class="sj-layout-scroll sj-activity-body">
      ${slot('services', 'sj-activity-services')}
      ${slot('filters', 'sj-activity-filters')}
      ${slot('log', 'sj-activity-log')}
    </div>`,

  playtest: `
    ${slot('toolbar', 'sj-layout-toolbar', 'header')}
    ${slot('stage', 'sj-playtest-stage')}
    ${slot('controls', 'sj-playtest-controls')}
    ${slot('build', 'sj-playtest-build', 'footer')}`,

  admin: `
    ${slot('toolbar', 'sj-layout-toolbar', 'header')}
    <div class="sj-layout-scroll sj-settings-body">
      ${slot('notice', 'sj-settings-notice')}
      ${slot('sections', 'sj-settings-sections')}
    </div>`,

  trash: `
    ${slot('toolbar', 'sj-layout-toolbar', 'header')}
    <div class="sj-layout-scroll sj-settings-body">
      ${slot('levels', 'sj-settings-sections', 'section', 'Level đã xoá')}
      ${slot('collections', 'sj-settings-sections', 'section', 'Bộ đã lưu trữ')}
    </div>`,

  phone: `
    ${slot('stage', 'sj-playtest-stage')}
    ${slot('controls', 'sj-playtest-controls')}
    ${slot('status', 'sj-playtest-build', 'footer')}`,
};

export function createSandJamLayout(kind, owner = document) {
  if (!Object.hasOwn(layouts, kind)) throw new RangeError(`Bố cục Sand Jam không tồn tại: ${kind}`);

  const root = owner.createElement('div');
  root.className = 'sj-layout';
  root.dataset.sjLayout = kind;
  root.innerHTML = layouts[kind];
  const slots = Object.fromEntries([...root.querySelectorAll('[data-sj-slot]')].map(el => [el.dataset.sjSlot, el]));
  return { root, slots };
}
