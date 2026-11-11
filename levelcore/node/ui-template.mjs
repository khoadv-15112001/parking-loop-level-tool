import fs from 'node:fs';
import path from 'node:path';

export function resolveUiTemplate(coreWebDir, id) {
  if (id === undefined) return null;
  if (typeof id !== 'string' || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id)) {
    throw new Error('uiTemplate phải là tên mẫu chữ thường, ví dụ "sand-jam"');
  }
  const file = path.resolve(coreWebDir, 'ui-templates', id, 'template.css');
  if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`uiTemplate "${id}" không có trong kho levelcore/web/ui-templates`);
  }
  return file;
}
