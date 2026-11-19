// ShopFamilia · "Flashy organiza tu familia, y la hace más divertida"
// Cada familia tiene un código; cada integrante entra desde su celular y guarda su clave en el teléfono.
//   POST ?accion=crear     {familia, nombre, emoji}                 → {code, mid, k, pin}   (quien crea es mamá/papá)
//   POST ?accion=unirse    {code, nombre, emoji, pin?}              → {mid, k}              (con el PIN entra como mamá/papá)
//   GET  ?code&mid&k                                                → la familia (miembros, estrellas, avisos)
//   POST ?accion=enviar    {code,mid,k, para, texto, tipo, min, estrellas, humor}   aviso / tarea / flor
//   POST ?accion=preguntar {code,mid,k, texto, hist}  → {texto}  Flashy con IA (ANTHROPIC_API_KEY, tope LIMITE_FAMILIA_IA por familia por mes)
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
    if (a === 'preguntar') {
      const KEY = process.env.ANTHROPIC_API_KEY; if (!KEY) return res.status(503).json({ error: 'Flashy todavía no puede pensar. Probá más tarde.' });
      const preg = String(b.texto || '').trim().slice(0, 600); if (!preg) return res.status(400).json({ error: 'Escribí tu pregunta.' });
      const mes = new Date().toISOString().slice(0, 7), lim = Math.max(0, Number(process.env.LIMITE_FAMILIA_IA || 300));
      if (F.iaMes !== mes) { F.iaMes = mes; F.iaUsadas = 0; }
      if (F.iaUsadas >= lim) return res.status(429).json({ error: `Este mes ya me hicieron ${lim} preguntas. El día 1 vuelvo a tener ganas de charlar 😄` });
      const hist = (Array.isArray(b.hist) ? b.hist : []).slice(-6).filter(h => h && ['user', 'assistant'].includes(h.role) && typeof h.content === 'string').map(h => ({ role: h.role, content: h.content.slice(0, 1200) }));
      while (hist.length && hist[0].role !== 'user') hist.shift();
      const chico = yo.rol !== 'padre', nombres = F.miembros.map(m => m.nombre + (m.rol === 'padre' ? ' (mamá/papá)' : ' (hijo/a)')).join(', ');
      const sys = `Sos Flashy, el ayudante simpático de la familia ${F.familia} en la app ShopFamilia (de Pro Video JSRHG). Hablás en castellano rioplatense (Argentina), con calidez y buen humor, como alguien más de la casa.
Integrantes: ${nombres}. Te está hablando ${yo.nombre}${chico ? ', que es un chico o una chica: usá palabras simples y contenido apto para chicos' : ''}.
Ayudás con la vida de la casa: recetas y comidas con lo que hay en la heladera, tareas del colegio (explicá paso a paso para que aprendan, no les hagas la tarea entera), juegos, ideas para salir, orden y limpieza, consejos para convivir mejor.
Tus respuestas se leen en voz alta: sé breve (máximo 120 palabras), sin tablas ni markdown, sin asteriscos ni numerales. Para recetas: primero los ingredientes en una línea, después pasos cortos numerados "1.", "2.". Usá ingredientes y medidas que se consiguen en Argentina.
Si es algo de salud o una emergencia, decí que hablen con un adulto o con un médico (en emergencia: 107 o 911). Si te piden algo peligroso o no apto para chicos, decí amablemente que no.`;
      const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: process.env.IA_MODEL_TEXT || 'claude-haiku-5-5', max_tokens: 600, system: sys, messages: [...hist, { role: 'user', content: preg }] }) });
      if (!r.ok) return res.status(502).json({ error: 'Me distraje un segundo 😅 Preguntame de nuevo.' });
      const j = await r.json(), txt = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('').replace(/[*#_`]/g, '').trim();
      F.iaUsadas = (F.iaUsadas || 0) + 1; await guardar(code, F);
      return res.status(200).json({ ok: true, texto: txt });
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
