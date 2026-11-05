// BI giả cho test hợp đồng: Level Hub (/level-hub/*) và Firebase accounts:lookup (/lookup), đủ để chạy luồng đăng nhập,
// kiểm tên, tạo bộ, đọc bộ. Hành vi chọn theo token: đoạn giữa của token BI (dạng JWT) là chế độ:
//   okokokokok   thành công · c401… / c403… / c409… / c413…  lỗi đó ở bước tạo bộ
//   lostlostlo   tạo bộ rồi cắt kết nối (không trả lời) · nonenoneno  cắt kết nối, không tạo gì
// Firebase: idToken có đoạn giữa okokokokok → a@sonat.vn đã xác minh; khác → 400.
// GET /__last trả lần tạo bộ gần nhất (tên, appId, zip base64) để test so nội dung gói.
import http from 'node:http';

export const biToken = mode => `eyJhbGciOiJub25lIn0.${mode.padEnd(10, mode[0])}.c2lnbmF0dXJlLXRlc3Q`;
const modeOf = req => String(req.headers.authorization || '').split('.')[1] || '';

function multipart(body, type) {
  const boundary = /boundary=(.+)$/.exec(type || '')?.[1];
  const out = { fields: {}, file: null };
  if (!boundary) return out;
  const sep = Buffer.from(`--${boundary}`);
  let start = body.indexOf(sep);
  while (start >= 0) {
    const next = body.indexOf(sep, start + sep.length);
    if (next < 0) break;
    const part = body.subarray(start + sep.length + 2, next - 2);
    const headEnd = part.indexOf('\r\n\r\n');
    const head = part.subarray(0, headEnd).toString('utf8');
    const data = part.subarray(headEnd + 4);
    const name = /name="([^"]+)"/.exec(head)?.[1];
    if (/filename="/.test(head)) out.file = data;
    else if (name) out.fields[name] = data.toString('utf8');
    start = next;
  }
  return out;
}

export function startFakeBi() {
  const groups = [];
  let last = null;
  const json = (res, status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };
  const ok = (res, data) => json(res, 200, { status: 'success', data });
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const url = new URL(req.url, 'http://bi');
      const p = url.pathname;
      const mode = modeOf(req);
      if (p === '/lookup') {
        const id = JSON.parse(body.toString('utf8') || '{}').idToken || '';
        if (id.split('.')[1] !== 'okokokokok') return json(res, 400, { error: { message: 'INVALID_ID_TOKEN' } });
        return json(res, 200, { users: [{ email: 'a@sonat.vn', emailVerified: true }] });
      }
      if (p === '/__last') return json(res, 200, last);
      if (!req.headers.authorization) return json(res, 401, { message: 'Unauthorized' });
      if (p === '/level-hub/parse-name' && req.method === 'POST') {
        const { name, appId } = JSON.parse(body.toString('utf8'));
        if (mode.startsWith('names') && groups.some(g => g.name === name && g.appId === appId)) return json(res, 409, { message: 'Name already exists' });
        if (mode.startsWith('denied')) return json(res, 403, { message: 'Read denied' });
        return ok(res, { valid: true });
      }
      if (p === '/level-hub/asset-groups' && req.method === 'POST') {
        const code = /^c(\d{3})/.exec(mode)?.[1];
        if (code) return json(res, Number(code), { message: `lỗi giả ${code}` });
        if (mode.startsWith('none')) return req.socket.destroy();
        const { fields, file } = multipart(body, req.headers['content-type']);
        const g = { id: `g${groups.length + 1}`, name: fields.name, appId: fields.appId, status: 'PROCESSING', createdAt: new Date().toISOString(), createdBy: { email: 'a@sonat.vn' } };
        groups.push(g);
        last = { ...fields, zip: file ? file.toString('base64') : null };
        if (mode.startsWith('lost')) return req.socket.destroy();
        return ok(res, g);
      }
      if (p === '/level-hub/asset-groups' && req.method === 'GET') {
        const search = url.searchParams.get('search') || '';
        const apps = url.searchParams.getAll('appIds');
        return ok(res, { items: groups.filter(g => (!search || g.name.includes(search)) && (!apps.length || apps.includes(g.appId))), hasMore: false });
      }
      const m = /^\/level-hub\/asset-groups\/([^/]+)$/.exec(p);
      if (m && req.method === 'GET') {
        const g = groups.find(x => x.id === m[1]);
        return g ? ok(res, g) : json(res, 404, { message: 'Not found' });
      }
      return json(res, 404, { message: 'Not found' });
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` })));
}
