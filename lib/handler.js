const crypto = require('crypto');
const store = require('./store');

const clean = (s, max) => String(s ?? '').trim().slice(0, max);
const rid = n => crypto.randomBytes(n).toString('base64url');
const eq = (a, b) => { a = Buffer.from(String(a)); b = Buffer.from(String(b)); return a.length === b.length && crypto.timingSafeEqual(a, b); };

function send(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req.body !== undefined) return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  let raw = '';
  for await (const c of req) { raw += c; if (raw.length > 100_000) throw new Error('zu gross'); }
  return JSON.parse(raw || '{}');
}

// Öffentliche Sicht: nie adminKey oder Reservierungs-Token ausgeben
async function publicView(list) {
  const claims = await store.getClaims(list.id);
  return {
    id: list.id, child: list.child, event: list.event,
    gifts: list.gifts.map(g => ({ id: g.id, title: g.title, takenBy: claims[g.id]?.name || null })),
  };
}

function parseGifts(input, existing = []) {
  const known = new Set(existing.map(g => g.id));
  return (Array.isArray(input) ? input : []).slice(0, 50)
    .map(g => ({ id: known.has(g?.id) ? g.id : rid(4), title: clean(g?.title, 120) }))
    .filter(g => g.title);
}

module.exports = async function handler(req, res) {
  try {
    const parts = new URL(req.url, 'http://x').pathname.split('/').filter(Boolean); // ['api','lists',id,...]
    if (parts[0] !== 'api' || parts[1] !== 'lists') return send(res, 404, { error: 'Unbekannt.' });
    const [, , id, sub, gid, action] = parts;

    if (!id) {
      if (req.method !== 'POST') return send(res, 405, { error: 'Nicht erlaubt.' });
      const b = await readBody(req);
      const child = clean(b.child, 60), event = clean(b.event, 60), gifts = parseGifts(b.gifts);
      if (!child || !event || !gifts.length) return send(res, 400, { error: 'Name, Event und mindestens ein Geschenk nötig.' });
      const list = { id: rid(6), adminKey: rid(16), child, event, gifts, created: Date.now() };
      await store.setList(list.id, list);
      return send(res, 201, { id: list.id, adminKey: list.adminKey });
    }

    const list = await store.getList(id);
    if (!list) return send(res, 404, { error: 'Liste nicht gefunden.' });
    const isAdmin = !!req.headers['x-admin-key'] && eq(req.headers['x-admin-key'], list.adminKey);

    if (!sub && req.method === 'GET') return send(res, 200, { ...(await publicView(list)), admin: isAdmin });

    if (!sub && req.method === 'PUT') { // Admin: bearbeiten
      if (!isAdmin) return send(res, 403, { error: 'Kein Zugriff.' });
      const b = await readBody(req);
      const child = clean(b.child, 60), event = clean(b.event, 60), gifts = parseGifts(b.gifts, list.gifts);
      if (!child || !event || !gifts.length) return send(res, 400, { error: 'Name, Event und mindestens ein Geschenk nötig.' });
      const keep = new Set(gifts.map(g => g.id));
      for (const g of list.gifts) if (!keep.has(g.id)) await store.release(id, g.id);
      Object.assign(list, { child, event, gifts });
      await store.setList(id, list);
      return send(res, 200, { ...(await publicView(list)), admin: true });
    }

    if (sub === 'gifts' && req.method === 'POST') {
      const gift = list.gifts.find(g => g.id === gid);
      if (!gift) return send(res, 404, { error: 'Geschenk nicht gefunden.' });
      const b = await readBody(req);

      if (action === 'claim') {
        const name = clean(b.name, 40);
        if (!name) return send(res, 400, { error: 'Bitte gib deinen Namen ein.' });
        const token = rid(12);
        const ok = await store.claim(id, gid, { name, token });
        if (!ok) return send(res, 409, { error: 'Schon vergeben.', list: await publicView(list) });
        return send(res, 200, { token, list: await publicView(list) });
      }
      if (action === 'release') { // Zurücknehmen: eigener Token oder Admin
        const claim = await store.getClaim(id, gid);
        if (claim && !isAdmin && !(b.token && eq(b.token, claim.token))) return send(res, 403, { error: 'Nur wer das Geschenk reserviert hat, kann es zurücknehmen.' });
        await store.release(id, gid);
        return send(res, 200, { list: { ...(await publicView(list)), admin: isAdmin } });
      }
    }
    return send(res, 404, { error: 'Unbekannt.' });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: 'Serverfehler.' });
  }
};
