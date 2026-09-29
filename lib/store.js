// Speicher: Upstash/Vercel Redis (REST) wenn konfiguriert, sonst lokale Datei data.json
const fs = require('fs');
const path = require('path');

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

if (!URL_ && process.env.VERCEL) throw new Error('Keine Datenbank konfiguriert (KV_REST_API_URL / KV_REST_API_TOKEN fehlen).');
module.exports = URL_ ? remote : local;
