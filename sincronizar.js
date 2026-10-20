// Vitrina 360 · todos los días a la mañana revisa en Mercado Pago quién pagó y extiende su tienda.
const { db, sincronizar } = require('./_comun');
module.exports = async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== 'Bearer ' + secret) return res.status(401).json({ error: 'No autorizado' });
  if (!process.env.MP_ACCESS_TOKEN || !process.env.SUPABASE_SERVICE_KEY) return res.status(200).json({ revisadas: 0 });
  const rows = await db('GET', '/rest/v1/tiendas?mp_suscripcion=not.is.null&select=owner,slug,pagada_hasta,plan,mp_suscripcion,mp_plan,mp_anterior');
  let ok = 0, fallas = 0;
  for (const row of rows || []) { try { await sincronizar(row); ok++; } catch (e) { fallas++; } }
  return res.status(200).json({ revisadas: ok, fallas });
};
