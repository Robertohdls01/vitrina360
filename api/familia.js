// ShopFamilia · "Flashy organiza tu familia, y la hace más divertida"
// Cada familia tiene un código; cada integrante entra desde su celular y guarda su clave en el teléfono.
//   POST ?accion=crear     {familia, nombre, emoji}                 → {code, mid, k, pin}   (quien crea es mamá/papá)
//   POST ?accion=unirse    {code, nombre, emoji, pin?}              → {mid, k}              (con el PIN entra como mamá/papá)
//   GET  ?code&mid&k                                                → la familia (miembros, estrellas, avisos)
//   POST ?accion=enviar    {code,mid,k, para, texto, tipo, min, estrellas, humor}   aviso / tarea / flor
//   POST ?accion=pin    {code,mid,k}  → {pin} nuevo PIN de mamá/papá (solo padres)
//   POST ?accion=cuarto {code,mid,k, cuarto}  '' (con la familia) · tele · tarea · dormir · jugar · musica · solo
//   POST ?accion=responder {code,mid,k, aid, estado, txt}           visto · voy · listo
//   POST ?accion=aprobar   {code,mid,k, aid, quien}                 mamá/papá aprueba la tarea → suma estrellas
const crypto = require('crypto');
const { cuerpo } = require('./_comun');

const BUCKET = 'pedidos';
const base = () => String(process.env.SUPABASE_URL || '').replace(/\/+$/, '') + '/storage/v1';
const head = extra => { const k = process.env.SUPABASE_SERVICE_KEY, h = Object.assign({ apikey: k }, extra || {}); if (String(k).startsWith('eyJ')) h.Authorization = 'Bearer ' + k; return h; };
const t = (v, n) => String(v == null ? '' : v).slice(0, n);
const hash = s => crypto.createHash('sha256').update('shopfamilia|' + s).digest('hex');
const okCode = c => /^[A-Z0-9]{6}$/.test(String(c || ''));
async function leer(code) { const r = await fetch(base() + '/object/' + BUCKET + '/familias/' + code + '.json', { headers: head({ 'cache-control': 'no-cache' }) }); return r.ok ? r.json().catch(() => null) : null; }
async function guardar(code, obj) {
  const r = await fetch(base() + '/object/' + BUCKET + '/familias/' + code + '.json', { method: 'POST', headers: head({ 'Content-Type': 'application/json', 'x-upsert': 'true', 'cache-control': 'no-cache' }), body: JSON.stringify(obj) });
  if (!r.ok) throw new Error('No se pudo guardar.');
}
const nuevoId = () => crypto.randomBytes(5).toString('hex');
const EMOJIS = ['👩', '👨', '👧', '👦', '👶', '👵', '👴', '🧑', '🐶', '🐱', '⭐', '🦄', '⚽', '🎮', '🌸', '🦖'];
const emo = e => EMOJIS.includes(e) ? e : '🙂';
function publica(F) {
  return { code: F.code, familia: F.familia, miembros: F.miembros.map(m => ({ id: m.id, nombre: m.nombre, emoji: m.emoji, rol: m.rol, estrellas: m.estrellas || 0, mes: m.mes || 0, cuarto: m.cuarto || '' })),
    avisos: F.avisos.slice(0, 60) };
}
function quien(F, b) { const m = F.miembros.find(x => x.id === String(b.mid || '')); return m && m.k === hash(String(b.k || '')) ? m : null; }

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!process.env.SUPABASE_SERVICE_KEY) return res.status(503).json({ error: 'ShopFamilia no está configurado.' });
    const q = req.query || {}, a = q.accion || '';

    if (req.method === 'GET') {
      const code = String(q.code || '').toUpperCase(); if (!okCode(code)) return res.status(400).json({ error: 'Código inválido.' });
      const F = await leer(code); if (!F) return res.status(404).json({ error: 'No encontramos esa familia.' });
      if (q.mid) { const m = quien(F, q); if (!m) return res.status(403).json({ error: 'No reconocemos este celular. Volvé a entrar con el código.' }); return res.status(200).json(publica(F)); }
      return res.status(200).json({ familia: F.familia }); // solo el nombre, para la pantalla de unirse
    }
    const b = cuerpo(req);

    if (a === 'crear') {
      const familia = t(b.familia, 40).trim(), nombre = t(b.nombre, 20).trim();
      if (!familia || !nombre) return res.status(400).json({ error: 'Poné el nombre de la familia y el tuyo.' });
      let code = ''; for (let i = 0; i < 6; i++) { code = Array.from(crypto.randomBytes(6)).map(x => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[x % 32]).join(''); if (!(await leer(code))) break; }
      const pin = String(1000 + crypto.randomInt(9000)), k = crypto.randomBytes(12).toString('hex'), mid = nuevoId();
      const F = { code, familia, pin: hash(pin), creado: new Date().toISOString(), miembros: [{ id: mid, nombre, emoji: emo(b.emoji), rol: 'padre', k: hash(k), estrellas: 0 }],
        avisos: [{ id: nuevoId(), de: mid, para: 'todos', texto: `¡Bienvenidos a ${/^familia\b/i.test(familia) ? 'la ' + familia : 'la familia ' + familia}! Desde ahora les aviso todo yo 😄`, tipo: 'sumo', creado: new Date().toISOString(), resp: {} }] };
      await guardar(code, F);
      return res.status(200).json({ code, mid, k, pin });
    }

    const code = String(b.code || '').toUpperCase(); if (!okCode(code)) return res.status(400).json({ error: 'Código inválido.' });
    const F = await leer(code); if (!F) return res.status(404).json({ error: 'No encontramos esa familia. Revisá el código.' });

    if (a === 'unirse') {
      const nombre = t(b.nombre, 20).trim(); if (!nombre) return res.status(400).json({ error: 'Poné tu nombre.' });
      if (F.miembros.length >= 15) return res.status(400).json({ error: 'La familia ya tiene 15 integrantes.' });
      const padre = !!b.pin && hash(String(b.pin)) === F.pin; if (b.pin && !padre) return res.status(403).json({ error: 'El PIN de mamá/papá no es correcto.' });
      const k = crypto.randomBytes(12).toString('hex'), mid = nuevoId();
      F.miembros.push({ id: mid, nombre, emoji: emo(b.emoji), rol: padre ? 'padre' : 'hijo', k: hash(k), estrellas: 0 });
      F.avisos.unshift({ id: nuevoId(), de: mid, para: 'todos', tipo: 'sumo', texto: `${nombre} se sumó a la familia 🎉`, creado: new Date().toISOString(), resp: {} });
      await guardar(code, F);
      return res.status(200).json({ mid, k });
    }

    const yo = quien(F, b); if (!yo) return res.status(403).json({ error: 'No reconocemos este celular. Volvé a entrar con el código.' });

    if (a === 'enviar') {
      const tipo = ['aviso', 'tarea', 'flor', 'corazon'].includes(b.tipo) ? b.tipo : 'aviso';
      if (tipo === 'tarea' && yo.rol !== 'padre') return res.status(403).json({ error: 'Las tareas las mandan mamá o papá.' });
      const para = b.para === 'todos' || F.miembros.some(m => m.id === b.para) ? b.para : 'todos';
      const texto = t(b.texto, 200).trim(); if (!texto && tipo !== 'flor' && tipo !== 'corazon') return res.status(400).json({ error: 'Escribí el aviso.' });
      const av = { id: nuevoId(), de: yo.id, para, tipo, texto, creado: new Date().toISOString(), resp: {} };
      if (tipo === 'tarea') { av.estrellas = Math.max(1, Math.min(5, parseInt(b.estrellas, 10) || 1)); const mn = parseInt(b.min, 10); if (mn > 0) av.min = Math.min(180, mn); }
      if (yo.rol === 'padre' && ['enojado', 'contento'].includes(b.humor)) av.humor = b.humor;
      F.avisos.unshift(av); F.avisos = F.avisos.slice(0, 120);
      await guardar(code, F);
      return res.status(200).json({ ok: true, aid: av.id });
    }
    if (a === 'pin') {
      if (yo.rol !== 'padre') return res.status(403).json({ error: 'Solo mamá/papá.' });
      const pin = String(1000 + crypto.randomInt(9000)); F.pin = hash(pin); await guardar(code, F);
      return res.status(200).json({ ok: true, pin });
    }
    if (a === 'cuarto') {
      const ACT = ['', 'galpon', 'cocina', 'tele', 'tarea', 'dormir', 'jugar', 'musica', 'solo'];
      yo.cuarto = ACT.includes(b.cuarto) ? b.cuarto : ''; await guardar(code, F);
      return res.status(200).json({ ok: true });
    }
    if (a === 'responder') {
      const av = F.avisos.find(x => x.id === String(b.aid || '')); if (!av) return res.status(404).json({ error: 'No encontramos ese aviso.' });
      if (av.para !== 'todos' && av.para !== yo.id) return res.status(403).json({ error: 'Ese aviso no es para vos.' });
      const estado = ['visto', 'voy', 'listo'].includes(b.estado) ? b.estado : 'visto', prev = av.resp[yo.id];
      if (prev && prev.estado === 'aprobado') return res.status(200).json({ ok: true });
      av.resp[yo.id] = { estado: prev && estado === 'visto' ? prev.estado : estado, txt: t(b.txt, 120) || (prev && prev.txt) || '', t: new Date().toISOString() };
      await guardar(code, F);
      return res.status(200).json({ ok: true });
    }
    if (a === 'aprobar') {
      if (yo.rol !== 'padre') return res.status(403).json({ error: 'Solo mamá o papá aprueban las tareas.' });
      const av = F.avisos.find(x => x.id === String(b.aid || '')); const m = F.miembros.find(x => x.id === String(b.quien || ''));
      if (!av || !m || av.tipo !== 'tarea') return res.status(404).json({ error: 'No encontramos esa tarea.' });
      const r = av.resp[m.id] || {}; if (r.estado === 'aprobado') return res.status(200).json({ ok: true });
      av.resp[m.id] = Object.assign(r, { estado: 'aprobado', t: new Date().toISOString() });
      const mes = new Date().toISOString().slice(0, 7); if (m.mesId !== mes) { m.mesId = mes; m.mes = 0; }
      m.estrellas = (m.estrellas || 0) + (av.estrellas || 1); m.mes = (m.mes || 0) + (av.estrellas || 1);
      await guardar(code, F);
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: 'Acción no válida.' });
  } catch (e) {
    console.error('familia', e && e.message);
    return res.status(500).json({ error: 'Algo falló. Probá de nuevo.' });
  }
};
