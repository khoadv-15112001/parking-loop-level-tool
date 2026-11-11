const modalSizes = {
  form: 'normal', confirm: 'compact', conflict: 'wide', table: 'wide',
  compare: 'wide', progress: 'normal', tabs: 'normal', share: 'normal', drawer: 'normal',
};

const anchoredKinds = new Set(['menu', 'popover', 'radial']);
let nextTitle = 0;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function placeNear(popup, anchor, radial) {
  const { width, height } = popup.getBoundingClientRect();
  const bounds = anchor?.getBoundingClientRect();
  const preferredX = !bounds ? (innerWidth - width) / 2 : radial ? bounds.left + (bounds.width - width) / 2 : bounds.left;
  let preferredY = (innerHeight - height) / 2;
  if (bounds && radial) preferredY = bounds.top + (bounds.height - height) / 2;
  else if (bounds) {
    const below = innerHeight - bounds.bottom - 8;
    const above = bounds.top - 8;
    preferredY = below >= height || below >= above ? bounds.bottom + 4 : bounds.top - height - 4;
  }
  popup.style.left = `${Math.max(8, Math.min(preferredX, innerWidth - width - 8))}px`;
  popup.style.top = `${Math.max(8, Math.min(preferredY, innerHeight - height - 8))}px`;
}

function appendActions(popup, host, actions, kind, close, error) {
  const controls = [];
  let running = false;
  for (const [index, action] of actions.entries()) {
    const base = kind === 'radial' ? 'sj-radial-item' : kind === 'menu' ? 'sj-popover-item' : '';
    const className = [base, action.primary && 'primary', action.danger && 'danger'].filter(Boolean).join(' ');
    const button = element('button', className, action.label);
    button.type = 'button';
    if (action.icon) button.prepend(typeof action.icon === 'function' ? action.icon() : action.icon);
    if (kind === 'radial') button.style.setProperty('--sj-angle', `${index * 360 / actions.length}deg`);
    if (action.hint) button.append(element('kbd', 'sj-popover-hint', action.hint));
    if (action.selected !== undefined) button.setAttribute('aria-pressed', String(action.selected));
    const isDisabled = () => typeof action.disabled === 'function' ? action.disabled(popup) : Boolean(action.disabled);
    button.disabled = isDisabled();
    controls.push({ button, isDisabled });
    button.onclick = async () => {
      if (running) return;
      if (!action.onClick) return close(action.value ?? null);
      running = true;
      for (const control of controls) control.button.disabled = true;
      error.hidden = true;
      try {
        const result = await action.onClick(popup);
        if (result !== false) close(result ?? action.value ?? true);
      } catch (failure) {
        error.textContent = failure?.message || String(failure);
        error.hidden = false;
      } finally {
        running = false;
        for (const control of controls) control.button.disabled = control.isDisabled();
      }
    };
    host.append(button);
  }
}

export async function openSandJamPopup(kind, { title, content, actions, anchor, size } = {}) {
  const anchored = anchoredKinds.has(kind);
  if (!anchored && !Object.hasOwn(modalSizes, kind)) throw new TypeError(`Kiểu popup không có: ${kind}`);
  const radial = kind === 'radial';
  const drawer = kind === 'drawer';
  const popup = anchored
    ? element('div', `sj-popover ${kind === 'popover' ? 'sj-popover-form' : ''}`)
    : element('dialog', `dialog sj-popup${drawer ? ' sj-drawer' : ''}`);
  popup.dataset.kind = kind;
  popup.dataset.size = size ?? modalSizes[kind] ?? 'normal';
  if (anchored) {
    popup.popover = 'auto';
    popup.setAttribute('role', 'dialog');
  }
  const headingClass = radial ? 'sj-radial-title' : anchored ? 'sj-popover-heading' : drawer ? 'sj-drawer-head' : 'sj-popup-title';
  const heading = element('h3', headingClass, title || 'Thao tác');
  heading.id = `sj-popup-title-${++nextTitle}`;
  popup.setAttribute('aria-labelledby', heading.id);
  const body = element('div', drawer ? 'sj-drawer-body' : 'sj-popup-content');
  const payload = typeof content === 'function' ? content() : content;
  if (payload != null) body.append(...(Array.isArray(payload) ? payload : [payload]));
  const foot = radial ? element('div', 'sj-radial-menu') : element('div', kind === 'menu' ? 'sj-popover-menu' : drawer ? 'sj-drawer-foot' : 'sj-popup-actions');
  const error = element('p', 'sj-popup-error');
  error.setAttribute('role', 'alert');
  error.hidden = true;
  if (!radial) {
    popup.append(heading);
    if (!anchored || payload != null) popup.append(body);
    popup.append(error);
  }
  return new Promise((resolve, reject) => {
    let result = null;
    const watchers = new AbortController();
    const close = value => {
      if (anchored ? !popup.matches(':popover-open') : !popup.open) return;
      result = value;
      if (anchored) popup.hidePopover();
      else popup.close();
    };
    const finish = () => {
      watchers.abort();
      popup.remove();
      resolve(result);
    };
    appendActions(popup, foot, actions ?? (anchored ? [] : [{ label: 'Đóng' }]), kind, close, error);
    if (radial) {
      const cancel = element('button', 'sj-radial-center', '×');
      cancel.type = 'button';
      cancel.setAttribute('aria-label', 'Đóng');
      cancel.onclick = () => close(null);
      foot.append(cancel, heading);
      popup.append(foot, error);
    } else if (foot.children.length) popup.append(foot);
    if (anchored && !popup.querySelector('[autofocus]')) {
      popup.querySelector('button:enabled, input:enabled:not([type="hidden"]), select:enabled, textarea:enabled, a[href]')?.setAttribute('autofocus', '');
    }
    document.body.append(popup);
    try {
      if (anchored) {
        popup.addEventListener('toggle', event => { if (event.newState === 'closed') finish(); });
        popup.showPopover({ source: anchor });
        const position = () => {
          if (anchor && !anchor.isConnected) return close(null);
          placeNear(popup, anchor, radial);
        };
        position();
        window.addEventListener('resize', position, { signal: watchers.signal });
        window.addEventListener('scroll', position, { capture: true, signal: watchers.signal });
      } else {
        popup.addEventListener('close', finish, { once: true });
        popup.addEventListener('click', event => {
          if (event.target !== popup) return;
          const rect = popup.getBoundingClientRect();
          if (event.clientX < rect.left || event.clientX >= rect.right || event.clientY < rect.top || event.clientY >= rect.bottom) close(null);
        });
        popup.showModal();
      }
    } catch (failure) {
      watchers.abort();
      popup.remove();
      reject(failure);
    }
  });
}
