const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const EMOJI = ['🧸','🚀','🎨','📚','🦄','⚽','🎲','🧩','🚂','🎸'];
const OTHER = 'Anderer …';
const app = $('#app');

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
async function api(path, method = 'GET', body, key) {
  const r = await fetch('/api/lists' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(key ? { 'x-admin-key': key } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({ error: `Fehler ${r.status}` })) };
}
const evEmoji = e => e === 'Geburtstag' ? '🎂' : e === 'Weihnachten' ? '🎄' : '🎉';

/* ---------- Routing ---------- */
const guest = location.pathname.match(/^\/w\/([\w-]+)/);
const admin = location.pathname.match(/^\/admin\/([\w-]+)\/([\w-]+)/);
if (admin) showAdmin(admin[1], admin[2]);
else if (guest) showGuest(guest[1]);
else showCreate();

/* ---------- Wiederverwendbare Formularteile ---------- */
function eventPicker(el, initial) {
  let ev = ['Geburtstag', 'Weihnachten'].includes(initial) ? initial : (initial ? OTHER : 'Geburtstag');
  el.innerHTML = `<div class="chips"></div><input type="text" class="hidden" maxlength="60" placeholder="Eigener Event, z.B. Einschulung" style="margin-top:10px">`;
  const chips = el.querySelector('.chips'), custom = el.querySelector('input');
  if (ev === OTHER) custom.value = initial;
  const draw = () => {
    chips.innerHTML = ['Geburtstag', 'Weihnachten', OTHER].map(e =>
      `<button type="button" class="chip ${e === ev ? 'on' : ''}" data-e="${e}">${e === 'Geburtstag' ? '🎂 ' : e === 'Weihnachten' ? '🎄 ' : '✏️ '}${e}</button>`).join('');
    custom.classList.toggle('hidden', ev !== OTHER);
  };
  chips.onclick = e => { const b = e.target.closest('.chip'); if (!b) return; ev = b.dataset.e; draw(); if (ev === OTHER) custom.focus(); };
  draw();
  return () => ev === OTHER ? custom.value.trim() : ev;
}

// gifts: [{id?, title, takenBy?}]; onRelease(id) optional (nur Admin)
function giftEditor(el, gifts, onRelease) {
  const add = (g = {}, focus) => {
    const row = document.createElement('div');
    row.className = 'gift-row';
    row.dataset.id = g.id || '';
    row.innerHTML = `<input type="text" maxlength="120" placeholder="Geschenkidee" value="${esc(g.title || '')}">
      ${g.takenBy ? `<button type="button" class="btn ghost small rel" title="Reservierung aufheben">🔒 ${esc(g.takenBy)} ↩</button>` : ''}
      <button type="button" class="btn x" title="Entfernen">✕</button>`;
    row.querySelector('.x').onclick = () => { if (el.children.length > 1) row.remove(); else row.querySelector('input').value = ''; };
    const rel = row.querySelector('.rel');
    if (rel) rel.onclick = () => { if (confirm(`Reservierung von ${g.takenBy} aufheben?`)) onRelease(g.id); };
    row.querySelector('input').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add({}, true); } });
    el.appendChild(row);
    if (focus) row.querySelector('input').focus();
  };
  el.innerHTML = '';
  (gifts.length ? gifts : [{}, {}]).forEach(g => add(g));
  return {
    add: () => add({}, true),
    read: () => [...el.children].map(r => ({ id: r.dataset.id || undefined, title: r.querySelector('input').value.trim() })).filter(g => g.title),
  };
}

/* ---------- Startseite: neue Liste ---------- */
function showCreate() {
  const mine = store.get('wc-mine', []);
  app.innerHTML = `
  <div class="card">
    <h2 class="title">Neue Wunschliste ✨</h2>
    <label for="child">Name des Kindes</label>
    <input type="text" id="child" maxlength="60" placeholder="z.B. Mia">
    <label>Event</label>
    <div id="ev"></div>
    <label>Geschenke</label>
    <div id="gifts"></div>
    <button class="btn blue small" id="add" type="button">+ Geschenk</button>
    <div class="err" id="err"></div>
    <button class="btn big" id="go">Liste erstellen 🎉</button>
  </div>
  ${mine.length ? `<div class="card alt mine"><h2 class="title" style="font-size:1.2rem">Meine Listen 📋</h2>
    ${mine.map(l => `<a href="/admin/${l.id}/${l.key}">${evEmoji(l.event)} ${esc(l.child)} – ${esc(l.event)}</a>`).join('')}</div>` : ''}`;

  const getEvent = eventPicker($('#ev'), '');
  const ge = giftEditor($('#gifts'), []);
  $('#add').onclick = ge.add;
  $('#go').onclick = async () => {
    const child = $('#child').value.trim(), event = getEvent(), gifts = ge.read();
    if (!child) return $('#err').textContent = 'Bitte den Namen des Kindes eingeben.';
    if (!event) return $('#err').textContent = 'Bitte einen Event eingeben.';
    if (!gifts.length) return $('#err').textContent = 'Bitte mindestens ein Geschenk eingeben.';
    const r = await api('', 'POST', { child, event, gifts });
    if (!r.ok) return $('#err').textContent = r.data.error || 'Fehler.';
    store.set('wc-mine', [{ id: r.data.id, key: r.data.adminKey, child, event }, ...mine]);
    location.href = `/admin/${r.data.id}/${r.data.adminKey}?neu=1`;
  };
}

/* ---------- Admin: bearbeiten ---------- */
async function showAdmin(id, key) {
  const r = await api('/' + id, 'GET', null, key);
  if (!r.ok || !r.data.admin) return notFound('Dieser Admin-Link ist ungültig.');
  renderAdmin(r.data, null);

  function renderAdmin(list, draft, msg) {
    const d = draft || list;
    const shareUrl = `${location.origin}/w/${id}`;
    app.innerHTML = `
    <div class="card alt">
      <h2 class="title">${new URLSearchParams(location.search).has('neu') ? 'Fertig! 🥳' : 'Teilen 🔗'}</h2>
      <p style="margin:8px 0 0">Diesen Link an Familie &amp; Freunde schicken:</p>
      <div class="share"><input type="text" readonly value="${esc(shareUrl)}" id="link"><button class="btn mint small" id="copy">Kopieren</button></div>
      <div class="warn">🔑 <b>Speichere diese Seite als Lesezeichen!</b> Nur über diese Adresse kannst du die Liste später bearbeiten. Nicht weitergeben.</div>
    </div>
    <div class="card">
      <h2 class="title">Liste bearbeiten ✏️</h2>
      <label for="child">Name des Kindes</label>
      <input type="text" id="child" maxlength="60" value="${esc(d.child)}">
      <label>Event</label><div id="ev"></div>
      <label>Geschenke</label><div id="gifts"></div>
      <button class="btn blue small" id="add" type="button">+ Geschenk</button>
      <div class="err" id="err" style="${msg ? 'color:#1a9c62' : ''}">${msg || ''}</div>
      <button class="btn big" id="save">Speichern 💾</button>
    </div>
    <p class="center"><a href="/w/${id}" class="link">Gästeansicht öffnen →</a></p>`;

    const getEvent = eventPicker($('#ev'), d.event);
    const status = Object.fromEntries(list.gifts.map(g => [g.id, g.takenBy]));
    const ge = giftEditor($('#gifts'), d.gifts.map(g => ({ ...g, takenBy: status[g.id] })), async gid => {
      const cur = { child: $('#child').value, event: getEvent(), gifts: ge.read() };
      const rr = await api(`/${id}/gifts/${gid}/release`, 'POST', {}, key);
      if (rr.ok) { const fresh = (await api('/' + id, 'GET', null, key)).data; renderAdmin(fresh, cur, 'Reservierung aufgehoben ✓ (noch nicht gespeicherte Änderungen bleiben erhalten)'); }
    });
    $('#add').onclick = ge.add;
    $('#copy').onclick = async () => { $('#link').select(); try { await navigator.clipboard.writeText($('#link').value); } catch { document.execCommand('copy'); } $('#copy').textContent = 'Kopiert ✓'; };
    $('#save').onclick = async () => {
      const child = $('#child').value.trim(), event = getEvent(), gifts = ge.read();
      if (!child || !event || !gifts.length) return $('#err').textContent = 'Name, Event und mindestens ein Geschenk nötig.';
      const rr = await api('/' + id, 'PUT', { child, event, gifts }, key);
      if (!rr.ok) return $('#err').textContent = rr.data.error || 'Fehler.';
      store.set('wc-mine', store.get('wc-mine', []).map(l => l.id === id ? { ...l, child, event } : l));
      renderAdmin(rr.data, null, 'Gespeichert ✓');
    };
  }
}

/* ---------- Gäste ---------- */
let current = null, pending = null;
const tokens = () => store.get('wc-tokens', {});

async function showGuest(id) {
  const r = await api('/' + id);
  if (!r.ok) return notFound('Diese Liste gibt es nicht.');
  renderGuest(r.data);
  setInterval(async () => { const r = await api('/' + id); if (r.ok && !$('#dlg').open) renderGuest(r.data); }, 10000);
}

function notFound(text) {
  app.innerHTML = `<div class="card center"><h2 class="title">Oje 🙈</h2><p>${text}</p><a href="/"><button class="btn">Neue Liste</button></a></div>`;
}

function renderGuest(list) {
  current = list;
  const t = tokens();
  const left = list.gifts.filter(g => !g.takenBy).length;
  app.innerHTML = `
  <div class="card">
    <p class="title">Wunschliste von ${esc(list.child)}</p>
    <span class="badge">${evEmoji(list.event)} ${esc(list.event)}</span>
    <p style="opacity:.7;margin:12px 0 0">${left ? `Noch ${left} von ${list.gifts.length} Geschenken frei` : 'Alle Geschenke sind vergeben! 🎊'}</p>
    ${list.gifts.map((g, i) => `
      <div class="gift ${g.takenBy ? 'taken' : ''}">
        <span class="emo">${g.takenBy ? '✅' : EMOJI[i % EMOJI.length]}</span>
        <span class="t"><b>${esc(g.title)}</b>${g.takenBy ? `<span class="who">Geschenkt von ${esc(g.takenBy)}</span>` : ''}</span>
        ${g.takenBy ? (t[g.id] ? `<button class="btn ghost small" data-undo="${g.id}">Zurücknehmen</button>` : '')
                    : `<button class="btn mint small" data-id="${g.id}">Schenken</button>`}
      </div>`).join('')}
  </div>
  <p class="center"><a href="/" class="link">Eigene Wunschliste erstellen</a></p>`;
}

app.addEventListener('click', async e => {
  const b = e.target.closest('[data-id]');
  if (b) {
    pending = current.gifts.find(g => g.id === b.dataset.id);
    $('#dlgGift').textContent = pending.title;
    $('#dlgName').value = store.get('wc-name', '');
    $('#dlgErr').textContent = '';
    $('#dlg').showModal();
    return $('#dlgName').focus();
  }
  const u = e.target.closest('[data-undo]');
  if (u && confirm('Möchtest du dieses Geschenk wieder freigeben, damit jemand anderes es schenken kann?')) {
    const gid = u.dataset.undo, id = location.pathname.split('/')[2];
    const r = await api(`/${id}/gifts/${gid}/release`, 'POST', { token: tokens()[gid] });
    if (r.ok) { const t = tokens(); delete t[gid]; store.set('wc-tokens', t); renderGuest(r.data.list); }
    else alert(r.data.error || 'Fehler.');
  }
});
$('#dlgCancel').onclick = () => $('#dlg').close();
$('#dlgForm').addEventListener('submit', async e => {
  e.preventDefault();
  const name = $('#dlgName').value.trim();
  if (!name) return $('#dlgErr').textContent = 'Bitte gib deinen Namen ein.';
  const id = location.pathname.split('/')[2];
  const r = await api(`/${id}/gifts/${pending.id}/claim`, 'POST', { name });
  if (r.status === 409) { $('#dlg').close(); renderGuest(r.data.list); alert('Ups, das hat gerade jemand anderes genommen! 🙈'); return; }
  if (!r.ok) return $('#dlgErr').textContent = r.data.error || 'Fehler.';
  store.set('wc-name', name);
  store.set('wc-tokens', { ...tokens(), [pending.id]: r.data.token });
  $('#dlg').close(); renderGuest(r.data.list); confetti();
});

function confetti() {
  const cols = ['🎉', '🎈', '⭐', '🎁', '💖', '✨'];
  for (let i = 0; i < 28; i++) {
    const s = document.createElement('span');
    s.className = 'confetti'; s.textContent = cols[i % cols.length];
    s.style.left = Math.random() * 100 + 'vw'; s.style.animationDelay = Math.random() * .6 + 's';
    document.body.appendChild(s); setTimeout(() => s.remove(), 3200);
  }
}
