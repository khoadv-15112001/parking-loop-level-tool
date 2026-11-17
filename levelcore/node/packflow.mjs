// Luồng làm việc với bộ (server Node): chuyển trạng thái Nháp → Chờ duyệt → Live → Lưu trữ, duyệt bản nháp vào bộ Live
// gốc, bàn giao, nhân bản, version (mỗi lần đẩy BI hoặc chốt tay), so sánh hai bộ / hai version, khôi phục bộ về một
// version, nơi khác đang dùng cùng level và áp bản mới sang đó.
import { ApiError } from './http.mjs';
import { checkEmail, checkNote, checkPurpose, contentKey, statusOf, STATUSES } from './packmeta.mjs';
import { iso, now, PACK_RE } from './store.mjs';

const KEY_CACHE_MAX = 50000;
const MAX_APPLY_TARGETS = 200;
const EDIT_KINDS = new Set(['update', 'revert', 'relevel']);
const jsonOrNull = text => (text ? JSON.parse(text) : null);

export class PackFlow {
  constructor(store, admin) {
    this.store = store;
    this.db = store.db;
    this.admin = admin;
    this.keys = new Map();
  }

  keyOf(sha) {
    if (!sha) return null;
    let k = this.keys.get(sha);
    if (k === undefined) {
      const obj = this.store.bodyOrNull(sha);
      k = obj ? contentKey(this.store.game, obj) : sha;
      if (this.keys.size >= KEY_CACHE_MAX) this.keys.clear();
      this.keys.set(sha, k);
    }
    return k;
  }

  heads(pack) {
    return this.db.all(`SELECT l.name, l.sort_key level, l.head_rev rev, r.blob_sha sha FROM levels l
      JOIN revisions r ON r.level_id=l.id AND r.rev=l.head_rev WHERE l.pack=? AND l.deleted=0 ORDER BY l.sort_key`, pack);
  }

  lockedBy(pack, names, user) {
    const wanted = new Set(names);
    return this.db.all('SELECT name, holder FROM locks WHERE pack=? AND expires_at>?', pack, now())
      .filter(l => wanted.has(l.name) && l.holder !== user).map(l => ({ level: l.name, holder: l.holder }));
  }

  publishPack(pack, extra = {}) {
    this.store.broker.publish('pack.updated', { ...this.store.packOut(this.store.pack(pack)), ...extra });
  }

  // ---------- trạng thái ----------
  setStatus(user, pack, to, { note = '' } = {}) {
    if (!STATUSES.includes(to)) throw new ApiError(400, `Trạng thái phải là ${STATUSES.join(' | ')}`);
    const text = checkNote(note, { max: 500 });
    const cur = this.store.pack(pack);
    const from = statusOf(cur);
    if (from === to) return { pack: this.store.packOut(cur), from, to, unchanged: true };
    if (to === 'live') {
      this.admin.require(user, 'production');
      if (from === 'archived') this.admin.require(user, 'archive');
      const base = cur.base ? this.db.get('SELECT * FROM packs WHERE code=?', cur.base) : null;
      if (base && base.name !== pack) return this.applyDraft(user, cur, base, text);
      this.requireValid(pack);
    }
    if (to === 'review') {
      if (from !== 'draft') throw new ApiError(409, 'Chỉ gửi duyệt được bộ đang Nháp');
      checkNote(note, { required: true, what: 'Nội dung thay đổi' });
    }
    if (to === 'draft') {
      if (from === 'live') this.admin.require(user, 'production');
      if (from === 'archived') this.admin.require(user, 'archive');
      if (from === 'review' && user !== cur.review_by) this.admin.require(user, 'production');
    }
    if (to === 'archived') {
      this.admin.require(user, 'archive');
      checkNote(note, { required: true, what: 'Lý do lưu trữ' });
    }
    this.db.write(() => {
      const t = now();
      if (to === 'review') {
        this.db.run('UPDATE packs SET review_by=?, review_at=?, review_note=? WHERE name=?', user, t, text, pack);
      } else {
        this.store.clearReview(pack);
        if (to === 'archived') {
          this.db.run('UPDATE packs SET archived=1, archived_at=?, archive_reason=? WHERE name=?', t, text, pack);
          this.db.run('DELETE FROM locks WHERE pack=?', pack);
        } else {
          this.db.run('UPDATE packs SET archived=0, archived_at=NULL, archive_reason=NULL, production=? WHERE name=?', to === 'live' ? 1 : 0, pack);
          if (to === 'live') this.db.run('UPDATE packs SET approved_by=?, approved_at=? WHERE name=?', user, t, pack);
        }
      }
      this.store.audit(user, 'pack.status', pack, null, null, { from, to, ...(text ? { note: text } : {}) });
    });
    this.publishPack(pack, { author: user });
    return { pack: this.store.packOut(this.store.pack(pack)), from, to };
  }

  requireValid(pack) {
    const bad = this.store.validatePack(pack).filter(v => !v.isValid);
    if (bad.length) {
      throw new ApiError(422, `${bad.length} level của bộ ${pack} chưa qua kiểm định — sửa trước khi duyệt`, {
        validation: bad.slice(0, 50).map(v => ({ level: v.name, errors: (v.errors || []).slice(0, 5) })),
      });
    }
  }

  /** Duyệt bản nháp có bộ gốc Live: nội dung bản nháp thay nội dung bộ gốc (một version mới), bản nháp vào lưu trữ. */
  applyDraft(user, draft, base, note) {
    if (statusOf(base) !== 'live') {
      throw new ApiError(409, `Bộ gốc ${base.name} (${base.code}) không còn Live — đặt bộ gốc Live trước khi duyệt`);
    }
    this.requireValid(draft.name);
    const src = this.heads(draft.name);
    const out = this.db.write(() => {
      const baseHeads = new Map(this.heads(base.name).map(h => [h.name, h]));
      const keep = new Set(src.map(h => h.name));
      const touched = [...src.filter(h => baseHeads.get(h.name)?.sha !== h.sha).map(h => h.name), ...[...baseHeads.keys()].filter(n => !keep.has(n))];
      const locked = this.lockedBy(base.name, touched, user);
      if (locked.length) throw new ApiError(423, `${locked.length} level của bộ ${base.name} đang có người sửa — chưa duyệt được`, { locked });
      const message = `duyệt ${draft.code} (${draft.name})`;
      for (const h of src) {
        if (baseHeads.get(h.name)?.sha === h.sha) continue;
        const meta = { from_pack: draft.name, from_level: h.name, from_rev: h.rev };
        const r = this.store.writeRev(base.name, h.name, this.store.blob(h.sha), user, 'promote', { message, meta, diff: true });
        this.store.audit(user, 'level.promote', base.name, h.name, r.rev, meta);
      }
      for (const name of baseHeads.keys()) {
        if (keep.has(name)) continue;
        const r = this.store.writeRev(base.name, name, null, user, 'delete', { message, meta: { from_pack: draft.name } });
        this.store.audit(user, 'level.delete', base.name, name, r.rev, { from_pack: draft.name });
      }
      const t = now();
      this.db.run('UPDATE packs SET approved_by=?, approved_at=? WHERE name=?', user, t, base.name);
      const version = this.record(user, base.name, 'apply', {
        note: note || draft.review_note || '', author: draft.review_by || user, reviewer: user,
        detail: { from: { code: draft.code, name: draft.name } },
      });
      this.store.clearReview(draft.name);
      this.db.run('UPDATE packs SET archived=1, archived_at=?, archive_reason=? WHERE name=?', t, `Đã duyệt vào ${base.name} v${version.no}`, draft.name);
      this.db.run('DELETE FROM locks WHERE pack=?', draft.name);
      this.store.audit(user, 'pack.status', draft.name, null, null, { from: statusOf(draft), to: 'archived', applied_to: base.name, version: version.no });
      return { touched, version };
    });
    this.store.broker.publish('pack.imported', { pack: base.name, author: user, changed: out.touched });
    this.publishPack(base.name, { author: user });
    this.publishPack(draft.name, { author: user });
    return {
      pack: this.store.packOut(this.store.pack(draft.name)), from: statusOf(draft), to: 'archived',
      applied_to: { name: base.name, code: base.code }, version: out.version, changed: out.touched.length,
    };
  }

  // ---------- bàn giao, nhân bản ----------
  handover(user, pack, { to, note = '' } = {}) {
    const email = checkEmail(to, 'Người nhận');
    const text = checkNote(note, { max: 1000 });
    const p = this.store.pack(pack);
    if (p.owner && p.owner !== user && !this.admin.can(user, 'production')) {
      throw new ApiError(403, `Chỉ ${p.owner} (người phụ trách) hoặc admin bàn giao được bộ này`);
    }
    if (email === p.owner) throw new ApiError(400, `${email} đang phụ trách bộ này`);
    this.db.write(() => {
      this.db.run('UPDATE packs SET owner=? WHERE name=?', email, pack);
      this.store.audit(user, 'pack.handover', pack, null, null, { from: p.owner ?? null, to: email, ...(text ? { note: text } : {}) });
    });
    this.publishPack(pack, { author: user });
    return this.store.packOut(this.store.pack(pack));
  }

  handovers(pack) {
    this.store.pack(pack);
    return this.store.listAudit({ pack, action: 'pack.handover', limit: 100 })
      .map(a => ({ at: a.ts, by: a.user, from: a.detail?.from ?? null, to: a.detail?.to ?? null, note: a.detail?.note ?? '' }));
  }

  clone(user, pack, { name, purpose = null, description = null } = {}) {
    if (typeof name !== 'string' || !PACK_RE.test(name)) throw new ApiError(400, 'Tên bộ chỉ gồm chữ/số/_ . - (tối đa 64)');
    const src = this.store.pack(pack);
    const pur = purpose != null ? checkPurpose(this.store.game.manifest, purpose) : src.purpose || '';
    if (description != null && typeof description !== 'string') throw new ApiError(400, 'description phải là chuỗi');
    const base = statusOf(src) === 'live' ? src.code : null;
    const heads = this.heads(pack);
    const code = this.db.write(() => {
      if (this.db.get('SELECT 1 x FROM packs WHERE name=?', name)) throw new ApiError(409, `Bộ '${name}' đã có`);
      const newCode = this.store.nextCode();
      this.db.run(`INSERT INTO packs(name,description,created_at,created_by,platform,grp,code,purpose,owner,base,notes)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`, name, description ?? src.description ?? '', now(), user, src.platform || 'android', src.grp || '',
      newCode, pur, user, base, src.notes);
      for (const h of heads) {
        this.store.writeRev(name, h.name, this.store.blob(h.sha), user, 'copy', {
          message: `nhân bản từ ${src.name}`, meta: { from_pack: src.name, from_level: h.name, from_rev: h.rev },
        });
      }
      this.store.audit(user, 'pack.clone', name, null, null, { from: src.name, from_code: src.code, code: newCode, levels: heads.length, ...(base ? { base } : {}) });
      return newCode;
    });
    this.store.broker.publish('pack.created', { pack: name, author: user });
    return { ...this.store.packOut(this.store.pack(name), heads.length), code };
  }

  // ---------- version ----------
  /** Ghi một version (gọi trong transaction). items mặc định là các level hiện có của bộ. */
  record(user, pack, kind, { note = '', author = user, reviewer = null, items = null, fromLv = null, toLv = null, detail = null } = {}) {
    let p = this.store.pack(pack);
    if (!p.code) {
      this.db.run('UPDATE packs SET code=? WHERE name=?', this.store.nextCode(), pack);
      p = this.store.pack(pack);
    }
    const list = items ?? this.heads(pack).map(h => ({ level: h.level, name: h.name, rev: h.rev, sha: h.sha }));
    const no = (this.db.get('SELECT MAX(no) n FROM pack_versions WHERE code=?', p.code)?.n ?? 0) + 1;
    const res = this.db.run(`INSERT INTO pack_versions(code,no,pack,kind,note,author,reviewer,created_at,from_lv,to_lv,levels,detail)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, p.code, no, pack, kind, note || '', author, reviewer, now(), fromLv, toLv, list.length,
    detail && Object.keys(detail).length ? JSON.stringify(detail) : null);
    const id = Number(res.lastInsertRowid);
    for (const it of list) this.db.run('INSERT INTO pack_version_levels(version_id,level,name,rev,sha) VALUES(?,?,?,?,?)', id, it.level, it.name, it.rev, it.sha);
    this.store.audit(user, 'pack.version', pack, null, null, { code: p.code, no, kind, levels: list.length, ...(note ? { note } : {}) });
    return { no, kind, code: p.code, levels: list.length };
  }

  /** Version của một lần đẩy BI: đúng các revision đã gửi, người duyệt là người duyệt Live gần nhất. */
  recordPush(user, pack, summary, req, { note = '', bi = {} } = {}) {
    const p = this.store.pack(pack);
    const items = summary.manifest.map(m => ({ level: m.level, name: String(m.level), rev: m.rev, sha: m.sha }));
    const deploy = jsonOrNull(p.deploy) || {};
    return this.record(user, pack, 'push', {
      note: checkNote(note, { max: 500 }), reviewer: p.approved_by ?? null, items, fromLv: req.fromLv, toLv: req.toLv,
      detail: { bi, os: req.os, geo: req.geo, why: req.why, hub_version: req.version, ...(Object.keys(deploy).length ? { deploy } : {}) },
    });
  }

  snapshot(user, pack, { note = '' } = {}) {
    const text = checkNote(note, { required: true, what: 'Ghi chú version' });
    this.store.pack(pack);
    const v = this.db.write(() => this.record(user, pack, 'snapshot', { note: text, reviewer: this.store.pack(pack).approved_by ?? null }));
    this.publishPack(pack, { author: user, version: v });
    return v;
  }

  versionOut(v) {
    return {
      no: v.no, kind: v.kind, note: v.note, author: v.author, reviewer: v.reviewer, created_at: iso(v.created_at), pack: v.pack,
      from_lv: v.from_lv, to_lv: v.to_lv, levels: v.levels, detail: jsonOrNull(v.detail) || {},
    };
  }

  versionRow(pack, no) {
    const p = this.store.pack(pack);
    const v = p.code && this.db.get('SELECT * FROM pack_versions WHERE code=? AND no=?', p.code, Number(no));
    if (!v) throw new ApiError(404, `Bộ ${pack} không có version v${no}`);
    return { p, v };
  }

  versionLevels(id) {
    return this.db.all('SELECT level, name, rev, sha FROM pack_version_levels WHERE version_id=? ORDER BY level', id);
  }

  listVersions(pack) {
    const p = this.store.pack(pack);
    if (!p.code) return [];
    return this.db.all('SELECT * FROM pack_versions WHERE code=? ORDER BY no DESC', p.code).map(v => this.versionOut(v));
  }

  getVersion(pack, no) {
    const { v } = this.versionRow(pack, no);
    return { ...this.versionOut(v), items: this.versionLevels(v.id) };
  }

  /** Đưa bộ về đúng nội dung của version `no` (chỉ trong dải của version đó nếu là lần đẩy một dải). */
  restore(user, pack, no, { note = '' } = {}) {
    const text = checkNote(note, { max: 500 });
    const { p, v } = this.versionRow(pack, no);
    const status = statusOf(p);
    if (status === 'archived') throw new ApiError(403, `Bộ '${pack}' đã lưu trữ — bỏ lưu trữ để khôi phục`);
    if (status === 'review') throw new ApiError(403, `Bộ '${pack}' đang chờ duyệt — trả về Nháp để khôi phục`);
    if (status === 'live') this.admin.require(user, 'production');
    const items = this.versionLevels(v.id);
    const inRange = n => v.from_lv == null || (n >= v.from_lv && n <= v.to_lv);
    const out = this.db.write(() => {
      const heads = this.heads(pack).filter(h => inRange(h.level));
      const byName = new Map(heads.map(h => [h.name, h]));
      const wanted = new Set(items.map(it => it.name));
      const touched = [...items.filter(it => byName.get(it.name)?.sha !== it.sha).map(it => it.name), ...heads.filter(h => !wanted.has(h.name)).map(h => h.name)];
      const locked = this.lockedBy(pack, touched, user);
      if (locked.length) throw new ApiError(423, `${locked.length} level đang có người sửa — chưa khôi phục được`, { locked });
      const message = `khôi phục ${p.code} v${v.no}`;
      for (const it of items) {
        if (byName.get(it.name)?.sha === it.sha) continue;
        const r = this.store.writeRev(pack, it.name, this.store.blob(it.sha), user, 'revert', { message, meta: { restored_version: v.no }, diff: true });
        this.store.audit(user, 'level.revert', pack, it.name, r.rev, { restored_version: v.no });
      }
      for (const h of heads) {
        if (wanted.has(h.name)) continue;
        const r = this.store.writeRev(pack, h.name, null, user, 'delete', { message, meta: { restored_version: v.no } });
        this.store.audit(user, 'level.delete', pack, h.name, r.rev, { restored_version: v.no });
      }
      const version = this.record(user, pack, 'restore', { note: text || `Khôi phục về v${v.no}`, detail: { restored_from: v.no } });
      return { touched, version };
    });
    this.store.broker.publish('pack.imported', { pack, author: user, changed: out.touched });
    this.publishPack(pack, { author: user });
    return { pack, restored_from: v.no, version: out.version, changed: out.touched.length };
  }

  // ---------- so sánh ----------
  side(spec) {
    const m = /^(.+?)(?:@(\d+))?$/.exec(String(spec || ''));
    if (!m || !PACK_RE.test(m[1])) throw new ApiError(400, `Không hiểu '${spec}': dùng <bộ> hoặc <bộ>@<version>`);
    const p = this.store.pack(m[1]);
    if (m[2]) {
      const { v } = this.versionRow(p.name, m[2]);
      return { pack: p.name, code: p.code, version: v.no, label: `${p.code} v${v.no}`, items: this.versionLevels(v.id), range: v.from_lv == null ? null : [v.from_lv, v.to_lv] };
    }
    return { pack: p.name, code: p.code, version: null, label: `${p.code} hiện tại`, items: this.heads(p.name), range: null };
  }

  /** Có một level đi từ nội dung s1 tới s2 chỉ bằng sửa / khôi phục / đổi số (Sửa) hay không (Thay). */
  edited(s1, s2) {
    const rows = this.db.all(`SELECT r1.level_id id, r1.rev a, r2.rev b FROM revisions r1
      JOIN revisions r2 ON r2.level_id=r1.level_id AND r2.rev>r1.rev WHERE r1.blob_sha=? AND r2.blob_sha=? LIMIT 20`, s1, s2);
    return rows.some(r => this.db.all('SELECT kind FROM revisions WHERE level_id=? AND rev>? AND rev<=?', r.id, r.a, r.b).every(x => EDIT_KINDS.has(x.kind)));
  }

  diff(aSpec, bSpec) {
    const a = this.side(aSpec), b = this.side(bSpec);
    const ranges = [a.range, b.range].filter(Boolean);
    const range = ranges.length ? [Math.max(...ranges.map(r => r[0])), Math.min(...ranges.map(r => r[1]))] : null;
    const pick = list => new Map(list.filter(it => !range || (it.level >= range[0] && it.level <= range[1])).map(it => [it.level, it]));
    const A = pick(a.items), B = pick(b.items);
    const atKey = new Map();
    for (const it of A.values()) {
      const k = this.keyOf(it.sha);
      if (!atKey.has(k)) atKey.set(k, []);
      atKey.get(k).push(it.level);
    }
    const levels = [...new Set([...A.keys(), ...B.keys()])].sort((x, y) => x - y);
    const items = [], counts = { same: 0, edited: 0, replaced: 0, moved: 0, added: 0, removed: 0 };
    const brief = it => (it ? { name: it.name, rev: it.rev, sha: it.sha } : null);
    for (const level of levels) {
      const x = A.get(level), y = B.get(level);
      let kind, from = null;
      if (x && y && (x.sha === y.sha || this.keyOf(x.sha) === this.keyOf(y.sha))) kind = 'same';
      else if (!y) kind = 'removed';
      else {
        from = (atKey.get(this.keyOf(y.sha)) || []).find(n => n !== level) ?? null;
        kind = from != null ? 'moved' : !x ? 'added' : this.edited(x.sha, y.sha) ? 'edited' : 'replaced';
      }
      counts[kind]++;
      if (kind !== 'same') items.push({ level, kind, ...(from != null ? { from } : {}), a: brief(x), b: brief(y) });
    }
    const label = s => ({ pack: s.pack, code: s.code, version: s.version, label: s.label });
    return { a: label(a), b: label(b), range, counts, items };
  }

  // ---------- level dùng ở đâu, áp bản mới ----------
  usage(pack, name) {
    this.store.pack(pack);
    const lv = this.store.level(pack, name);
    if (!lv || lv.deleted) throw new ApiError(404, `Không có level ${pack}/${name}`);
    const key = lv.content_key || this.keyOf(this.store.head(lv).blob_sha);
    const old = [...new Set(this.db.all('SELECT blob_sha FROM revisions WHERE level_id=? AND blob_sha IS NOT NULL', lv.id)
      .map(r => this.keyOf(r.blob_sha)))].filter(k => k && k !== key);
    const select = `SELECT l.pack, l.name, l.head_rev, l.content_key, p.code, p.archived, p.production, p.review_at FROM levels l
      JOIN packs p ON p.name=l.pack WHERE l.deleted=0`;
    const row = r => ({ pack: r.pack, code: r.code, status: statusOf(r), name: r.name, rev: r.head_rev });
    const same = this.db.all(`${select} AND l.content_key=? ORDER BY l.pack, l.sort_key`, key)
      .filter(r => !(r.pack === pack && r.name === name)).map(row);
    const older = old.length ? this.db.all(`${select} AND l.pack<>? AND l.content_key IN (${old.map(() => '?').join(',')}) ORDER BY l.pack, l.sort_key`, pack, ...old).map(row) : [];
    return { pack, name, key, same, older };
  }

  apply(user, pack, name, targets, message = '') {
    if (!Array.isArray(targets) || !targets.length || targets.length > MAX_APPLY_TARGETS) {
      throw new ApiError(400, `Cần {"targets": [{"pack", "name"}]} (1–${MAX_APPLY_TARGETS} nơi)`);
    }
    const groups = new Map();
    for (const t of targets) {
      if (!t || typeof t.pack !== 'string' || (typeof t.name !== 'string' && typeof t.name !== 'number')) throw new ApiError(400, 'Mỗi nơi cần {pack, name}');
      if (t.pack === pack) throw new ApiError(400, 'Áp sang bộ khác; trong cùng bộ dùng Nhân bản level');
      if (!groups.has(t.pack)) groups.set(t.pack, []);
      groups.get(t.pack).push(String(t.name));
    }
    for (const dst of groups.keys()) {
      if (statusOf(this.store.pack(dst)) === 'live') this.admin.require(user, 'production');
    }
    const results = [];
    for (const [dst, names] of groups) {
      try {
        const r = this.store.promote(user, pack, dst, names.map(to => ({ name, to })), message || `áp bản mới từ ${pack}/${name}`);
        results.push(...r.items.map(i => ({ pack: dst, name: i.to, rev: i.rev, unchanged: !!i.unchanged })));
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
        results.push(...names.map(n => ({ pack: dst, name: n, error: e.message })));
      }
    }
    return { from: { pack, name }, results };
  }
}
