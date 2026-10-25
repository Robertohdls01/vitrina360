// Vitrina 360 · estado de la suscripción del comerciante que está en su panel.
const { usuario, db, sincronizar, estado, PRECIO, PLANES, hmPendiente, hmBorrar, aplicarPago } = require('./_comun');
module.exports = async (req, res) => {
  try {
    if (!process.env.SUPABASE_SERVICE_KEY) return res.status(200).json({ configurado: false });
    const u = await usuario(req);
    if (!u) return res.status(401).json({ error: 'Tenés que entrar a tu tienda.' });
    const rows = await db('GET', '/rest/v1/tiendas?owner=eq.' + u.id + '&select=owner,slug,prueba_hasta,pagada_hasta,activa,plan,mp_suscripcion,mp_plan,mp_anterior');
    let row = rows && rows[0];
    if (!row) return res.status(404).json({ error: 'Todavía no creaste tu tienda.' });
    try { row = await sincronizar(row); } catch (e) { /* si Mercado Pago no responde, se usa lo guardado */ }
    // Compró por Hotmart antes de crear su tienda: se activa ahora con el mismo mail.
    if (u.email && !(row.pagada_hasta && Date.parse(row.pagada_hasta) > Date.now())) {
      try {
        const pend = await hmPendiente(u.email);
        if (pend && pend.hasta && Date.parse(pend.hasta) > Date.now()) {
          const out = await aplicarPago(u.id, pend.plan, pend.hasta);
          row = Object.assign({}, row, out && out[0] ? out[0] : { pagada_hasta: pend.hasta, plan: pend.plan || row.plan });
          await hmBorrar(u.email);
        }
      } catch (e) { /* si falla, se reintenta la próxima vez */ }
    }
    const e = estado(row);
    return res.status(200).json(Object.assign({ configurado: true, mp: !!process.env.MP_ACCESS_TOKEN, precio: PRECIO(), planes: PLANES(), suscripto: !!row.mp_suscripcion, mp_estado: row.mp_estado || null, prueba_hasta: row.prueba_hasta, pagada_hasta: row.pagada_hasta }, e));
  } catch (e) {
    return res.status(500).json({ error: 'No se pudo ver el estado de tu cuenta.' });
  }
};
