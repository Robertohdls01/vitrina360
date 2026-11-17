// ShopVida · QR de emergencia personal (adultos y chicos).
// Cada ficha se guarda en el almacenamiento privado de Supabase (carpeta "vida"): p/<CODIGO>.json
// Acciones:
//   POST ?accion=crear   {datos}        → crea la ficha; devuelve código y clave para editarla
//   POST ?accion=guardar {c,k,datos}    → guarda cambios (con la clave)
//   GET  ?accion=editar&c&k             → la ficha completa (con la clave)
//   GET  ?accion=ver&c                  → lo que ve quien escanea el QR (solo lo que la persona eligió mostrar)
const crypto = require('crypto');
const { cuerpo, stHeaders } = require('./_comun');

const SURL = () => String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const ST = () => SURL() + '/storage/v1';
const B = 'vida';
const hash = s => crypto.createHash('sha256').update('vida:' + String(s)).digest('hex');
const corto = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const azar = (n, abc) => Array.from(crypto.randomBytes(n), b => abc[b % abc.length]).join('');
const okCode = c => /^[A-Z0-9]{6,10}$/.test(String(c || ''));
const GRUPOS = ['', '0+', '0-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'No sé'];

let listo = false;
async function bucket() {
  if (listo) return;
  try { await fetch(ST() + '/bucket', { method: 'POST', headers: stHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ id: B, name: B, public: false }) }); } catch (e) {}
  listo = true;
}
async function leer(code) {
  try { const r = await fetch(ST() + '/object/' + B + '/p/' + code + '.json', { headers: stHeaders({ 'cache-control': 'no-cache' }) }); return r.ok ? await r.json() : null; } catch (e) { return null; }
}
async function guardarObj(code, obj) {
  const put = () => fetch(ST() + '/object/' + B + '/p/' + code + '.json', { method: 'POST', headers: stHeaders({ 'Content-Type': 'application/json', 'x-upsert': 'true', 'cache-control': 'no-cache' }), body: JSON.stringify(obj) });
  let r = await put(); if (!r.ok) { listo = false; await bucket(); r = await put(); }
  if (!r.ok) throw new Error('almacenamiento ' + r.status);
}

function limpiar(d) {
  d = d || {};
  const nene = d.tipo === 'nene';
  return {
    tipo: nene ? 'nene' : 'adulto',
    nombre: corto(d.nombre, 60),
    // En los chicos el nombre NO se muestra por defecto: un desconocido no tiene que poder llamarlo por su nombre.
    mostrarNombre: nene ? d.mostrarNombre === true : d.mostrarNombre !== false,
    edad: corto(d.edad, 20),
    grupo: GRUPOS.includes(d.grupo) ? d.grupo : '',
    alergias: corto(d.alergias, 200),
    enfermedades: corto(d.enfermedades, 200),
    remedios: corto(d.remedios, 200),
    mostrarSalud: d.mostrarSalud !== false,
    indicaciones: corto(d.indicaciones, 300),
    contactos: (Array.isArray(d.contactos) ? d.contactos : []).slice(0, 3).map(c => ({ n: corto(c && c.n, 40), rel: corto(c && c.rel, 30), tel: corto(c && c.tel, 25).replace(/[^\d+ ()-]/g, '') })).filter(c => c.n || c.tel),
    medico: corto(d.medico, 60), medicoTel: corto(d.medicoTel, 25).replace(/[^\d+ ()-]/g, ''),
    obra: corto(d.obra, 60),
  };
}
function publica(e) {
  const o = { code: e.code, tipo: e.tipo, grupo: e.grupo, alergias: e.alergias, indicaciones: e.indicaciones, contactos: e.tipo === 'nene' ? (e.contactos || []).map(c => ({ n: c.rel || 'Familia', rel: '', tel: c.tel })) : e.contactos, edad: e.tipo === 'nene' ? '' : e.edad };
  if (e.mostrarNombre) o.nombre = e.nombre;
  if (e.mostrarSalud) Object.assign(o, { enfermedades: e.enfermedades, remedios: e.remedios, medico: e.medico, medicoTel: e.medicoTel, obra: e.obra });
  return o;
}
const DEMO = 'DEMOVIDA';
const demo = () => ({ code: DEMO, tipo: 'adulto', nombre: 'Roberto (muestra)', mostrarNombre: true, edad: '45 años', grupo: '0+', alergias: 'Penicilina', enfermedades: 'Hipertensión', remedios: 'Enalapril 10 mg a la mañana', mostrarSalud: true, indicaciones: 'Si estoy desmayado, no me den nada de tomar. Llamen a mi hermano.', contactos: [{ n: 'Hermano', rel: 'hermano', tel: '+54 9 223 581-4437' }], medico: 'Dr. Ejemplo', medicoTel: '', obra: 'OSDE (ejemplo)' });

module.exports = async (req, res) => {
  const q = req.query || {}, acc = String(q.accion || '');
  try {
    if (req.method === 'POST' && acc === 'crear') {
      const b = cuerpo(req); await bucket();
      let code = ''; for (let i = 0; i < 6; i++) { code = azar(7, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'); if (!(await leer(code))) break; }
      const clave = azar(12, 'abcdefghijkmnpqrstuvwxyz23456789');
      await guardarObj(code, Object.assign(limpiar(b.datos), { code, clave: hash(clave), creado: new Date().toISOString() }));
      return res.status(200).json({ ok: true, code, clave });
    }
    const code = String(q.c || cuerpo(req).c || '').toUpperCase();
    if (!okCode(code)) return res.status(400).json({ error: 'Código inválido.' });
    if (req.method === 'GET' && acc === 'ver') {
      const e = code === DEMO ? demo() : await leer(code); if (!e) return res.status(404).json({ error: 'No encontramos esta ficha.' });
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ ok: true, ficha: publica(e) });
    }
    if (code === DEMO) return res.status(403).json({ error: 'Esta es una ficha de muestra.' });
    const e = await leer(code); if (!e) return res.status(404).json({ error: 'No encontramos esta ficha.' });
    const b = req.method === 'POST' ? cuerpo(req) : q;
    if (hash(String(b.k || '')) !== e.clave) return res.status(403).json({ error: 'La clave no es correcta.' });
    if (req.method === 'GET' && acc === 'editar') { const f = Object.assign({}, e); delete f.clave; res.setHeader('Cache-Control', 'no-store'); return res.status(200).json({ ok: true, ficha: f }); }
    if (req.method === 'POST' && acc === 'guardar') {
      await guardarObj(code, Object.assign(limpiar(b.datos), { code, clave: e.clave, creado: e.creado, cambiado: new Date().toISOString() }));
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: 'Acción inválida.' });
  } catch (err) { return res.status(500).json({ error: 'Algo falló. Probá de nuevo.' }); }
};
