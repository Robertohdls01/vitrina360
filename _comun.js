// Ayudas compartidas por las funciones de Vitrina 360 (este archivo no es una dirección pública).
const SURL = () => String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const PLANES = () => ({
  emprendedora: { nombre: 'Emprendedora', precio: Number(process.env.PRECIO_EMPRENDEDORA || process.env.PRECIO_ARS || 9900), vitrinas: 10, tiendas: 1 },
  comercio: { nombre: 'Comercio', precio: Number(process.env.PRECIO_COMERCIO || 14900), vitrinas: 20, tiendas: 1 },
  pro: { nombre: 'Pro', precio: Number(process.env.PRECIO_PRO || 19900), vitrinas: 20, tiendas: 4 }
});
const PRECIO = () => PLANES().emprendedora.precio;

function cuerpo(req) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } }
  return b || {};
}

// Quién está pidiendo: verifica el token del panel contra Supabase.
async function usuario(req) {
  const tok = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!tok || !process.env.SUPABASE_KEY) return null;
  const r = await fetch(SURL() + '/auth/v1/user', { headers: { apikey: process.env.SUPABASE_KEY, Authorization: 'Bearer ' + tok } });
  if (!r.ok) return null;
  const u = await r.json();
  return u && u.id ? { id: u.id, email: u.email || '' } : null;
}

// Base de datos con la clave secreta (solo del servidor): puede marcar pagos.
async function db(method, path, body) {
  const k = process.env.SUPABASE_SERVICE_KEY;
  const headers = { apikey: k, 'Content-Type': 'application/json', Prefer: 'return=representation' };
  if (String(k).startsWith('eyJ')) headers.Authorization = 'Bearer ' + k;
  const r = await fetch(SURL() + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {}
  if (!r.ok) throw new Error('db ' + r.status + ' ' + (j && (j.message || j.msg) || t).slice(0, 200));
  return j;
}

async function mp(method, path, body) {
  const r = await fetch('https://api.mercadopago.com' + path, {
    method,
    headers: { Authorization: 'Bearer ' + process.env.MP_ACCESS_TOKEN, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {}
  if (!r.ok) { const e = new Error((j && (j.message || j.error)) || ('mp ' + r.status)); e.status = r.status; e.body = j; throw e; }
  return j;
}

// Hasta cuándo queda pagada según la suscripción de Mercado Pago (3 días de gracia después del próximo cobro).
function pagadaHasta(pre) {
  if (!pre || pre.status !== 'authorized') return null;
  const base = pre.next_payment_date ? Date.parse(pre.next_payment_date) : NaN;
  const t = isFinite(base) ? base : Date.now() + 31 * 864e5;
  return new Date(t + 3 * 864e5).toISOString();
}

// Actualiza la fila de la tienda con lo que dice Mercado Pago. Devuelve la fila nueva.
async function sincronizar(row) {
  if (!row || !row.mp_suscripcion || !process.env.MP_ACCESS_TOKEN) return row;
  const pre = await mp('GET', '/preapproval/' + encodeURIComponent(row.mp_suscripcion));
  const hasta = pagadaHasta(pre);
  const nuevoPlan = row.mp_plan && PLANES()[row.mp_plan] ? row.mp_plan : null;
  if (hasta && (!row.pagada_hasta || Date.parse(hasta) > Date.parse(row.pagada_hasta) || (nuevoPlan && nuevoPlan !== row.plan))) {
    const cambio = { pagada_hasta: hasta };
    if (nuevoPlan) cambio.plan = nuevoPlan;
    // Si cambió de plan, se da de baja la suscripción vieja para no cobrar dos veces.
    if (row.mp_anterior && row.mp_anterior !== row.mp_suscripcion) {
      try { await mp('PUT', '/preapproval/' + encodeURIComponent(row.mp_anterior), { status: 'cancelled' }); cambio.mp_anterior = null; } catch (e) {}
    }
    const out = await db('PATCH', '/rest/v1/tiendas?owner=eq.' + row.owner, cambio);
    return Object.assign({}, row, out && out[0] ? out[0] : cambio, { mp_estado: pre.status });
  }
  return Object.assign({}, row, { mp_estado: pre.status });
}

function estado(row) {
  const now = Date.now();
  const prueba = row.prueba_hasta ? Date.parse(row.prueba_hasta) : 0;
  const pagada = row.pagada_hasta ? Date.parse(row.pagada_hasta) : 0;
  const dias = t => Math.max(0, Math.ceil((t - now) / 864e5));
  const P = PLANES(), pagado = P[row.plan] ? row.plan : 'emprendedora';
  const con = (estado, d, plan) => ({ estado, dias: d, plan, plan_pagado: pagado, limites: { vitrinas: P[plan].vitrinas, tiendas: P[plan].tiendas } });
  if (row.activa === false) return con('pausa', 0, pagado);
  if (pagada > now) return con('activa', dias(pagada), pagado);
  if (prueba > now) return con('prueba', dias(prueba), 'pro');
  return con('pausa', 0, pagado);
}

module.exports = { cuerpo, usuario, db, mp, sincronizar, estado, PRECIO, PLANES };
