// Vitrina 360 · Shopping: todas las tiendas Plus y Pro que eligieron aparecer, en un solo lugar.
//   GET /api/shopping → { tiendas: [{slug, nombre, logo, rubro, zona, ig}] }
// Aparece una tienda cuando el comerciante prendió "Aparecer en el Shopping" y tiene plan Plus o Pro pagado (o está en la prueba gratis).
const { db } = require('./_comun');

const RUBROS = { general: 'General', belleza: 'Belleza y cosmética', electro: 'Electrónica', moda: 'Ropa y moda', joyas: 'Bijouterie y joyería', almacen: 'Almacén y kiosco', ferreteria: 'Ferretería', mascotas: 'Mascotas', deportes: 'Deportes', libreria: 'Librería y regalería', hogar: 'Hogar y deco', casero: 'Comida casera', peluqueria: 'Peluquería y barbería', estetica: 'Estética y uñas', canina: 'Peluquería canina' };
const corto = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

module.exports = async (req, res) => {
  if (!process.env.SUPABASE_SERVICE_KEY) return res.status(503).json({ error: 'Todavía no está configurado.' });
  try {
    const paths = [0, 1, 2, 3].map(i => `b${i}:data->stores->${i}->brand`).join(',');
    const or = [0, 1, 2, 3].map(i => `data->stores->${i}->brand->>shopping.eq.true`).join(',');
    const rows = await db('GET', `/rest/v1/tiendas?select=slug,nombre,plan,pagada_hasta,prueba_hasta,activa,${paths}&or=(${or})&limit=500`) || [];
    const now = Date.now(), out = [];
    for (const r of rows) {
      if (r.activa === false) continue;
      const pago = r.pagada_hasta && Date.parse(r.pagada_hasta) > now && (r.plan === 'comercio' || r.plan === 'pro');
      const prueba = !(r.pagada_hasta && Date.parse(r.pagada_hasta) > now) && r.prueba_hasta && Date.parse(r.prueba_hasta) > now;
      if (!pago && !prueba) continue;
      [r.b0, r.b1, r.b2, r.b3].forEach((b, i) => {
        if (!b || b.shopping !== true) return;
        const logo = typeof b.logo === 'string' && /^https:\/\//.test(b.logo) ? b.logo : '';
        out.push({ slug: r.slug, tienda: i, nombre: corto(b.name || r.nombre || r.slug, 60), logo, rubro: RUBROS[b.preset] || 'General', zona: corto(b.addr, 80), ig: corto(String(b.ig || '').replace(/^@/, ''), 40), destacada: r.plan === 'pro' && !!pago });
      });
    }
    // primero las Pro, después el resto; dentro de cada grupo, al azar para que todas tengan su lugar
    out.sort((a, b) => (b.destacada - a.destacada) || (Math.random() - 0.5));
    res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=600');
    return res.status(200).json({ tiendas: out });
  } catch (e) {
    return res.status(500).json({ error: 'No se pudo cargar el Shopping.' });
  }
};
