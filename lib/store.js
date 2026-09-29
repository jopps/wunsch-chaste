// Speicher: Supabase (Postgres) oder Upstash/Vercel Redis (REST) wenn konfiguriert, sonst lokale Datei data.json
const fs = require('fs');
const path = require('path');

const SB_URL = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(...args) {
  const r = await fetch(URL_, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(args) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

const remote = {
  async getList(id) { const v = await redis('GET', `list:${id}`); return v ? JSON.parse(v) : null; },
  async setList(id, list) { await redis('SET', `list:${id}`, JSON.stringify(list)); },
  async getClaims(id) {
    const flat = (await redis('HGETALL', `claims:${id}`)) || [];
    const out = {};
    for (let i = 0; i < flat.length; i += 2) out[flat[i]] = JSON.parse(flat[i + 1]);
    return out;
  },
  async claim(id, gid, claim) { return (await redis('HSETNX', `claims:${id}`, gid, JSON.stringify(claim))) === 1; }, // atomar
  async getClaim(id, gid) { const v = await redis('HGET', `claims:${id}`, gid); return v ? JSON.parse(v) : null; },
  async release(id, gid) { await redis('HDEL', `claims:${id}`, gid); },
};

// Supabase über die REST-Schnittstelle (Tabellen siehe supabase.sql). Der Service-Key bleibt nur auf dem Server.
async function sb(method, pathAndQuery, body, prefer) {
  const r = await fetch(`${SB_URL}/rest/v1/${pathAndQuery}`, {
    method,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 409) return { conflict: true };
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  return { data: r.status === 204 ? null : await r.json().catch(() => null) };
}
const q = encodeURIComponent;

const supabase = {
  async getList(id) { const { data } = await sb('GET', `lists?id=eq.${q(id)}&select=data`); return data?.[0]?.data || null; },
  async setList(id, list) { await sb('POST', 'lists', { id, data: list }, 'resolution=merge-duplicates,return=minimal'); },
  async getClaims(id) {
    const { data } = await sb('GET', `claims?list_id=eq.${q(id)}&select=gift_id,name,token`);
    return Object.fromEntries((data || []).map(c => [c.gift_id, { name: c.name, token: c.token }]));
  },
  async claim(id, gid, c) { // Primärschlüssel (list_id, gift_id) macht das atomar
    const r = await sb('POST', 'claims', { list_id: id, gift_id: gid, name: c.name, token: c.token }, 'return=minimal');
    return !r.conflict;
  },
  async getClaim(id, gid) {
    const { data } = await sb('GET', `claims?list_id=eq.${q(id)}&gift_id=eq.${q(gid)}&select=name,token`);
    return data?.[0] || null;
  },
  async release(id, gid) { await sb('DELETE', `claims?list_id=eq.${q(id)}&gift_id=eq.${q(gid)}`); },
};

const FILE = path.join(__dirname, '..', 'data.json');
let db;
const load = () => { if (!db) { try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { db = {}; } db.lists ||= {}; db.claims ||= {}; } return db; };
const persist = () => fs.writeFileSync(FILE, JSON.stringify(db, null, 2));

const local = {
  async getList(id) { return load().lists[id] || null; },
  async setList(id, list) { load().lists[id] = list; persist(); },
  async getClaims(id) { return { ...(load().claims[id] || {}) }; },
  async claim(id, gid, claim) { const c = (load().claims[id] ||= {}); if (c[gid]) return false; c[gid] = claim; persist(); return true; },
  async getClaim(id, gid) { return (load().claims[id] || {})[gid] || null; },
  async release(id, gid) { delete (load().claims[id] || {})[gid]; persist(); },
};

if (!SB_URL && !URL_ && process.env.VERCEL) throw new Error('Keine Datenbank konfiguriert (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY oder KV_REST_API_URL / KV_REST_API_TOKEN fehlen).');
module.exports = SB_URL && SB_KEY ? supabase : URL_ ? remote : local;
