// Censo Mundial de Mascotas
//   GET  /api/censo                 → contador y rankings (público, se guarda 60 s en caché)
//   POST /api/censo {nombre, especie, raza, pais, email?, acepta?}  → anota una mascota y devuelve su número
// Tabla y vistas: sql/censo.sql (se pega una vez en Supabase).
const crypto = require('crypto');
const { cuerpo, db } = require('./_comun');

const ESPECIES = ['perro', 'gato', 'conejo', 'ave', 'pez', 'roedor', 'reptil', 'tortuga', 'caballo', 'cerdo', 'huron', 'otro'];
const MAX_DIA = 10;      // mascotas por celular por día, para frenar abusos
const MAX_IP_DIA = 150;  // por conexión (muchos celulares comparten la misma conexión de la compañía)
const limpio = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').replace(/https?:\/\/\S+/gi, '').replace(/\s+/g, ' ').trim().slice(0, n);
const sinTabla = e => /42P01|PGRST205|does not exist|Could not find/i.test(String(e && e.message));

module.exports = async (req, res) => {
  if (!process.env.SUPABASE_SERVICE_KEY) return res.status(503).json({ error: 'El censo todavía no está activado.' });

  if (req.method === 'GET') {
    try {
      const [resumen, especies, perros, gatos, otras, paises, nombres] = await Promise.all([
        db('GET', '/rest/v1/censo_resumen?select=*'),
        db('GET', '/rest/v1/censo_especies?select=*'),
        db('GET', '/rest/v1/censo_razas?especie=eq.perro&select=raza,n&limit=10'),
        db('GET', '/rest/v1/censo_razas?especie=eq.gato&select=raza,n&limit=10'),
        db('GET', '/rest/v1/censo_razas?especie=not.in.(perro,gato)&select=especie,raza,n&limit=10'),
        db('GET', '/rest/v1/censo_paises?select=pais,n&limit=15'),
        db('GET', '/rest/v1/censo_nombres?select=nombre,n&limit=10')
      ]);
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
      return res.status(200).json({ resumen: (resumen && resumen[0]) || { total: 0, paises: 0, semana: 0 }, especies, perros, gatos, otras, paises, nombres });
    } catch (e) {
      return res.status(503).json({ error: sinTabla(e) ? 'El censo todavía no está activado.' : 'No se pudieron cargar los números. Probá en un rato.' });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' });
  const b = cuerpo(req);
  const nombre = limpio(b.nombre, 30), raza = limpio(b.raza, 40), edad = limpio(b.edad, 12);
  const especie = ESPECIES.includes(b.especie) ? b.especie : null;
  const pais = /^[A-Z]{2}$/.test(String(b.pais || '')) ? b.pais : null;
  const email = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(String(b.email || '').trim()) ? String(b.email).trim().toLowerCase().slice(0, 120) : null;
  if (!nombre || !especie || !pais) return res.status(400).json({ error: 'Completá el nombre, qué animal es y el país.' });

  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  const ipHash = crypto.createHash('sha256').update(ip + '|' + (process.env.SUPABASE_URL || 'v360')).digest('hex').slice(0, 32);
  try {
    const disp = /^[a-z0-9]{8,16}$/.test(String(b.d || '')) ? b.d : 'x' + ipHash.slice(0, 12);
    // ¿este mismo celular ya anotó una mascota con ese nombre y ese animal? → le devolvemos su número
    const dup = await db('GET', '/rest/v1/censo?dispositivo=eq.' + disp + '&especie=eq.' + especie + '&nombre=ilike.' + encodeURIComponent(nombre.replace(/[%*,()]/g, '')) + '&select=id&limit=1');
    if (dup && dup[0]) return res.status(200).json({ numero: dup[0].id, repetida: true });
    const desde = new Date(Date.now() - 864e5).toISOString();
    const [hoyD, hoyIp] = await Promise.all([
      db('GET', '/rest/v1/censo?dispositivo=eq.' + disp + '&creado=gte.' + desde + '&select=id'),
      db('GET', '/rest/v1/censo?ip_hash=eq.' + ipHash + '&creado=gte.' + desde + '&select=id')
    ]);
    if ((hoyD && hoyD.length >= MAX_DIA) || (hoyIp && hoyIp.length >= MAX_IP_DIA)) return res.status(429).json({ error: 'Ya anotaste muchas mascotas hoy. Probá mañana.' });
    const out = await db('POST', '/rest/v1/censo', { nombre, especie, raza, pais, edad, email: b.acepta ? email : null, acepta: !!(b.acepta && email), ip_hash: ipHash, dispositivo: disp });
    return res.status(200).json({ numero: out && out[0] && out[0].id });
  } catch (e) {
    return res.status(503).json({ error: sinTabla(e) ? 'El censo todavía no está activado.' : 'No se pudo anotar. Probá de nuevo en un rato.' });
  }
};
