// Vitrina 360 · Hotmart avisa acá cada compra, renovación, reembolso o cancelación (Webhook / Postback 2.0).
// Con el mail del comprador se activa, renueva o pausa su tienda, igual que con Mercado Pago.
// Variables en Vercel: HOTMART_HOTTOK (obligatoria, el código "hottok" de Hotmart) y, opcional,
// HOTMART_OFERTAS: {"códigoDeOferta":"emprendedora|comercio|pro", ...} si cambian los links de pago.
const { cuerpo, db, hmGuardar, aplicarPago, stHeaders } = require('./_comun');

// EE.UU.: I108173020N, F108173050I, T108173095W · Latinoamérica: E108277539J (Start), M108277689T (Plus), W108277726R (Pro)
const OFERTAS = { I108173020N: 'emprendedora', F108173050I: 'comercio', T108173095W: 'pro', E108277539J: 'emprendedora', M108277689T: 'comercio', W108277726R: 'pro' };
const ACTIVAN = ['PURCHASE_APPROVED'];   // llega en cada cobro aprobado, también en las renovaciones mensuales
const CORTAN = ['PURCHASE_REFUNDED', 'PURCHASE_CHARGEBACK'];
const DIA = 864e5;

function planDe(d) {
  let extra = {}; try { extra = JSON.parse(process.env.HOTMART_OFERTAS || '{}'); } catch (e) {}
  const mapa = Object.assign({}, OFERTAS, extra);
  const code = d.purchase && d.purchase.offer && d.purchase.offer.code;
  if (code && mapa[code]) return mapa[code];
  const nom = [d.subscription && d.subscription.plan && d.subscription.plan.name, d.purchase && d.purchase.offer && d.purchase.offer.name, d.product && d.product.name].filter(Boolean).join(' ');
  if (/\bpro\b/i.test(nom)) return 'pro';
  if (/plus|comercio/i.test(nom)) return 'comercio';
  return 'emprendedora';
}
// Busca la cuenta del comprador por mail (lista de usuarios de Supabase, de a 1000).
async function cuentaPorMail(email) {
  const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  for (let page = 1; page <= 20; page++) {
    const r = await fetch(base + '/auth/v1/admin/users?page=' + page + '&per_page=1000', { headers: stHeaders() });
    if (!r.ok) return null;
    const j = await r.json().catch(() => ({})), users = Array.isArray(j) ? j : (j.users || []);
    const u = users.find(x => String(x.email || '').toLowerCase() === email);
    if (u) return u.id;
    if (users.length < 1000) return null;
  }
  return null;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(200).json({ ok: true, info: 'Vitrina 360 · Hotmart' });
  const tok = String(req.headers['x-hotmart-hottok'] || '');
  if (!process.env.HOTMART_HOTTOK || tok !== process.env.HOTMART_HOTTOK) return res.status(401).json({ error: 'hottok inválido' });
  if (!process.env.SUPABASE_SERVICE_KEY) return res.status(503).json({ error: 'Base de datos no configurada' });
  try {
    const b = cuerpo(req), ev = String(b.event || '').toUpperCase(), d = b.data || {};
    const email = String((d.buyer && d.buyer.email) || (d.subscriber && d.subscriber.email) || (d.user && d.user.email) || '').trim().toLowerCase();
    if (!email || (!ACTIVAN.includes(ev) && !CORTAN.includes(ev))) return res.status(200).json({ ok: true, ignorado: ev || 'sin evento' });
    const plan = planDe(d);
    const owner = await cuentaPorMail(email);
    const rows = owner ? await db('GET', '/rest/v1/tiendas?owner=eq.' + owner + '&select=owner,pagada_hasta') : null;
    const row = rows && rows[0];
    if (CORTAN.includes(ev)) {
      // Reembolso o contracargo: la tienda queda en pausa desde ahora.
      if (row) await aplicarPago(owner, null, new Date().toISOString());
      return res.status(200).json({ ok: true, accion: row ? 'pausada' : 'sin tienda' });
    }
    // Compra o renovación aprobada: pagada hasta el próximo cobro de Hotmart (o un mes), más 3 días de gracia.
    const prox = Number(d.purchase && d.purchase.date_next_charge) || 0;
    const desde = Math.max(Date.now(), row && row.pagada_hasta ? (Date.parse(row.pagada_hasta) || 0) - 3 * DIA : 0);   // sin sumar dos veces los días de gracia
    const hasta = new Date((prox > Date.now() ? prox : desde + 31 * DIA) + 3 * DIA).toISOString();
    if (row) { await aplicarPago(owner, plan, hasta); return res.status(200).json({ ok: true, accion: 'activada', plan }); }
    // Todavía no creó su tienda: queda guardado y se activa cuando entre con ese mail.
    await hmGuardar(email, { plan, hasta, evento: ev, fecha: new Date().toISOString() });
    return res.status(200).json({ ok: true, accion: 'pendiente', plan });
  } catch (e) {
    console.error('hotmart', e.message);
    return res.status(500).json({ error: 'No se pudo procesar el aviso' });
  }
};
