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
// Las claves de cada comerciante se guardan cifradas en el almacenamiento privado (carpeta "mpcobro").
const crypto = require('crypto');
const { cuerpo, usuario, stHeaders, db } = require('./_comun');

const SURL = () => String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const ST = () => SURL() + '/storage/v1';
const CID = () => process.env.MP_OAUTH_CLIENT_ID || '';
const CSEC = () => process.env.MP_OAUTH_CLIENT_SECRET || '';
const okUid = u => /^[0-9a-f-]{36}$/i.test(String(u || ''));
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
      try { const j = await mpToken({ grant_type: 'authorization_code', code: String(q.code), redirect_uri: REDIR }); await guardarConexion(st.uid, j); }
      catch (e) { console.error('mpcobro conectar', e.message); res.writeHead(302, { Location: '/panel?mp=error' }); return res.end(); }
      res.writeHead(302, { Location: '/panel?mp=ok' }); return res.end();
    }
    if (req.method === 'GET' && q.error) { res.writeHead(302, { Location: '/panel?mp=cancelado' }); return res.end(); }

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
      if (!CID() || !CSEC()) return res.status(503).json({ error: 'El cobro con Mercado Pago todavía no está activado en Vitrina 360.' });
      const state = crypto.randomBytes(16).toString('hex');
      await guardar('mpcobro', 's/' + state + '.json', { uid: u.id, t: Date.now() });
      const url = 'https://auth.mercadopago.com/authorization?client_id=' + encodeURIComponent(CID()) + '&response_type=code&platform_id=mp&state=' + state + '&redirect_uri=' + encodeURIComponent(REDIR);
      return res.status(200).json({ url });
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
        items: [{ id: p.id, title: ('Pedido ' + (String(b.tienda || '').slice(0, 40) || 'Vitrina 360')).slice(0, 60), quantity: 1, unit_price: Math.round(total * 100) / 100, currency_id: moneda }],
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
