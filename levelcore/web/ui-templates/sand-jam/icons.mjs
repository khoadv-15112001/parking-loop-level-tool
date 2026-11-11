const PATHS = {
  select: ['M5 3l13 8.5-5.6 1.4L9.6 19z', 'M12.6 13l4.4 6'],
  block: ['M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z', 'M4 9h16'],
  recolor: ['M12 3.5c3.2 4.2 6 7.3 6 10.8a6 6 0 0 1-12 0c0-3.5 2.8-6.6 6-10.8z', 'M9.5 15a2.5 2.5 0 0 0 2.5 2.5'],
  effect: ['M12 2.5v19', 'M3.8 7.2l16.4 9.6', 'M3.8 16.8l16.4-9.6', 'M9.5 4l2.5 2.5L14.5 4', 'M9.5 20l2.5-2.5 2.5 2.5'],
  gate: ['M3 3.5h5v17H3z', 'M11 12h10', 'M17 8l4 4-4 4'],
  inner: ['M4 4h16v16H4z', 'M4 12h16', 'M12 4v16'],
  border: ['M3 4h18v16H3z', 'M3 9.3h18', 'M3 14.7h18', 'M9 4v5.3', 'M15 9.3v5.4', 'M9 14.7V20'],
  empty: ['M4 4h3', 'M10.5 4h3', 'M17 4h3v3', 'M20 10.5v3', 'M20 17v3h-3', 'M13.5 20h-3', 'M7 20H4v-3', 'M4 13.5v-3', 'M4 7V4'],
  obstacle: ['M4.5 17.5l2.2-7.4 5-4.6 6 2.4 2 8.6-3.6 3H7.5z', 'M11.7 5.5l-1 5.5 4.5 2'],
  ext: ['M3 3.5h4v17H3z', 'M10 12h11', 'M14 8.5L10.5 12l3.5 3.5', 'M17.5 8.5L21 12l-3.5 3.5'],
  generator: ['M12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z', 'M12 2.5v3', 'M12 18.5v3', 'M2.5 12h3', 'M18.5 12h3', 'M5.3 5.3l2.1 2.1', 'M16.6 16.6l2.1 2.1', 'M5.3 18.7l2.1-2.1', 'M16.6 7.4l2.1-2.1'],
  interact: ['M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z', 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z'],
  erase: ['M15.2 4.3l4.5 4.5-9.4 9.4H5.8l-2.3-2.3z', 'M9.2 9.8l4.6 4.6', 'M10 20.5h10'],
  lift: ['M4 4h3', 'M10.5 4h3', 'M17 4h3v3', 'M20 17v3h-3', 'M13.5 20h-3', 'M7 20H4v-3', 'M4 13.5v-3', 'M20 13.5v-3', 'M12 16.5v-9', 'M8.8 10.5L12 7.3l3.2 3.2'],
  grid: ['M4 4h16v16H4z', 'M4 9.3h16', 'M4 14.7h16', 'M9.3 4v16', 'M14.7 4v16'],
  layer: ['M9 9h11v11H9z', 'M5 15H4V4h11v1'],
  addLayer: ['M9 9h11v11H9z', 'M5 15H4V4h11v1', 'M14.5 12v5', 'M12 14.5h5'],
  list: ['M3.5 4.5h17v15h-17z', 'M9 4.5v15', 'M5.5 8h1.5', 'M5.5 11.5h1.5', 'M5.5 15h1.5'],
  filter: ['M3 4.5h18l-7 8v6l-4 2v-8z'],
  search: ['M10.5 3.5a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'M15.5 15.5l5 5'],
  layout: ['M3.5 4.5h17v15h-17z', 'M3.5 9h17', 'M9.5 9v10.5'],
  pipette: ['M14.5 4.5l5 5', 'M16.4 2.6a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8l-2.6 2.6-5-5z', 'M13.8 7.2L5 16v3h3l8.8-8.8'],
  plus: ['M12 5v14', 'M5 12h14'],
  rotate: ['M19.5 12a7.5 7.5 0 1 1-2.2-5.3', 'M19.5 4v4.5H15'],
  play: ['M7 4.5v15l12-7.5z'],
};

const SVG_NS = 'http://www.w3.org/2000/svg';
const ATLAS_COLS = 8;
const ATLAS_ROWS = 5;
const ATLAS_URL = new URL('./assets/obstacles.webp', import.meta.url);

export const sandJamObstacleNames = Object.freeze([
  'FixedDirection', 'Layered', 'Ice', 'Combines', 'Blocked', 'Bomb',
  'Shutter', 'Dual', 'Chain', 'KeyChain', 'KeyColor', 'Ropes',
  'Scissor', 'Tnt', 'Hidden', 'TimeCapsule', 'ContainerBox', 'ContainerMoveBox',
  'SwitchLayer', 'BreakableLink', 'ContainerColorBox', 'Valve', 'IceGate', 'LockedColor',
  'MovingLock', 'ChainGate', 'ColorObstacle', 'MoveableColorObstacle', 'Grinder', 'Generator',
  'Lift', 'ChainLockBlank', 'ClockBlank', 'Padlock',
]);

export function sandJamIcon(name, size = 18) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('sj-icon');
  for (const d of Object.hasOwn(PATHS, name) ? PATHS[name] : PATHS.select) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

export function sandJamObstacleIcon(name, size = 16, fallback = '•') {
  const index = sandJamObstacleNames.indexOf(name);
  const el = document.createElement('span');
  el.className = 'sj-obstacle-icon';
  el.setAttribute('aria-hidden', 'true');
  if (index < 0) {
    el.textContent = fallback;
    return el;
  }
  Object.assign(el.style, {
    width: `${size}px`, height: `${size}px`,
    backgroundImage: `url("${ATLAS_URL.href}")`,
    backgroundSize: `${ATLAS_COLS * size}px ${ATLAS_ROWS * size}px`,
    backgroundPosition: `${-(index % ATLAS_COLS) * size}px ${-Math.floor(index / ATLAS_COLS) * size}px`,
  });
  return el;
}
