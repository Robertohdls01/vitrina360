// Vitrina 360 · Cobro automático con Mercado Pago (cada comerciante conecta SU cuenta con un botón).
// En Vercel: MP_OAUTH_CLIENT_ID y MP_OAUTH_CLIENT_SECRET (los de tu aplicación "Vitrina 360" en Mercado Pago Developers).
// En esa aplicación, la "Redirect URL" tiene que ser exactamente: https://<tu dominio>/api/mpcobro
//
//   POST ?accion=conectar        (comerciante, Bearer) → { url } para ir a Mercado Pago y autorizar
//   GET  /api/mpcobro?code=&state=  (vuelve de Mercado Pago) → guarda la conexión y vuelve al panel
//   GET  ?accion=estado          (comerciante, Bearer) → { conectado }
//   POST ?accion=desconectar     (comerciante, Bearer)
//   POST ?accion=pagar {ref,k}   (cliente) → { url } del cobro de Mercado Pago por el total del pedido
//   POST ?accion=aviso&u=<dueño> (Mercado Pago avisa un pago) → si está aprobado, el pedido queda "pagado" solo
// ShopMenu (cafés): POST ?accion=menuConectar {id,clave,volver} · GET ?accion=menuEstado&id&clave · POST ?accion=menuDesconectar {id,clave}
//   GET ?accion=menuDisponible&id · POST ?accion=menuPagar {id,mesa,nombre,peds:[{pid,k}],propina} · aviso con &m=<id>
// Las claves de cada comerciante se guardan cifradas en el almacenamiento privado (carpeta "mpcobro").
const crypto = require('crypto');
const { cuerpo, usuario, stHeaders, db } = require('./_comun');

const SURL = () => String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const ST = () => SURL() + '/storage/v1';
const CID = () => process.env.MP_OAUTH_CLIENT_ID || '';
const CSEC = () => process.env.MP_OAUTH_CLIENT_SECRET || '';
const okUid = u => /^[0-9a-f-]{36}$/i.test(String(u || ''));
const okMenu = id => /^[a-z0-9]{6,20}$/.test(String(id || ''));
const hashMenu = c => crypto.createHash('sha256').update('shopmenu|' + c).digest('hex');
const okRef = ref => /^[0-9a-f-]{36}\/[0-9a-z]{6,24}$/i.test(String(ref || ''));

async function bucket(b) { try { await fetch(ST() + '/bucket', { method: 'POST', headers: stHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ id: b, name: b, public: false }) }); } catch (e) {} }
async function leer(b, path) { try { const r = await fetch(ST() + '/object/' + b + '/' + path, { headers: stHeaders({ 'cache-control': 'no-cache' }) }); return r.ok ? await r.json() : null; } catch (e) { return null; } }
async function guardar(b, path, obj) {
  const put = () => fetch(ST() + '/object/' + b + '/' + path, { method: 'POST', headers: stHeaders({ 'Content-Type': 'application/json', 'x-upsert': 'true', 'cache-control': 'no-cache' }), body: JSON.stringify(obj) });
  let r = await put(); if (!r.ok) { await bucket(b); r = await put(); }
  return r.ok;
}
async function borrar(b, path) { try { await fetch(ST() + '/object/' + b + '/' + path, { method: 'DELETE', headers: stHeaders() }); } catch (e) {} }

// cifrado de las claves de cada comerciante (AES-256-GCM con una clave derivada del secreto de la app)
const KEY = () => crypto.createHash('sha256').update('v360-mp:' + CSEC() + ':' + (process.env.SUPABASE_SERVICE_KEY || '')).digest();
function cifrar(txt) { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', KEY(), iv); const d = Buffer.concat([c.update(String(txt), 'utf8'), c.final()]); return [iv, c.getAuthTag(), d].map(x => x.toString('base64')).join('.'); }
function descifrar(s) { try { const [iv, tag, d] = String(s).split('.').map(x => Buffer.from(x, 'base64')); const c = crypto.createDecipheriv('aes-256-gcm', KEY(), iv); c.setAuthTag(tag); return Buffer.concat([c.update(d), c.final()]).toString('utf8'); } catch (e) { return ''; } }

async function mpToken(body) {
  const r = await fetch('https://api.mercadopago.com/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ client_id: CID(), client_secret: CSEC() }, body)) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('mp ' + r.status + ' ' + (j.message || j.error || ''));
  return j;
}
async function guardarConexion(uid, j) {
  return guardar('mpcobro', 't/' + uid + '.json', { at: cifrar(j.access_token), rt: j.refresh_token ? cifrar(j.refresh_token) : '', mp_user: j.user_id || null, vence: Date.now() + (Number(j.expires_in) || 15552000) * 1000, creado: new Date().toISOString() });
}
// la clave del comerciante, renovada si está por vencer
async function tokenDe(uid) {
  const t = await leer('mpcobro', 't/' + uid + '.json'); if (!t) return null;
  if (t.vence && Date.now() > t.vence - 7 * 864e5 && t.rt) {
    try { const j = await mpToken({ grant_type: 'refresh_token', refresh_token: descifrar(t.rt) }); await guardarConexion(uid, j); return j.access_token; } catch (e) {}
  }
  return descifrar(t.at) || null;
}
const num = s => { s = String(s || ''); if (/consultar/i.test(s)) return NaN; s = s.replace(/[^\d,.-]/g, ''); if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(/\./g, ''); return parseFloat(s); };

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!process.env.SUPABASE_SERVICE_KEY) return res.status(503).json({ error: 'Todavía no está configurado.' });
  const q = req.query || {}, a = q.accion || '';
  const host = 'https://' + (req.headers['x-forwarded-host'] || req.headers.host || 'vitrina360-kappa.vercel.app');
  const REDIR = host + '/api/mpcobro';
  try {
    // ---- vuelve de Mercado Pago con el permiso ----
    if (req.method === 'GET' && q.code && q.state) {
      const st = /^[a-f0-9]{32}$/.test(String(q.state)) ? await leer('mpcobro', 's/' + q.state + '.json') : null;
      if (!st || Date.now() - st.t > 30 * 60e3) { res.writeHead(302, { Location: '/panel?mp=error' }); return res.end(); }
      await borrar('mpcobro', 's/' + q.state + '.json');
      const vuelta = st.menu ? (st.volver || '/menu?m=' + st.menu) : '/panel', sep = vuelta.includes('?') ? '&' : '?';
      try { const j = await mpToken({ grant_type: 'authorization_code', code: String(q.code), redirect_uri: REDIR }); await guardarConexion(st.menu ? 'm-' + st.menu : st.uid, j); }
      catch (e) { console.error('mpcobro conectar', e.message); res.writeHead(302, { Location: vuelta + sep + 'mp=error&mpe=' + encodeURIComponent(String(e.message).slice(0, 120)) }); return res.end(); }
      res.writeHead(302, { Location: vuelta + sep + 'mp=ok' }); return res.end();
    }
    if (req.method === 'GET' && q.error) { console.error('mpcobro error MP', q.error, q.error_description || ''); let vuelta = '/panel'; try { if (/^[a-f0-9]{32}$/.test(String(q.state || ''))) { const st = await leer('mpcobro', 's/' + q.state + '.json'); if (st && st.menu) vuelta = st.volver || '/menu?m=' + st.menu; } } catch (e) {} const sep = vuelta.includes('?') ? '&' : '?'; res.writeHead(302, { Location: vuelta + sep + 'mp=error&mpe=' + encodeURIComponent(String(q.error_description || q.error).slice(0, 120)) }); return res.end(); }

    // ---- ¿esta tienda cobra con Mercado Pago automático? (lo pregunta la tienda pública) ----
    if (req.method === 'GET' && a === 'disponible') {
      const slug = String(q.slug || ''); if (!/^[a-z0-9-]{3,40}$/.test(slug)) return res.status(200).json({ ok: false });
      let row = null; try { const r = await db('GET', '/rest/v1/tiendas?slug=eq.' + slug + '&select=owner'); row = r && r[0]; } catch (e) {}
      const t = row && await leer('mpcobro', 't/' + row.owner + '.json');
      res.setHeader('Cache-Control', 'public, s-maxage=60');
      return res.status(200).json({ ok: !!t });
    }
    // ---- el comerciante ----
    if (a === 'conectar' || a === 'estado' || a === 'desconectar') {
      const u = await usuario(req); if (!u) return res.status(401).json({ error: 'Entrá a tu panel primero.' });
      if (a === 'estado') { const t = await leer('mpcobro', 't/' + u.id + '.json'); return res.status(200).json({ conectado: !!t, disponible: !!(CID() && CSEC()) }); }
      if (a === 'desconectar') { await borrar('mpcobro', 't/' + u.id + '.json'); return res.status(200).json({ ok: true }); }
      if (!CID() || !CSEC()) return res.status(503).json({ error: 'El cobro con Mercado Pago todavía no está activado en ShopFlash.' });
      const state = crypto.randomBytes(16).toString('hex');
      await guardar('mpcobro', 's/' + state + '.json', { uid: u.id, t: Date.now() });
      const url = 'https://auth.mercadopago.com/authorization?client_id=' + encodeURIComponent(CID()) + '&response_type=code&platform_id=mp&state=' + state + '&redirect_uri=' + encodeURIComponent(REDIR);
      return res.status(200).json({ url });
    }


    // ================= ShopMenu: cada café conecta SU Mercado Pago y la mesa paga el total exacto =================
    if (a === 'menuConectar' || a === 'menuEstado' || a === 'menuDesconectar') {
      const b = req.method === 'POST' ? cuerpo(req) : q, id = String(b.id || '');
      if (!okMenu(id)) return res.status(400).json({ error: 'Menú inválido.' });
      const f = await leer('pedidos', 'menus/' + id + '.json');
      if (!f || hashMenu(String(b.clave || '')) !== f.clave) return res.status(403).json({ error: 'La clave no es correcta.' });
      if (a === 'menuEstado') { const t = await leer('mpcobro', 't/m-' + id + '.json'); return res.status(200).json({ conectado: !!t, disponible: !!(CID() && CSEC()) }); }
      if (a === 'menuDesconectar') { await borrar('mpcobro', 't/m-' + id + '.json'); return res.status(200).json({ ok: true }); }
      if (!CID() || !CSEC()) return res.status(503).json({ error: 'El cobro con Mercado Pago todavía no está activado.' });
      let volver = String(b.volver || ''); if (!volver.startsWith('/menu?m=' + id)) volver = '/menu?m=' + id;
      const state = crypto.randomBytes(16).toString('hex');
      await guardar('mpcobro', 's/' + state + '.json', { menu: id, volver: volver.slice(0, 300), t: Date.now() });
      const url = 'https://auth.mercadopago.com/authorization?client_id=' + encodeURIComponent(CID()) + '&response_type=code&platform_id=mp&state=' + state + '&redirect_uri=' + encodeURIComponent(REDIR);
      return res.status(200).json({ url });
    }
    if (req.method === 'GET' && a === 'menuDisponible') {
      const id = String(q.id || ''); if (!okMenu(id)) return res.status(200).json({ ok: false });
      const t = await leer('mpcobro', 't/m-' + id + '.json');
      res.setHeader('Cache-Control', 'public, s-maxage=60');
      return res.status(200).json({ ok: !!t });
    }
    if (req.method === 'POST' && a === 'menuPagar') {
      const b = cuerpo(req), id = String(b.id || '');
      if (!okMenu(id)) return res.status(400).json({ error: 'Menú inválido.' });
      const f = await leer('pedidos', 'menus/' + id + '.json'); if (!f || !f.menu) return res.status(404).json({ error: 'No encontramos este menú.' });
      const tok = await tokenDe('m-' + id); if (!tok) return res.status(409).json({ error: 'Este local no tiene Mercado Pago conectado.' });
      const L = (await leer('pedidos', 'menus/' + id + '-pedidos.json')) || { items: [] };
      const peds = (Array.isArray(b.peds) ? b.peds : []).slice(0, 30), mios = [];
      peds.forEach(x => { const p = (L.items || []).find(y => y.tipo === 'pedido' && y.id === String(x && x.pid || '')); if (p && p.k === String(x.k || '') && !p.pagadoMp && p.estado !== 'cancelado') mios.push(p); });
      if (!mios.length) return res.status(404).json({ error: 'No encontramos tus pedidos para cobrar.' });
      let total = 0; mios.forEach(p => (p.items || []).forEach(i => { const v = num(i.p); if (isFinite(v)) total += v * (i.q || 1); }));
      if (!(total > 0)) return res.status(400).json({ error: 'Tu pedido no tiene precio: pagale al mozo.' });
      const tip = Math.max(0, Math.min(total * 0.5, Number(b.propina) || 0)), monto = Math.round((total + tip) * 100) / 100;
      const MONS = { '$': 'ARS', 'US$': 'USD', 'R$': 'BRL', 'UYU': 'UYU', 'CLP': 'CLP', 'S/': 'PEN' }, moneda = MONS[f.menu.moneda || '$'] || 'ARS';
      const pago = crypto.randomBytes(6).toString('hex'), mesa = Math.max(0, Math.min(500, parseInt(b.mesa, 10) || 0));
      const P = (await leer('pedidos', 'menus/' + id + '-mp.json')) || { p: {} };
      P.p[pago] = { peds: mios.map(p => p.id), monto, tip, mesa, nombre: String(b.nombre || '').slice(0, 30), creado: new Date().toISOString() };
      Object.keys(P.p).forEach(k => { if (Date.now() - Date.parse(P.p[k].creado) > 3 * 864e5) delete P.p[k]; });
      await guardar('pedidos', 'menus/' + id + '-mp.json', P);
      const back = host + '/menu?m=' + id + '&mesa=' + mesa;
      const r = await fetch('https://api.mercadopago.com/checkout/preferences', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({
        items: [{ id: pago, title: (String(f.menu.nombre || 'Consumo').slice(0, 40) + (mesa ? ' · Mesa ' + mesa : '')).slice(0, 60), quantity: 1, unit_price: monto, currency_id: moneda }],
        external_reference: 'menu:' + id + ':' + pago,
        notification_url: host + '/api/mpcobro?accion=aviso&m=' + id,
        back_urls: { success: back + '&pago=ok', pending: back + '&pago=pendiente', failure: back + '&pago=error' },
        auto_return: 'approved', statement_descriptor: 'SHOPMENU'
      }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.init_point) { console.error('mpcobro menuPagar', r.status, JSON.stringify(j).slice(0, 300)); return res.status(502).json({ error: 'Mercado Pago no respondió. Probá de nuevo o pagale al mozo.' }); }
      return res.status(200).json({ url: j.init_point, monto });
    }

    // ---- el cliente quiere pagar su pedido ----
    if (req.method === 'POST' && a === 'pagar') {
      const b = cuerpo(req);
      if (!okRef(b.ref)) return res.status(400).json({ error: 'Pedido inválido.' });
      const p = await leer('pedidos', b.ref + '.json');
      if (!p || p.k !== String(b.k || '')) return res.status(404).json({ error: 'No encontramos tu pedido.' });
      if (p.pagado) return res.status(409).json({ error: 'Este pedido ya está pagado.' });
      const MON = ['ARS', 'BRL', 'MXN', 'CLP', 'COP', 'PEN', 'UYU', 'USD'], moneda = MON.includes(p.moneda) ? p.moneda : 'ARS';
      let total = p.total_n != null ? Number(p.total_n) : num(p.total);
      if (moneda === 'CLP' || moneda === 'COP') total = Math.round(total);
      if (!isFinite(total) || total <= 0) return res.status(400).json({ error: 'Este pedido tiene productos sin precio: coordiná el pago por WhatsApp.' });
      const owner = b.ref.split('/')[0], tok = await tokenDe(owner);
      if (!tok) return res.status(409).json({ error: 'Este comercio no tiene conectado Mercado Pago. Coordiná el pago por WhatsApp.' });
      const slug = String(b.slug || '').replace(/[^a-z0-9-]/g, '').slice(0, 40);
      const back = slug ? host + '/t/' + slug : host;
      const r = await fetch('https://api.mercadopago.com/checkout/preferences', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({
        items: [{ id: p.id, title: ('Pedido ' + (String(b.tienda || '').slice(0, 40) || 'ShopFlash')).slice(0, 60), quantity: 1, unit_price: Math.round(total * 100) / 100, currency_id: moneda }],
        external_reference: b.ref,
        notification_url: host + '/api/mpcobro?accion=aviso&u=' + owner,
        back_urls: { success: back + '?pago=ok', pending: back + '?pago=pendiente', failure: back + '?pago=error' },
        auto_return: 'approved',
        statement_descriptor: 'VITRINA360'
      }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.init_point) { console.error('mpcobro pagar', r.status, JSON.stringify(j).slice(0, 300)); return res.status(502).json({ error: 'Mercado Pago no respondió. Probá de nuevo o coordiná por WhatsApp.' }); }
      p.mp_pref = j.id; await guardar('pedidos', b.ref + '.json', p);
      return res.status(200).json({ url: j.init_point });
    }

    // ---- Mercado Pago avisa un pago ----
    if (a === 'aviso' && q.m) {
      const id = String(q.m); if (!okMenu(id)) return res.status(200).json({ ok: true });
      const b = cuerpo(req);
      const tipo = b.type || b.topic || q.type || q.topic || '', pid = String((b.data && b.data.id) || q['data.id'] || q.id || '').replace(/\D/g, '');
      if (!/payment/.test(tipo) || !pid) return res.status(200).json({ ok: true });
      const tok = await tokenDe('m-' + id); if (!tok) return res.status(200).json({ ok: true });
      const r = await fetch('https://api.mercadopago.com/v1/payments/' + pid, { headers: { Authorization: 'Bearer ' + tok } });
      const pay = await r.json().catch(() => null); if (!r.ok || !pay || pay.status !== 'approved') return res.status(200).json({ ok: true });
      const ref = String(pay.external_reference || '').split(':'); if (ref[0] !== 'menu' || ref[1] !== id) return res.status(200).json({ ok: true });
      const P = (await leer('pedidos', 'menus/' + id + '-mp.json')) || { p: {} }, x = P.p[ref[2]];
      if (!x || x.pagado || Math.abs(Number(pay.transaction_amount) - x.monto) > Math.max(1, x.monto * 0.005)) return res.status(200).json({ ok: true });
      x.pagado = new Date().toISOString(); x.mp = pid; await guardar('pedidos', 'menus/' + id + '-mp.json', P);
      const L = (await leer('pedidos', 'menus/' + id + '-pedidos.json')) || { items: [] };
      (L.items || []).forEach(p => { if (x.peds.includes(p.id)) { p.pagadoMp = x.pagado; } });
      const money = n => '$' + Number(n).toLocaleString('es-AR', { maximumFractionDigits: 2 });
      L.items = [{ id: Date.now().toString(36) + crypto.randomBytes(3).toString('hex'), k: crypto.randomBytes(8).toString('hex'), mesa: x.mesa, nombre: x.nombre, creado: new Date().toISOString(), tipo: 'pago', metodo: 'virtual', monto: money(x.monto), propina: x.tip ? 'propina ' + money(x.tip) : '', texto: '✅ Pagó con Mercado Pago (confirmado solo, ya está en tu cuenta)', mpOk: true, estado: 'nuevo' }].concat(L.items || []).slice(0, 150);
      await guardar('pedidos', 'menus/' + id + '-pedidos.json', L);
      try { // cierre de caja: el cobro de Mercado Pago queda anotado en las ventas del día
        const it = L.items[0], dia = new Date(Date.parse(it.creado) - 3 * 3600e3).toISOString().slice(0, 10), vp = 'menus/ventas/' + id + '/' + dia + '.json';
        const V = (await leer('pedidos', vp)) || { items: [] }; V.items = (V.items || []).concat([{ id: it.id, t: it.creado, mesa: it.mesa, pg: 'mp', det: '', m: it.monto }]).slice(-4000); await guardar('pedidos', vp, V);
      } catch (e) {}
      return res.status(200).json({ ok: true });
    }
    if (a === 'aviso') {
      const owner = String(q.u || ''); if (!okUid(owner)) return res.status(200).json({ ok: true });
      const b = cuerpo(req);
      const tipo = b.type || b.topic || q.type || q.topic || '', id = String((b.data && b.data.id) || q['data.id'] || q.id || '').replace(/\D/g, '');
      if (!/payment/.test(tipo) || !id) return res.status(200).json({ ok: true });
      const tok = await tokenDe(owner); if (!tok) return res.status(200).json({ ok: true });
      const r = await fetch('https://api.mercadopago.com/v1/payments/' + id, { headers: { Authorization: 'Bearer ' + tok } });
      const pay = await r.json().catch(() => null);
      if (!r.ok || !pay) return res.status(200).json({ ok: true });
      const ref = String(pay.external_reference || '');
      if (!okRef(ref) || ref.split('/')[0] !== owner) return res.status(200).json({ ok: true });
      const p = await leer('pedidos', ref + '.json'); if (!p) return res.status(200).json({ ok: true });
      const total = p.total_n != null ? Number(p.total_n) : num(p.total);
      if (pay.status === 'approved' && (!isFinite(total) || Math.abs(Number(pay.transaction_amount) - total) <= Math.max(1, total * 0.005))) {
        if (!p.pagado) { p.pagado = true; p.paga_ahora = true; p.pagado_en = new Date().toISOString(); p.pago_mp = id; p.pago = (p.pago ? p.pago + ' · ' : '') + 'Pagado con Mercado Pago (confirmado solo)'; await guardar('pedidos', ref + '.json', p); }
      }
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Acción no válida.' });
  } catch (e) {
    console.error('mpcobro', e && e.message);
    return res.status(500).json({ error: 'No se pudo completar. Probá de nuevo en un ratito.' });
  }
};
