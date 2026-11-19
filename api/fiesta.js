// ShopFiesta · invitaciones virtuales con confirmación y app de la fiesta.
// La fiesta se guarda en el almacenamiento privado de Supabase (carpeta "fiestas"):  e/<CODIGO>.json
// Las respuestas de los invitados van en la tabla fiesta_resp (una fila por invitado, así 200 pueden confirmar a la vez).
// Acciones:
//   POST ?accion=crear     {datos}                 (público)       → crea la fiesta; devuelve código y clave del panel
//   POST ?accion=guardar   {f,k,datos}             (la familia)    → guarda diseño, datos e invitados
//   GET  ?accion=panel&f&k                          (la familia)    → todo + las confirmaciones
//   GET  ?accion=ver&f[&i=TOKEN]                    (invitados)     → la invitación (y quién es, si viene con su link)
//   GET  ?accion=buscar&f&q                         (invitados)     → buscar su nombre (link general)
//   POST ?accion=responder {f,i,va,cuantos,menu,nota} (invitados)   → confirma o avisa que no va
//   GET  ?manifest=CODIGO  /  ?icono=CODIGO                         → para guardar la fiesta como app en el celular
const crypto = require('crypto');
const { cuerpo, stHeaders, usuario } = require('./_comun');

const SURL = () => String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const ST = () => SURL() + '/storage/v1';
const B = 'fiestas';
const DEMO = 'DEMO15', DEMOBAR = 'DEMOBAR';
const corto = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const largo = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u0009\u000b-\u001f]/g, ' ').trim().slice(0, n);
const hash = s => crypto.createHash('sha256').update('fiesta:' + String(s)).digest('hex');
const AYUDA = '🆘 Ayuda urgente', SEGU = '🛡 Seguridad';
const esUrg = n => n === AYUDA || n === SEGU;
// Boliche / bar / peña: evento abierto todas las noches, sin lista de invitados (cualquiera escanea, pone su nombre y pide a la barra)
const esAbierto = e => !!(e && e.tipo === 'boliche');
const nocheDe = () => new Date(Date.now() - 3 * 3600e3 - 12 * 3600e3).toISOString().slice(0, 10); // la noche empieza el día anterior si son las 2 de la mañana
const invDe = (e, tok, nom, mesa) => { tok = String(tok || ''); const g = (e.invitados || []).find(x => x.tok === tok); if (g) return g;
  const m = tok.match(/^c:([a-z0-9]{10,24})$/); return esAbierto(e) && m ? { id: 'c_' + m[1], nombre: corto(nom, 40) || 'Cliente', mesa: corto(mesa, 12), anon: true } : null; };
const skDe = e => e && e.pk ? hash(e.pk + ':salud').slice(0, 14) : ''; // link del servicio médico (solo ve los pedidos de ayuda)
const gkDe = e => e && e.pk ? hash(e.pk + ':seguridad').slice(0, 14) : ''; // link de los de seguridad (solo ve los llamados a seguridad)
const akDe = e => e && e.pk ? hash(e.pk + ':autos').slice(0, 14) : ''; // link del personal que cuida los autos (no ve los pedidos)
const okCode = c => /^[A-Z0-9]{4,12}$/.test(String(c || ''));
const azar = (n, abc) => { const b = crypto.randomBytes(n); let s = ''; for (let i = 0; i < n; i++) s += abc[b[i] % abc.length]; return s; };
const sinTildes = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const LOOK_DE = {'15': 'traje', casamiento: 'claro', cumple: 'fiesta', bautismo: 'claro', comunion: 'claro', egresados: 'fiesta', boliche: 'fiesta', otro: 'traje'};
const PLANTILLAS = ['elegante', 'flores', 'brillos', 'moderna', 'mariposas', 'luna'];
const MODOS = ['especial', 'comun', 'link'];
const TIPOS = ['15', 'casamiento', 'cumple', 'bautismo', 'comunion', 'egresados', 'boliche', 'otro'];
const MENUS = ['', 'vegetariano', 'vegano', 'sin TACC', 'infantil', 'otro'];
const ADMINS = () => String(process.env.ADMIN_EMAILS || process.env.IA_SIN_LIMITE || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
const EN_VIVO = () => process.env.FIESTA_EN_VIVO === '1'; // los paquetes con la fiesta en vivo se venden cuando esté lista
// Paquetes para la familia (precios cambiables desde Vercel). "extra" = recargo por más de 150 invitados (solo en los de fiesta en vivo).
const PAQ = () => ({
  invitacion: { nombre: 'Invitación', precio: Number(process.env.PRECIO_FIESTA_INV || 35000), disponible: true, incluye: 'Invitación virtual, confirmaciones, links por WhatsApp e ícono en el celular' },
  completa: { nombre: 'Fiesta completa', precio: Number(process.env.PRECIO_FIESTA_COMPLETA || 100000), disponible: EN_VIVO(), vivo: true, incluye: 'Invitación + recepción, mesas, pedidos a las mozas, avisos de comida y vals, panel en vivo' },
  recuerdos: { nombre: 'Fiesta completa + recuerdos', precio: Number(process.env.PRECIO_FIESTA_RECUERDOS || 140000), disponible: EN_VIVO(), vivo: true, incluye: 'Todo lo anterior + álbum de fotos, cuadro de firmas y resumen de la noche' }
});
const EXTRA150 = () => Number(process.env.PRECIO_FIESTA_EXTRA150 || 25000);
const montoDe = (paq, e) => { const P = PAQ()[paq]; if (!P) return 0; return P.precio + (P.vivo && (e.invitados || []).length > 150 ? EXTRA150() : 0); };
async function mpGet(path) {
  const tok = String(process.env.MP_ACCESS_TOKEN || '').trim(); if (!tok) return null;
  const r = await fetch('https://api.mercadopago.com' + path, { headers: { Authorization: 'Bearer ' + tok } });
  return r.ok ? r.json().catch(() => null) : null;
}
const marcarPago = (e, paq, pid, monto, manual) => { e.pagado = true; e.paquete = paq; e.pagos = (e.pagos || []).concat([{ paquete: paq, id: pid || '', monto: monto || 0, t: new Date().toISOString(), manual: !!manual }]); };
// Revisa en Mercado Pago si la fiesta tiene un pago aprobado que todavía no se marcó (por si el aviso no llegó).
async function revisarPago(e) {
  if (!e.pagoRef) return false;
  const j = await mpGet('/v1/payments/search?external_reference=' + encodeURIComponent(e.pagoRef) + '&sort=date_created&criteria=desc&limit=5');
  const ok = j && Array.isArray(j.results) && j.results.find(x => x.status === 'approved');
  if (!ok || (e.pagos || []).some(p => p.id === String(ok.id))) return false;
  marcarPago(e, e.pagoRef.split('/')[2], String(ok.id), ok.transaction_amount); delete e.pagoRef; return true;
}

let listo = false;
async function bucket() {
  if (listo) return;
  try { await fetch(ST() + '/bucket', { method: 'POST', headers: stHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ id: B, name: B, public: false }) }); } catch (e) {}
  listo = true;
}
async function leer(code) {
  try { const r = await fetch(ST() + '/object/' + B + '/e/' + code + '.json', { headers: stHeaders({ 'cache-control': 'no-cache' }) }); return r.ok ? await r.json() : null; } catch (e) { return null; }
}
async function guardarObj(code, obj) {
  const put = () => fetch(ST() + '/object/' + B + '/e/' + code + '.json', { method: 'POST', headers: stHeaders({ 'Content-Type': 'application/json', 'x-upsert': 'true', 'cache-control': 'no-cache' }), body: JSON.stringify(obj) });
  let r = await put(); if (!r.ok) { listo = false; await bucket(); r = await put(); }
  if (!r.ok) throw new Error('almacenamiento ' + r.status);
}
async function rest(method, path, body, prefer) {
  const h = stHeaders({ 'Content-Type': 'application/json' }); if (prefer) h.Prefer = prefer;
  const r = await fetch(SURL() + '/rest/v1/' + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {}
  if (!r.ok) throw new Error('db ' + r.status + ' ' + String((j && j.message) || t).slice(0, 160));
  return j;
}

// Bar de muestra (ShopEventos Boliche) para mostrar a los dueños de boliches, bares y peñas.
const demoBar = () => ({
  code: DEMOBAR, demo: true, tipo: 'boliche', modo: 'especial', plantilla: 'elegante', color: '#2f8f83', titulo: 'Esta noche', nombre: 'Bar de Prueba', frase: '',
  salon: 'Bar de Prueba', direccion: 'Mar del Plata', pk: 'demobar', paquete: 'completa', pagado: true, autos: true, salud: true, saludNom: 'Emergencias del bar', seguridad: true, seguNom: 'Seguridad del bar', mozas: [], modoP: 'encargada', flLook: 'fiesta',
  carta: [{ n: 'Fernet con coca', p: '$5.000', alc: true }, { n: 'Cerveza tirada', p: '$4.000', alc: true }, { n: 'Gin tonic', p: '$6.000', alc: true }, { n: 'Daiquiri de frutilla', p: '$5.500', alc: true }, { n: 'Coca-Cola', p: '$2.500' }, { n: 'Agua sin gas', p: '$2.000' }, { n: 'Energizante', p: '$3.500' }, { n: 'Hielo', p: 'Sin cargo' }],
  crono: [{ h: '23:30', t: 'Abre la barra', a: '🍹 ¡Ya abrió la barra! Pedí desde acá sin hacer fila.', m: 0 }, { h: '00:30', t: 'Happy hour', a: '🍻 Happy hour hasta la 1: 2x1 en cerveza tirada.', m: 0 }, { h: '01:30', t: 'Sube el DJ', a: '🎧 En 15 minutos sube el DJ. ¡A la pista!', m: 15 }, { h: '04:30', t: 'Última ronda', a: '⏰ Última ronda: pedí ahora tu último trago.', m: 15 }],
  lugares: [{ n: 'Barra', d: 'al fondo, a la derecha de la pista' }, { n: 'Baños', d: 'subiendo la escalera, a la izquierda' }, { n: 'Salida de emergencia', d: 'detrás de la cabina del DJ' }, { n: 'Guardarropa', d: 'a la entrada, a la izquierda' }],
  estaciona: 'Hay una cochera a media cuadra, abierta toda la noche.', invitados: [], avisos: []
});
const demoDe = c => c === DEMOBAR ? demoBar() : demoData();
// Fiesta de muestra para mostrar a los clientes (no se guarda nada).
const demoData = () => ({
  code: DEMO, demo: true, tipo: '15', modo: 'especial', plantilla: 'elegante', color: '#c9a227',
  titulo: 'Mis 15', nombre: 'Julieta', frase: 'Hay momentos que no se olvidan. Quiero compartir este con vos.',
  fecha: proxSabado(), hora: '21:30', salon: 'Salón de ejemplo', direccion: 'Mar del Plata',
  vestimenta: 'Elegante sport', estaciona: 'El salón tiene estacionamiento propio sin cargo. Si se llena, hay una cochera a media cuadra.', regalo: 'Lluvia de sobres o alias: JULI.15.FIESTA', mostrarMesa: true, pedirMenu: true,
  catering: 'Catering de ejemplo', mozas: ['Karina', 'Sofía', 'Lucía'], autos: true, salud: true, saludNom: 'Ambulancia de ejemplo', modoP: 'encargada', pk: 'demo', paquete: 'recuerdos', pagado: true,
  carta: CARTA_BASE(), crono: CRONO_BASE('21:30'), lugares: [{ n: 'Mesa de regalos', d: 'entrando, a la izquierda, al lado del cuadro de firmas' }, { n: 'Baños', d: 'al fondo del salón, pasando la pista a la derecha' }, { n: 'Barra', d: 'al lado de la pista, frente al DJ' }, { n: 'Rincón de fotos', d: 'junto a la entrada, con las luces' }],
  foto: FOTO_DEMO(), historia: HIST_DEMO(), abre: 'relicario', vitNom: ['Mi familia', 'Mis amigas', 'Mis abuelos', 'Yo'], invitados: [
    { id: 'g1', nombre: 'Roberto Hernández', mesa: '2', menor: false, cupo: 1, tok: 'demoroberto' },
    { id: 'g2', nombre: 'Marta Gómez', mesa: '2', menor: false, cupo: 0, tok: 'demomarta' },
    { id: 'g3', nombre: 'Sofía Pérez', mesa: '7', menor: true, cupo: 0, tok: 'demosofia' },
    { id: 'g4', nombre: 'José Martínez', mesa: '3', menor: false, cupo: 2, tok: 'demojose' }
  ]
});
// Fotos de ejemplo para la vitrina de la muestra (dibujos, sin personas reales).
const HIST_DEMO = () => [['2011 · 1 añito', 3], ['2013 · Mis 3 años', 3], ['2016 · Primer día de clases', 1], ['2018 · Danza', 3], ['2020 · Mis 10', 0], ['2022 · Con mis amigas', 1], ['2023 · Con la abuela', 2], ['2025 · Mis 14', 3], ['2026 · Hoy, mis 15 ✨', 3]].map(([txt, g], k) => ({ txt, g, img: '/demo15/' + (k + 1) + '.jpg' }));
const FOTO_DEMO = () => '/demo15/foto.jpg';
const CARTA_BASE = () => ['Coca-Cola', 'Coca-Cola Zero', 'Sprite', 'Agua sin gas', 'Agua con gas', 'Jugo de naranja', 'Trago sin alcohol', 'Fernet con coca*', 'Cerveza*', 'Vino tinto*', 'Vino blanco*', 'Champagne*', 'Hielo', 'Pan', 'Servilletas', 'Que limpien la mesa'].map(n => ({ n: n.replace('*', ''), alc: n.endsWith('*') }));
const CRONO_BASE = h0 => { const [H, M] = String(h0 || '21:30').split(':').map(Number), at = mins => { const t = (H * 60 + M + mins) % 1440; return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'); };
  return [[0, 'Recepción', 'Bienvenidos 🎉 Buscá tu mesa y pedí lo que quieras desde acá.', 0], [45, 'Entrada de la quinceañera', '✨ En 15 minutos entra la quinceañera. ¡Vení al salón!', 15], [60, 'Entrada (comida)', '🍽 Ya sale la entrada. Volvé a tu mesa.', 5], [120, 'Plato principal', '🍽 En 10 minutos sale el plato principal. Volvé a tu mesa.', 10], [180, 'Vals', '💃 En 15 minutos empieza el vals. ¡No te lo pierdas!', 15], [200, '¡A bailar!', '🪩 ¡A bailar! Se abre la pista para todos.', 0], [240, 'Ceremonia de velas', '🕯 En 15 minutos es la ceremonia de velas.', 15], [260, 'Brindis', '🥂 Se viene el brindis. ¡Llená tu copa!', 10], [270, 'Torta y mesa dulce', '🎂 Se acerca la hora de cortar la torta, y abre la mesa dulce. ¡Vení!', 0], [420, 'Fin de fiesta y souvenirs', '🎁 Antes de irte, retirá tu souvenir. ¡Gracias por venir!', 0]].map(([d, t, a, m]) => ({ h: at(d), t, a, m })); };
function proxSabado() { const d = new Date(Date.now() - 3 * 3600e3); d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7 || 7) + 21); return d.toISOString().slice(0, 10); }

// Limpia lo que manda el panel. Conserva los links (tokens) de los invitados que ya existían.
function limpiar(d, prev) {
  d = d || {}; prev = prev || {};
  const o = {
    tipo: TIPOS.includes(d.tipo) ? d.tipo : '15',
    modo: MODOS.includes(d.modo) ? d.modo : 'especial',
    plantilla: PLANTILLAS.includes(d.plantilla) ? d.plantilla : 'elegante',
    color: /^#[0-9a-fA-F]{6}$/.test(String(d.color || '')) ? d.color : '#c9a227',
    titulo: corto(d.titulo, 40) || 'Mis 15', nombre: corto(d.nombre, 40), frase: largo(d.frase, 220),
    fecha: /^\d{4}-\d{2}-\d{2}$/.test(String(d.fecha || '')) ? d.fecha : '', hora: /^\d{2}:\d{2}$/.test(String(d.hora || '')) ? d.hora : '',
    salon: corto(d.salon, 80), direccion: corto(d.direccion, 120), vestimenta: corto(d.vestimenta, 80), regalo: largo(d.regalo, 200), estaciona: largo(d.estaciona, 240),
    mostrarMesa: !!d.mostrarMesa, pedirMenu: d.pedirMenu !== false, autos: !!d.autos, salud: !!d.salud, saludNom: corto(d.saludNom, 50), saludTel: corto(d.saludTel, 30), seguridad: !!d.seguridad, seguNom: corto(d.seguNom, 50), organiza: corto(d.organiza, 60),
    // catering y mozas: se usan el día de la fiesta ("Ya va Karina a tu mesa")
    catering: corto(d.catering, 60), cateringTel: corto(d.cateringTel, 20).replace(/[^\d+]/g, ''),
    mozas: (Array.isArray(d.mozas) ? d.mozas : []).map(x => corto(x, 30)).filter(Boolean).slice(0, 40),
    // fiesta en vivo: lo que se puede pedir a la mesa, el cronograma de la noche y cómo trabaja el personal
    carta: (Array.isArray(d.carta) ? d.carta : []).slice(0, 80).map(x => Object.assign({ n: corto(x && x.n, 40), alc: !!(x && x.alc) }, x && x.p ? { p: corto(x.p, 16) } : {})).filter(x => x.n),
    crono: (Array.isArray(d.crono) ? d.crono : []).slice(0, 30).map(x => ({ h: /^\d{2}:\d{2}$/.test(String(x && x.h)) ? x.h : '', t: corto(x && x.t, 60), a: corto(x && x.a, 140), m: [0, 5, 10, 15, 30, 60].includes(+(x && x.m)) ? +x.m : 10 })).filter(x => x.h && x.t),
    lugares: (Array.isArray(d.lugares) ? d.lugares : []).slice(0, 20).map(x => ({ n: corto(x && x.n, 40), d: corto(x && x.d, 120) })).filter(x => x.n && x.d),
    modoP: d.modoP === 'mozas' ? 'mozas' : 'encargada', flLook: ['normal', 'traje', 'camisa', 'fiesta', 'claro'].includes(d.flLook) ? d.flLook : (LOOK_DE[d.tipo] || 'traje'),
    zonas: (d.zonas && typeof d.zonas === 'object' ? Object.entries(d.zonas) : []).slice(0, 40).reduce((o, [k, v]) => { k = corto(k, 30); v = corto(v, 60).replace(/[^\d,\- a-zA-Z]/g, ''); if (k && v) o[k] = v; return o; }, {})
  };
  if (typeof d.foto === 'string' && (d.foto === '' || /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(d.foto))) {
    if (d.foto.length > 900000) throw Object.assign(new Error('La foto es muy pesada. Probá con otra.'), { st: 400 });
    o.foto = d.foto;
  } else o.foto = prev.foto || '';
  // Fondo de la invitación: '' (liso), 'foto' (la foto principal en grande) u otra foto propia.
  if (d.fondo === '' || d.fondo === 'foto') o.fondo = d.fondo;
  else if (typeof d.fondo === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(d.fondo)) {
    if (d.fondo.length > 900000) throw Object.assign(new Error('La foto de fondo es muy pesada. Probá con otra.'), { st: 400 });
    o.fondo = d.fondo;
  } else o.fondo = prev.fondo || '';
  // Vitrina de fotos: la historia de la protagonista (de bebé a hoy), hasta 10 fotos chicas.
  if (Array.isArray(d.historia)) {
    o.historia = d.historia.slice(0, 12).filter(x => x && typeof x.img === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(x.img) && x.img.length <= 200000).map(x => ({ img: x.img, txt: corto(x.txt, 40), g: [0, 1, 2, 3].includes(x.g) ? x.g : null }));
  } else o.historia = prev.historia || [];
  o.flForma = ['corazon', 'normal'].includes(d.flForma) ? d.flForma : (prev.flForma || '');
  o.efTipo = ['corazones', 'flores', 'estrellas', 'mariposas', 'mezcla', 'boda', 'oroplata'].includes(d.efTipo) ? d.efTipo : (prev.efTipo || 'corazones');
  o.abre = ['sobre', 'cofre', 'cofreplata', 'luna', 'relicario', 'estrella'].includes(d.abre) ? d.abre : (prev.abre || 'sobre');
  ['sinCor', 'sinPolvo', 'sinSobre', 'sinGlobos'].forEach(k => { o[k] = typeof d[k] === 'boolean' ? d[k] : !!prev[k]; }); // efectos opcionales (vienen prendidos)
  o.vitNom = Array.isArray(d.vitNom) ? [0, 1, 2, 3].map(i => corto(d.vitNom[i], 22)) : (prev.vitNom || []);
  o.vitEstilo = ['arriba', 'pelicula', 'aro', 'alrededor', 'gira'].includes(d.vitEstilo) ? d.vitEstilo : (prev.vitEstilo || 'arriba');
  // Video de la protagonista: link de YouTube (no listado). Guardamos solo el id; lo sirve YouTube, no nosotros.
  if (typeof d.video === 'string') {
    const u = d.video.trim();
    if (!u) o.video = null;
    else {
      const mm = u.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/))([A-Za-z0-9_-]{11})/);
      if (!mm) throw Object.assign(new Error('Ese link no es de un video de YouTube. Copiá el link desde "Compartir" en YouTube.'), { st: 400 });
      o.video = { id: mm[1], vert: /\/shorts\//.test(u) };
    }
  } else o.video = prev.video || null;
  const viejos = {}; (prev.invitados || []).forEach(g => { viejos[g.id] = g; });
  const lista = Array.isArray(d.invitados) ? d.invitados.slice(0, 600) : (prev.invitados || []);
  let n = (prev.ultimo || 0);
  o.invitados = lista.map(g => {
    const v = g && g.id && viejos[g.id];
    const id = v ? v.id : 'g' + (++n);
    return { id, tok: v ? v.tok : azar(10, 'abcdefghijkmnpqrstuvwxyz23456789'), nombre: corto(g && g.nombre, 60), mesa: corto(g && g.mesa, 12),
      menor: !!(g && g.menor), cupo: Math.max(0, Math.min(10, parseInt(g && g.cupo, 10) || 0)), tel: corto(g && g.tel, 20).replace(/[^\d+]/g, '') };
  }).filter(g => g.nombre);
  o.ultimo = n;
  return o;
}
const VITS = ['arriba', 'pelicula', 'aro', 'alrededor', 'gira'];
// Lo que puede ver cualquiera con el link de la fiesta (sin la lista de invitados ni claves).
function publica(e) {
  const o = {}; ['code', 'demo', 'tipo', 'modo', 'plantilla', 'color', 'titulo', 'nombre', 'frase', 'fecha', 'hora', 'salon', 'direccion', 'vestimenta', 'regalo', 'estaciona', 'mostrarMesa', 'pedirMenu', 'foto', 'fondo', 'historia', 'video', 'vitEstilo', 'vitNom', 'sinCor', 'sinPolvo', 'sinSobre', 'sinGlobos', 'abre', 'efTipo', 'flForma', 'organiza', 'autos', 'salud', 'saludNom', 'saludTel', 'seguridad', 'seguNom'].forEach(k => { o[k] = e[k]; });
  if (e.vitMax && e.paquete === 'invitacion' && VITS.indexOf(o.vitEstilo) > VITS.indexOf(e.vitMax)) o.vitEstilo = e.vitMax; // no muestra más de lo que compró
  o.total = (e.invitados || []).length; o.vivo = vivoOk(e); o.hoy = enDia(e) || !!e.demo || esAbierto(e);
  if (esAbierto(e)) { o.abierto = true; o.fecha = nocheDe(); }
  o.album = !!(e.demo || (e.pagado && e.paquete === 'recuerdos'));
  if (o.vivo) { o.lugares = e.lugares || []; o.flLook = e.flLook || LOOK_DE[e.tipo] || 'traje'; o.carta = e.carta || []; o.crono = e.crono || []; o.atraso = e.atraso || 0; o.avisos = (e.avisos || []).slice(-15); }
  return o;
}
const enDia = e => { if (!e || !e.fecha) return false; const t = Date.parse(e.fecha + 'T' + (e.hora || '21:00') + ':00-03:00'), n = Date.now(); return n > t - 8 * 3600e3 && n < t + 14 * 3600e3; };
// Qué moza atiende cada mesa, según lo que cargó la familia ("1-5, 8"). Si no está cargada, decide la encargada.
function mozaDeMesa(e, mesa) {
  const M = e.mozas || []; if (!M.length || !mesa) return '';
  const n = parseInt(mesa, 10), z = e.zonas || {};
  for (const moza of M) { const r = String(z[moza] || ''); if (!r) continue;
    for (const parte of r.split(',')) { const [a, b] = parte.split('-').map(x => x.trim()); if (String(a).toLowerCase() === String(mesa).toLowerCase()) return moza; if (n && +a && n >= +a && n <= (+b || +a)) return moza; } }
  return ''; // sin mesa asignada: la encargada elige en el momento
}
const vivoOk = e => !!(e && (e.demo || (e.pagado && ['completa', 'recuerdos'].includes(e.paquete))));
const azarK = () => azar(10, 'abcdefghijkmnpqrstuvwxyz23456789');
async function pedidosDe(code, extra) {
  const desde = new Date(Date.now() - (code === DEMO || code === DEMOBAR ? 3 : (extra && extra.includes('&_noche') ? 14 : 36)) * 3600e3).toISOString(); extra = (extra || '').replace('&_noche', '');
  try { return await rest('GET', 'fiesta_pedidos?code=eq.' + code + '&t=gte.' + encodeURIComponent(desde) + (extra || '') + '&order=t.desc&limit=400&select=id,gid,nombre,mesa,items,nota,estado,moza,prueba,t,tu'); } catch (e) { return []; }
}
async function respuestas(code) {
  try { return await rest('GET', 'fiesta_resp?code=eq.' + encodeURIComponent(code) + '&select=gid,va,cuantos,menu,nota,t'); } catch (e) { return []; }
}

// ---- Avisos al celular (notificaciones) de los boliches: "Mañana noche de cumbia…" ----
// Claves VAPID: se crean solas la primera vez y quedan guardadas en el almacenamiento privado.
let VAP = null;
async function vapid() {
  if (VAP) return VAP;
  const url = ST() + '/object/' + B + '/_push/vapid.json';
  try { const r = await fetch(url, { headers: stHeaders({ 'cache-control': 'no-cache' }) }); if (r.ok) { const j = await r.json(); if (j && j.jwk && j.pub) return (VAP = j); } } catch (e) {}
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const pub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url');
  await bucket();
  const w = await fetch(url, { method: 'POST', headers: stHeaders({ 'Content-Type': 'application/json', 'x-upsert': 'false' }), body: JSON.stringify({ jwk, pub }) });
  if (!w.ok) { const r = await fetch(url, { headers: stHeaders({ 'cache-control': 'no-cache' }) }); const j = r.ok ? await r.json() : null; if (j && j.jwk) return (VAP = j); throw new Error('claves de avisos'); }
  return (VAP = { jwk, pub });
}
const PUSH_OK = /^https:\/\/([a-z0-9-]+\.)*(fcm\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com|push\.apple\.com|push\.api\.chromium\.org)\//i;
// Manda un "toque" vacío a cada celular; el celular busca el aviso nuevo y lo muestra con el logo del boliche.
async function empujar(subs) {
  if (!subs.length) return 0;
  const V = await vapid(), key = crypto.createPrivateKey({ key: V.jwk, format: 'jwk' }), J = {}, muertos = [];
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url'); let ok = 0;
  for (let i = 0; i < subs.length; i += 50) await Promise.all(subs.slice(i, i + 50).map(async s => {
    try {
      if (!PUSH_OK.test(s.endpoint)) return;
      const aud = new URL(s.endpoint).origin;
      if (!J[aud]) { const h = b64({ typ: 'JWT', alg: 'ES256' }) + '.' + b64({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'https://www.vitrina360app.com.ar' }); J[aud] = h + '.' + crypto.sign('sha256', Buffer.from(h), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url'); }
      const r = await fetch(s.endpoint, { method: 'POST', headers: { Authorization: 'vapid t=' + J[aud] + ', k=' + V.pub, TTL: '86400', Urgency: 'normal', 'Content-Length': '0' } });
      if (r.status === 404 || r.status === 410) muertos.push(s.id); else if (r.ok) ok++;
      else if (process.env.DEBUG_FIESTA) console.error('push', r.status, await r.text().catch(() => ''));
    } catch (e) { if (process.env.DEBUG_FIESTA) console.error('push', e.message); }
  }));
  if (muertos.length) await rest('DELETE', 'fiesta_push?id=in.(' + muertos.join(',') + ')').catch(() => {});
  return ok;
}
async function enviarNovedad(nov) {
  const subs = (await rest('GET', 'fiesta_push?code=eq.' + nov.code + '&select=id,endpoint&limit=20000').catch(() => [])) || [];
  await rest('PATCH', 'fiesta_novedad?id=eq.' + nov.id, { enviado: true, enviar_at: new Date().toISOString() }).catch(() => {});
  const n = await empujar(subs);
  await rest('PATCH', 'fiesta_novedad?id=eq.' + nov.id, { n }).catch(() => {});
  return n;
}
const pNombre = s => corto(String(s || '').split(' ')[0], 20);

module.exports = async (req, res) => {
  const q = req.query || {}, acc = String(q.accion || '');
  try {
    // ---- Para instalar la fiesta como app (ícono con el nombre de la fiesta) ----
    if (req.method === 'GET' && (q.manifest || q.icono)) {
      const code = String(q.manifest || q.icono).toUpperCase(); if (!okCode(code)) return res.status(400).json({ error: 'Fiesta inválida.' });
      const e = (code === DEMO || code === DEMOBAR) ? demoDe(code) : await leer(code); if (!e) return res.status(404).json({ error: 'No existe esa fiesta.' });
      const nom = esAbierto(e) ? (e.nombre || 'El boliche') : (e.tipo === '15' ? 'Los 15 de ' : 'Fiesta de ') + (e.nombre || 'la fiesta');
      if (q.icono) {
        const num = (String(e.titulo || '').match(/\d+/) || [])[0] || (e.nombre || 'F').charAt(0).toUpperCase();
        const esc = s => String(s).replace(/[<>&"]/g, '');
        res.setHeader('Content-Type', 'image/svg+xml'); res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.status(200).send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff7ee"/><stop offset="1" stop-color="${esc(e.color)}" stop-opacity=".55"/></linearGradient></defs><rect width="512" height="512" rx="112" fill="url(#g)"/><circle cx="256" cy="230" r="150" fill="#fff" stroke="${esc(e.color)}" stroke-width="14"/><text x="256" y="${num.length > 1 ? 285 : 290}" text-anchor="middle" font-family="Georgia,serif" font-weight="700" font-size="${num.length > 2 ? 110 : 160}" fill="#3b2a12">${esc(num)}</text><text x="256" y="450" text-anchor="middle" font-family="Georgia,serif" font-size="62" fill="#3b2a12">${esc(String(e.nombre || '').slice(0, 12))}</text></svg>`);
      }
      res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8'); res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.status(200).send(JSON.stringify({ name: nom, short_name: nom.slice(0, 14), id: '/fiesta/' + code + '?app=1', start_url: '/fiesta/' + code + '?app=1', scope: '/', display: 'standalone', orientation: 'portrait', background_color: '#fffaf3', theme_color: e.color || '#c9a227', lang: 'es',
        icons: [{ src: '/api/fiesta?icono=' + code, sizes: 'any', type: 'image/svg+xml', purpose: 'any' }, { src: '/icons/fiesta-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' }, { src: '/icons/fiesta-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }, { src: '/icons/fiesta-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }] }));
    }

    if (req.method === 'POST' && acc === 'crear') {
      const b = cuerpo(req); await bucket();
      let code = ''; for (let i = 0; i < 6; i++) { code = azar(6, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'); if (!(await leer(code))) break; }
      const clave = azar(12, 'abcdefghijkmnpqrstuvwxyz23456789');
      const e = Object.assign(limpiar(b.datos, null), { code, clave: hash(clave), creado: new Date().toISOString() });
      await guardarObj(code, e);
      return res.status(200).json({ ok: true, code, clave, panel: '/fiesta-panel?f=' + code + '&k=' + clave, link: '/fiesta/' + code });
    }

    if (acc === 'aviso') { // Mercado Pago avisa un pago
      const b = cuerpo(req);
      const tipo = b.type || b.topic || q.type || q.topic || '', pid = String((b.data && b.data.id) || q['data.id'] || q.id || '').replace(/\D/g, '');
      if (!/payment/.test(tipo) || !pid) return res.status(200).json({ ok: true });
      const pay = await mpGet('/v1/payments/' + pid);
      const ref = String(pay && pay.external_reference || ''), pr = ref.split('/');
      if (!pay || pay.status !== 'approved' || pr[0] !== 'fiesta' || !okCode(pr[1]) || !PAQ()[pr[2]]) return res.status(200).json({ ok: true });
      const e = await leer(pr[1]);
      if (e && !(e.pagos || []).some(p => p.id === pid)) { marcarPago(e, pr[2], pid, pay.transaction_amount); delete e.pagoRef; await guardarObj(pr[1], e); }
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'GET' && acc === 'precios') return res.status(200).json({ paquetes: PAQ(), extra150: EXTRA150() });

    if (req.method === 'GET' && acc === 'pushKey') { res.setHeader('Cache-Control', 'public, max-age=3600'); return res.status(200).json({ key: (await vapid()).pub }); }
    if (acc === 'programados') { // lo llama Vercel todos los días a las 19 h: manda los avisos programados para hoy
      const L = (await rest('GET', 'fiesta_novedad?enviado=eq.false&enviar_at=lte.' + encodeURIComponent(new Date().toISOString()) + '&select=id,code&limit=30').catch(() => [])) || [];
      let n = 0; for (const nov of L) n += await enviarNovedad(nov);
      return res.status(200).json({ ok: true, avisos: L.length, celulares: n });
    }
    if (req.method === 'POST' && acc === 'codigoNuevo') { // el dueño de Pro Video genera códigos para vender en Mercado Libre
      const u = await usuario(req);
      if (!u || !ADMINS().includes(String(u.email).toLowerCase())) return res.status(403).json({ error: 'Solo el dueño de Pro Video.' });
      const b = cuerpo(req), paq = PAQ()[b.paquete] ? b.paquete : 'invitacion', n = Math.max(1, Math.min(20, parseInt(b.n, 10) || 1));
      const AB = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', gen = () => 'ML-' + [0, 1].map(() => Array.from(crypto.randomBytes(4), x => AB[x % AB.length]).join('')).join('-');
      const L = Array.from({ length: n }, gen);
      const vit = paq === 'invitacion' && VITS.includes(b.vit) ? b.vit : null; // nivel de vitrina vendido en ML
      await rest('POST', 'fiesta_codigos', L.map(codigo => ({ codigo, paquete: paq, vit })), 'return=minimal');
      return res.status(200).json({ ok: true, codigos: L, paquete: paq, vit });
    }
    const code = String(q.f || cuerpo(req).f || '').toUpperCase();
    if (!okCode(code)) return res.status(400).json({ error: 'Fiesta inválida.' });
    const esDemo = code === DEMO || code === DEMOBAR;

    if (req.method === 'POST' && acc === 'guardar') {
      const b = cuerpo(req);
      if (esDemo) return res.status(403).json({ error: 'La fiesta de muestra no se puede cambiar. Creá la tuya.' });
      const e = await leer(code); if (!e) return res.status(404).json({ error: 'No existe esa fiesta.' });
      if (hash(String(b.k || '')) !== e.clave) return res.status(403).json({ error: 'La clave del panel no es correcta.' });
      const n = Object.assign(limpiar(b.datos, e), { code, clave: e.clave, creado: e.creado, cambiado: new Date().toISOString(), pagado: e.pagado, paquete: e.paquete, pagos: e.pagos, pagoRef: e.pagoRef, pk: e.pk, avisos: e.avisos, atraso: e.atraso, listo: e.listo, musica: e.musica, vitMax: e.vitMax });
      await guardarObj(code, n);
      return res.status(200).json({ ok: true, invitados: n.invitados });
    }

    if (req.method === 'GET' && acc === 'panel') {
      if (esDemo) {
        const d = Object.assign(demoDe(code), code === DEMOBAR ? {} : { pagado: true, paquete: 'invitacion' }); d.ak = akDe(d); d.sk = skDe(d); d.gk = gkDe(d); return res.status(200).json({ ok: true, demo: true, vivo: code === DEMOBAR, paquetes: PAQ(), extra150: EXTRA150(), fiesta: d,
          resp: [{ gid: 'g1', va: true, cuantos: 2, menu: '', nota: '¡Ahí estaremos!', t: new Date().toISOString() }, { gid: 'g3', va: true, cuantos: 1, menu: 'sin TACC', nota: '', t: new Date().toISOString() }, { gid: 'g4', va: false, cuantos: 0, menu: '', nota: 'Estoy de viaje, ¡felicidades!', t: new Date().toISOString() }] });
      }
      const e = await leer(code); if (!e) return res.status(404).json({ error: 'No existe esa fiesta.' });
      if (hash(String(q.k || '')) !== e.clave) return res.status(403).json({ error: 'La clave del panel no es correcta.' });
      let cambio = false;
      if (!e.pagado && e.pagoRef && await revisarPago(e)) cambio = true;
      if (!e.pk) { e.pk = azarK(); cambio = true; }
      if (cambio) await guardarObj(code, e);
      const f = Object.assign({}, e); delete f.clave; delete f.pagoRef; f.ak = akDe(e); f.sk = skDe(e); f.gk = gkDe(e);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ ok: true, fiesta: f, vivo: vivoOk(e), resp: await respuestas(code), paquetes: PAQ(), extra150: EXTRA150(), pedidos: vivoOk(e) ? (await pedidosDe(code)).length : 0 });
    }

    if (req.method === 'POST' && acc === 'canjear') {
      if (esDemo) return res.status(403).json({ error: 'Esto es una muestra. Creá tu fiesta para activarla.' });
      const b = cuerpo(req), e2 = await leer(code); if (!e2) return res.status(404).json({ error: 'No existe esa fiesta.' });
      if (hash(String(b.k || '')) !== e2.clave) return res.status(403).json({ error: 'La clave del panel no es correcta.' });
      const cod = String(b.codigo || '').toUpperCase().replace(/\s+/g, '').slice(0, 20);
      if (!/^ML-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(cod)) return res.status(400).json({ error: 'El código no es válido. Tiene la forma ML-XXXX-XXXX.' });
      const fila = ((await rest('GET', 'fiesta_codigos?codigo=eq.' + cod + '&select=codigo,paquete,usado_por,vit').catch(() => [])) || [])[0];
      if (!fila) return res.status(404).json({ error: 'No encontramos ese código. Revisá que esté bien escrito.' });
      if (fila.usado_por && fila.usado_por !== code) return res.status(409).json({ error: 'Ese código ya se usó en otra fiesta.' });
      await rest('PATCH', 'fiesta_codigos?codigo=eq.' + cod + '&usado_por=is.null', { usado_por: code, usado_at: new Date().toISOString() });
      const ok = ((await rest('GET', 'fiesta_codigos?codigo=eq.' + cod + '&select=usado_por').catch(() => [])) || [])[0];
      if (!ok || ok.usado_por !== code) return res.status(409).json({ error: 'Ese código ya se usó en otra fiesta.' });
      if (!(e2.pagado && (e2.paquete === fila.paquete || e2.paquete === 'recuerdos' || (e2.paquete === 'completa' && fila.paquete === 'invitacion')))) { marcarPago(e2, fila.paquete, 'ml:' + cod, 0, false); e2.vitMax = fila.paquete === 'invitacion' ? (fila.vit || 'aro') : null; await guardarObj(code, e2); }
      return res.status(200).json({ ok: true, pagado: true, paquete: fila.paquete });
    }
    if (req.method === 'POST' && (acc === 'pagar' || acc === 'regalar')) {
      const b = cuerpo(req), paq = String(b.paquete || 'invitacion'), P = PAQ()[paq];
      if (esDemo) return res.status(403).json({ error: 'Esto es una muestra. Creá tu fiesta para activarla.' });
      const e = await leer(code); if (!e) return res.status(404).json({ error: 'No existe esa fiesta.' });
      if (acc === 'regalar') { // el dueño de Pro Video activa gratis (fiestas de prueba)
        const u = await usuario(req);
        if (!u || !ADMINS().includes(String(u.email).toLowerCase())) return res.status(403).json({ error: 'Solo el dueño de Pro Video puede activar gratis.' });
        if (!P) return res.status(400).json({ error: 'Paquete inválido.' });
        marcarPago(e, paq, '', 0, true); await guardarObj(code, e); return res.status(200).json({ ok: true, pagado: true });
      }
      if (hash(String(b.k || '')) !== e.clave) return res.status(403).json({ error: 'La clave del panel no es correcta.' });
      if (!P || !P.disponible) return res.status(400).json({ error: 'Ese paquete todavía no está disponible.' });
      if (e.pagado && (e.paquete === paq || (e.paquete === 'recuerdos'))) return res.status(200).json({ pagado: true });
      const tok = String(process.env.MP_ACCESS_TOKEN || '').trim();
      if (!tok) return res.status(503).json({ error: 'El cobro todavía no está configurado.' });
      const ya = e.pagado ? montoDe(e.paquete, e) : 0, monto = Math.max(0, montoDe(paq, e) - ya); // si ya pagó un paquete, paga la diferencia
      if (monto <= 0) return res.status(200).json({ pagado: true });
      const host = 'https://' + (req.headers['x-forwarded-host'] || req.headers.host || 'vitrina360app.com.ar');
      const back = host + '/fiesta-panel?f=' + code + '&k=' + encodeURIComponent(String(b.k || ''));
      const ref = 'fiesta/' + code + '/' + paq + '/' + Date.now().toString(36);
      const r = await fetch('https://api.mercadopago.com/checkout/preferences', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({
        items: [{ id: 'fiesta-' + paq, title: ('ShopFiesta · ' + P.nombre + (e.nombre ? ' · ' + e.nombre : '')).slice(0, 60), quantity: 1, unit_price: monto, currency_id: 'ARS' }],
        external_reference: ref, notification_url: host + '/api/fiesta?accion=aviso',
        back_urls: { success: back + '&pago=ok', pending: back + '&pago=pendiente', failure: back + '&pago=error' }, auto_return: 'approved', statement_descriptor: 'SHOPFIESTA'
      }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.init_point) { console.error('fiesta pagar', r.status, JSON.stringify(j).slice(0, 300)); return res.status(502).json({ error: 'Mercado Pago no respondió. Probá de nuevo en un rato.' }); }
      e.pagoRef = ref; await guardarObj(code, e);
      return res.status(200).json({ url: j.init_point });
    }

    const e = esDemo ? demoDe(code) : await leer(code);
    if (!e) return res.status(404).json({ error: 'No encontramos esta fiesta. Revisá el link.' });
    if (!esDemo && !e.pagado && ['ver', 'buscar', 'responder', 'firmar', 'firmas', 'albumSubir', 'albumListo', 'album'].includes(acc)) return res.status(402).json({ error: 'Esta invitación todavía no está activa. La familia la está terminando de preparar.' });

    // ---- Clientes del boliche: avisos al celular y reseñas ----
    if (req.method === 'POST' && acc === 'pushAlta') {
      const b = cuerpo(req), sub = b.sub || {}, ep = String(sub.endpoint || '');
      if (!PUSH_OK.test(ep) || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return res.status(400).json({ error: 'Este celular no acepta avisos.' });
      await rest('POST', 'fiesta_push?on_conflict=endpoint', { code, endpoint: ep.slice(0, 900), sub: { endpoint: ep.slice(0, 900), keys: { p256dh: corto(sub.keys.p256dh, 200), auth: corto(sub.keys.auth, 60) } } }, 'resolution=merge-duplicates,return=minimal');
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'GET' && acc === 'novedades') {
      const dueno = esDemo || (q.k && hash(String(q.k)) === e.clave) || !!(q.p && e.pk && String(q.p) === e.pk);
      const L = (await rest('GET', 'fiesta_novedad?code=eq.' + code + (dueno ? '' : '&enviado=eq.true') + '&order=enviar_at.desc&limit=' + (dueno ? 20 : 5) + '&select=id,autor,titulo,texto,enviar_at,enviado,n').catch(() => [])) || [];
      const out = { ok: true, items: L.map(x => dueno ? x : { id: x.id, autor: x.autor, titulo: x.titulo, texto: x.texto, t: x.enviar_at }) };
      if (dueno) out.clientes = ((await rest('GET', 'fiesta_push?code=eq.' + code + '&select=id&limit=20000').catch(() => [])) || []).length;
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(out);
    }
    if (req.method === 'POST' && acc === 'novedad') {
      const b = cuerpo(req);
      const barra = !!(b.p && e.pk && String(b.p) === e.pk), autor = barra ? 'barra' : 'dueno';
      if (!esDemo && !barra && hash(String(b.k || '')) !== e.clave) return res.status(403).json({ error: 'No tenés permiso para mandar avisos.' });
      if (!esDemo && !e.pagado) return res.status(402).json({ error: 'Activá el boliche para mandar avisos.' });
      const titulo = corto(b.titulo, 70), texto = largo(b.texto, 300);
      if (titulo.length < 3) return res.status(400).json({ error: 'Escribí el título del aviso (por ejemplo: Mañana noche de cumbia).' });
      let cuando = new Date();
      if (b.dia && !esDemo) { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.dia))) return res.status(400).json({ error: 'Fecha inválida.' });
        cuando = new Date(b.dia + 'T' + (/^\d{2}:\d{2}$/.test(String(b.hora || '')) ? b.hora : '19:00') + ':00-03:00');
        if (cuando < Date.now() - 60e3 || cuando > Date.now() + 40 * 864e5) return res.status(400).json({ error: 'Los programados salen a las 19 h: elegí un día que todavía no haya pasado esa hora (hasta 40 días).' }); }
      const prev = (await rest('GET', 'fiesta_novedad?code=eq.' + code + '&t=gte.' + encodeURIComponent(new Date(Date.now() - (esDemo ? 60e3 : 7 * 864e5)).toISOString()) + '&autor=eq.' + autor + '&select=id').catch(() => [])) || [];
      if (esDemo && prev.length) return res.status(429).json({ error: 'Esperá un minuto para probar otro aviso.' });
      const tope = barra ? 2 : 3;
      if (!esDemo && prev.length >= tope) return res.status(429).json({ error: 'Ya mandaste ' + tope + ' avisos esta semana. Así la gente no apaga las notificaciones.' });
      const row = ((await rest('POST', 'fiesta_novedad', { code, autor, titulo, texto, enviar_at: cuando.toISOString() }, 'return=representation')) || [])[0];
      if (!row) throw new Error('no se guardó el aviso');
      if (cuando <= Date.now() + 5 * 60e3) { const n = await enviarNovedad(row); return res.status(200).json({ ok: true, enviado: true, celulares: n }); }
      return res.status(200).json({ ok: true, enviado: false, programado: row.enviar_at });
    }
    if (req.method === 'POST' && acc === 'novedadBorrar') {
      const b = cuerpo(req); if (!esDemo && hash(String(b.k || '')) !== e.clave && !(b.p && e.pk && String(b.p) === e.pk)) return res.status(403).json({ error: 'No tenés permiso.' });
      await rest('DELETE', 'fiesta_novedad?code=eq.' + code + '&enviado=eq.false&id=eq.' + (parseInt(b.id, 10) || 0));
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'POST' && acc === 'resenar') {
      const b = cuerpo(req), g = esAbierto(e) && invDe(e, b.i, b.nombre);
      if (!g) return res.status(403).json({ error: 'Entrá con tu nombre para dejar tu opinión.' });
      const est = parseInt(b.estrellas, 10); if (!(est >= 1 && est <= 5)) return res.status(400).json({ error: 'Elegí de 1 a 5 estrellas.' });
      await rest('POST', 'fiesta_resena?on_conflict=code,cid,noche', { code, cid: g.id, noche: nocheDe(), nombre: pNombre(g.nombre), estrellas: est, texto: largo(b.texto, 400) }, 'resolution=merge-duplicates,return=minimal');
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'GET' && acc === 'resenas') {
      const L = (await rest('GET', 'fiesta_resena?code=eq.' + code + '&order=t.desc&limit=300&select=cid,noche,nombre,estrellas,texto,t').catch(() => [])) || [];
      const g = q.i && invDe(e, q.i), noche = nocheDe();
      const prom = L.length ? Math.round(L.reduce((a, x) => a + x.estrellas, 0) / L.length * 10) / 10 : 0;
      const dueno = q.k && hash(String(q.k)) === e.clave;
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ ok: true, promedio: prom, cantidad: L.length, mia: g ? (L.find(x => x.cid === g.id && x.noche === noche) || null) : null,
        items: L.filter(x => dueno || x.texto).slice(0, dueno ? 100 : 10).map(x => ({ nombre: x.nombre, estrellas: x.estrellas, texto: x.texto, noche: x.noche })) });
    }
    // Música de la invitación: la familia sube un MP3 (o M4A) que suena mientras gira la vitrina.
    if (req.method === 'POST' && ['musicaSubir', 'musicaListo', 'musicaQuitar'].includes(acc)) {
      const b = cuerpo(req); if (esDemo) return res.status(403).json({ error: 'Esto es una muestra.' });
      if (hash(String(b.k || '')) !== e.clave) return res.status(403).json({ error: 'La clave del panel no es correcta.' });
      if (acc === 'musicaSubir') {
        const ext = /^(mp3|m4a|aac|ogg)$/.test(String(b.ext)) ? b.ext : 'mp3';
        const path = 'musica/' + code + '-' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex') + '.' + ext;
        const r = await fetch(ST() + '/object/upload/sign/' + B + '/' + path, { method: 'POST', headers: stHeaders({ 'Content-Type': 'application/json' }) });
        const j = await r.json().catch(() => ({})); if (!r.ok || !j.url) return res.status(500).json({ error: 'No se pudo preparar la subida.' });
        return res.status(200).json({ path, url: ST() + j.url });
      }
      if (acc === 'musicaListo') { const p = String(b.path || ''); if (!p.startsWith('musica/' + code + '-')) return res.status(400).json({ error: 'Archivo inválido.' }); e.musica = { path: p, nombre: corto(b.nombre, 60) }; }
      else delete e.musica;
      await guardarObj(code, e); return res.status(200).json({ ok: true });
    }
    if (req.method === 'GET' && acc === 'ver') {
      const out = { ok: true, fiesta: publica(e) };
      if (e.musica && e.musica.path) { try { const r = await fetch(ST() + '/object/sign/' + B + '/' + e.musica.path, { method: 'POST', headers: stHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ expiresIn: 172800 }) }); const j = await r.json(); if (j.signedURL) out.fiesta.musica = { url: ST() + j.signedURL, nombre: e.musica.nombre || '' }; } catch (x) {} }
      else if (esDemo && code === DEMO) out.fiesta.musica = { url: '/musica-demo.mp3', nombre: 'Música de ejemplo' };
      const g = q.i && (e.invitados || []).find(x => x.tok === String(q.i));
      if (g) {
        const r = esDemo ? null : ((await rest('GET', 'fiesta_resp?code=eq.' + code + '&gid=eq.' + encodeURIComponent(g.id) + '&select=va,cuantos,menu,nota').catch(() => [])) || [])[0];
        out.inv = { nombre: g.nombre, mesa: e.mostrarMesa || (vivoOk(e) && (enDia(e) || e.demo)) ? g.mesa : '', cupo: g.cupo || 0, menor: !!g.menor, resp: r || null };
      }
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(out);
    }

    if (req.method === 'GET' && acc === 'buscar') {
      const t = sinTildes(q.q).trim(); if (t.length < 3) return res.status(200).json({ ok: true, items: [] });
      const partes = t.split(/\s+/);
      const items = (e.invitados || []).filter(g => { const n = sinTildes(g.nombre); return partes.every(p => n.includes(p)); }).slice(0, 6).map(g => ({ nombre: g.nombre, tok: g.tok }));
      return res.status(200).json({ ok: true, items });
    }

    if (req.method === 'POST' && acc === 'responder') {
      const b = cuerpo(req);
      const g = (e.invitados || []).find(x => x.tok === String(b.i || ''));
      if (!g) return res.status(404).json({ error: 'No encontramos tu invitación. Pedile el link a la familia.' });
      const va = !!b.va;
      const fila = { code, gid: g.id, va, cuantos: va ? Math.max(1, Math.min(1 + (g.cupo || 0), parseInt(b.cuantos, 10) || 1)) : 0,
        menu: MENUS.includes(b.menu) ? b.menu : '', nota: largo(b.nota, 300), t: new Date().toISOString() };
      if (!esDemo) await rest('POST', 'fiesta_resp?on_conflict=code,gid', fila, 'resolution=merge-duplicates,return=minimal');
      return res.status(200).json({ ok: true, demo: esDemo, resp: fila, mesa: e.mostrarMesa ? g.mesa : '' });
    }

    // ===== Álbum de la fiesta: fotos y videos de hasta 30 s que suben los invitados (paquete con recuerdos) =====
    // El archivo va directo del celular al almacenamiento con un link firmado (no pasa por acá, así aguanta videos).
    const albumOk = e.demo || (e.pagado && e.paquete === 'recuerdos');
    if (req.method === 'POST' && (acc === 'albumSubir' || acc === 'albumListo')) {
      const b = cuerpo(req), g = invDe(e, b.i, b.nombre);
      if (!g) return res.status(403).json({ error: 'Primero decinos quién sos.' });
      if (!albumOk) return res.status(403).json({ error: 'El álbum viene en el paquete con recuerdos.' });
      if (esDemo) return res.status(200).json({ demo: true });
      const tipo = b.tipo === 'video' ? 'video' : 'foto';
      if (acc === 'albumSubir') {
        const mios = (await rest('GET', 'fiesta_album?code=eq.' + code + '&gid=eq.' + encodeURIComponent(g.id) + '&select=tipo').catch(() => [])) || [];
        if (mios.filter(x => x.tipo === tipo).length >= (tipo === 'video' ? 5 : 40)) return res.status(429).json({ error: tipo === 'video' ? 'Ya subiste 5 videos. ¡Gracias!' : 'Ya subiste 40 fotos. ¡Gracias!' });
        const ext = tipo === 'video' ? (/^(mp4|mov|webm)$/.test(String(b.ext)) ? b.ext : 'mp4') : 'jpg';
        const path = 'album/' + code + '/' + g.id + '-' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex') + '.' + ext;
        const r = await fetch(ST() + '/object/upload/sign/' + B + '/' + path, { method: 'POST', headers: stHeaders({ 'Content-Type': 'application/json' }) });
        const j = await r.json().catch(() => ({})); if (!r.ok || !j.url) return res.status(500).json({ error: 'No se pudo preparar la subida.' });
        return res.status(200).json({ path, url: ST() + j.url });
      }
      const path = String(b.path || ''); if (!path.startsWith('album/' + code + '/' + g.id + '-')) return res.status(400).json({ error: 'Archivo inválido.' });
      await rest('POST', 'fiesta_album', { code, gid: g.id, nombre: g.nombre, tipo, path }, 'return=minimal');
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'GET' && acc === 'album') {
      const g = q.i && invDe(e, q.i), fam = q.k && hash(String(q.k)) === e.clave;
      if (!g && !fam && !(q.p && e.pk && String(q.p) === e.pk)) return res.status(403).json({ error: 'No tenés permiso para ver el álbum.' });
      if (!albumOk) return res.status(200).json({ ok: true, activo: false, items: [] });
      const L = esDemo ? [] : ((await rest('GET', 'fiesta_album?code=eq.' + code + '&select=id,gid,nombre,tipo,path,t&order=t.desc&limit=600').catch(() => [])) || []);
      let urls = {}; if (L.length) { const r = await fetch(ST() + '/object/sign/' + B, { method: 'POST', headers: stHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ expiresIn: 6 * 3600, paths: L.map(x => x.path) }) }); const j = await r.json().catch(() => []);
        (Array.isArray(j) ? j : []).forEach(x => { if (x && x.signedURL) urls[x.path] = ST() + x.signedURL; }); }
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ ok: true, activo: true, items: L.filter(x => urls[x.path]).map(x => ({ id: x.id, nombre: x.nombre, tipo: x.tipo, url: urls[x.path], t: x.t, yo: !!(g && x.gid === g.id) })) });
    }

    // ===== Cuadro de firmas: cada invitado firma la foto de la cumpleañera =====
    if (req.method === 'POST' && acc === 'firmar') {
      const b = cuerpo(req);
      const g = (e.invitados || []).find(x => x.tok === String(b.i || ''));
      if (!g) return res.status(404).json({ error: 'No encontramos tu invitación. Pedile el link a la familia.' });
      const img = String(b.img || '');
      if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(img) || img.length > 250000) return res.status(400).json({ error: 'La firma no se pudo guardar. Probá de nuevo.' });
      const fila = { code, gid: g.id, nombre: g.nombre, img, msg: largo(b.msg, 120), t: new Date().toISOString() };
      if (!esDemo) await rest('POST', 'fiesta_firmas?on_conflict=code,gid', fila, 'resolution=merge-duplicates,return=minimal');
      return res.status(200).json({ ok: true, demo: esDemo, firma: { nombre: fila.nombre, img, msg: fila.msg, t: fila.t, yo: true } });
    }
    if (req.method === 'GET' && acc === 'firmas') {
      const g = q.i && (e.invitados || []).find(x => x.tok === String(q.i));
      const ok = g || (q.p && e.pk && String(q.p) === e.pk) || (q.k && hash(String(q.k)) === e.clave);
      if (!ok) return res.status(403).json({ error: 'No tenés permiso para ver el cuadro.' });
      const L = esDemo ? [] : ((await rest('GET', 'fiesta_firmas?code=eq.' + code + '&select=gid,nombre,img,msg,t&order=t.asc').catch(() => [])) || []);
      return res.status(200).json({ ok: true, foto: e.foto || '', nombre: e.nombre || '', firmas: L.map(x => ({ nombre: x.nombre, img: x.img, msg: x.msg, t: x.t, yo: !!(g && x.gid === g.id) })) });
    }

    // ===== Fiesta en vivo =====
    const esPersonal = x => x && e.pk && String(x) === e.pk, esFamilia = x => x && hash(String(x)) === e.clave;
    // El invitado: sus pedidos y los avisos (la app lo consulta cada pocos segundos)
    if (req.method === 'GET' && acc === 'vivo') {
      if (!vivoOk(e)) return res.status(200).json({ ok: true, vivo: false });
      const g = invDe(e, q.i);
      const L = g ? await pedidosDe(code, '&gid=eq.' + encodeURIComponent(g.id)) : [];
      res.setHeader('Cache-Control', 'no-store');
      const au = g ? ((await rest('GET', 'fiesta_autos?code=eq.' + code + '&gid=eq.' + encodeURIComponent(g.id) + '&select=patente,descr,cuida,pregunta,resp,resp_t').catch(() => [])) || [])[0] || null : null;
      return res.status(200).json({ ok: true, vivo: true, atraso: e.atraso || 0, avisos: (e.avisos || []).slice(-15), pedidos: L.slice(0, 12).map(x => ({ id: x.id, items: x.items, estado: x.estado, moza: x.moza, t: x.t })), auto: au });
    }
    // ===== Autos: el invitado anota su auto y el que lo cuida le responde =====
    if (req.method === 'POST' && (acc === 'auto' || acc === 'autoPregunta')) {
      const b = cuerpo(req), g = invDe(e, b.i, b.nombre, b.mesa);
      if (!g) return res.status(403).json({ error: 'Primero decinos quién sos.' });
      if (acc === 'auto') {
        const fila = { code, gid: g.id, nombre: g.nombre, mesa: String(g.mesa || ''), patente: corto(String(b.patente || '').toUpperCase(), 12), descr: corto(b.descr, 60), t: new Date().toISOString() };
        if (!fila.patente && !fila.descr) return res.status(400).json({ error: 'Poné la patente o cómo es tu auto.' });
        await rest('POST', 'fiesta_autos?on_conflict=code,gid', fila, 'resolution=merge-duplicates,return=minimal');
        return res.status(200).json({ ok: true });
      }
      await rest('PATCH', 'fiesta_autos?code=eq.' + code + '&gid=eq.' + encodeURIComponent(g.id), { pregunta: new Date().toISOString(), resp: null, resp_t: null }, 'return=minimal');
      return res.status(200).json({ ok: true });
    }
    if (acc === 'autos' || acc === 'autoEstado') {
      const b = req.method === 'POST' ? cuerpo(req) : q, ak = akDe(e);
      if (!ak || String(b.a || '') !== ak) return res.status(403).json({ error: 'Este link no es válido. Pedile el QR a la familia.' });
      if (req.method === 'GET') {
        const L = (await rest('GET', 'fiesta_autos?code=eq.' + code + '&select=gid,nombre,mesa,patente,descr,cuida,pregunta,resp,resp_t,t&order=t.asc').catch(() => [])) || [];
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ ok: true, fiesta: { nombre: e.nombre, tipo: e.tipo, salon: e.salon }, autos: L });
      }
      const c = {}; if (b.cuida != null) c.cuida = corto(b.cuida, 30); if (b.resp != null) { c.resp = corto(b.resp, 40); c.resp_t = new Date().toISOString(); }
      await rest('PATCH', 'fiesta_autos?code=eq.' + code + '&gid=eq.' + encodeURIComponent(String(b.gid || '')), c, 'return=minimal');
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'POST' && acc === 'pedir') {
      if (!vivoOk(e)) return res.status(403).json({ error: 'Los pedidos todavía no están activos en esta fiesta.' });
      const b = cuerpo(req), prueba = esPersonal(b.p) || esFamilia(b.k);
      const g = invDe(e, b.i, b.nombre, b.mesa);
      if (!g && !prueba) return res.status(403).json({ error: 'Primero decinos quién sos, así te lo llevamos a tu mesa.' });
      const carta = {}; (e.carta || []).forEach(x => { carta[x.n] = x; });
      const items = (Array.isArray(b.items) ? b.items : []).slice(0, 20).map(x => Object.assign({ n: String(x && x.n || ''), c: Math.max(1, Math.min(10, parseInt(x && x.c, 10) || 1)) }, x && x.p ? { p: corto(x.p, 30) } : {}))
        .filter(x => x.n === AYUDA || (x.n === SEGU && e.seguridad) || (carta[x.n] && !(carta[x.n].alc && g && g.menor)));
      const esAyuda = items.some(x => esUrg(x.n));
      if (!items.length) return res.status(400).json({ error: 'Elegí algo de la lista.' });
      if (g && !esAyuda) { const ult = await pedidosDe(code, '&gid=eq.' + g.id + '&estado=in.(nuevo,camino)'); if (ult.length >= 4) return res.status(429).json({ error: 'Ya tenés pedidos en camino. Esperá que te lleguen 🙂' }); }
      const mesaP = corto(g ? (g.mesa || b.mesa) : (b.mesa || 'Prueba'), 12);
      const fila = { code, gid: g ? g.id : 'prueba', nombre: g ? g.nombre : 'Pedido de prueba', mesa: mesaP, items, nota: largo(b.nota, 140), estado: 'nuevo', moza: g && !esAyuda ? mozaDeMesa(e, mesaP) : '', prueba: !g };
      const r = await rest('POST', 'fiesta_pedidos', fila, 'return=representation');
      return res.status(200).json({ ok: true, id: r && r[0] && r[0].id, moza: fila.moza });
    }
    // El personal (encargada o mozas): todos los pedidos de la noche
    if (req.method === 'GET' && acc === 'personal') {
      const esSalud = q.s && skDe(e) && String(q.s) === skDe(e), esSeg = q.s && gkDe(e) && String(q.s) === gkDe(e);
      if (!esPersonal(q.p) && !esFamilia(q.k) && !esSalud && !esSeg) return res.status(403).json({ error: 'El link del personal no es correcto. Pedíselo a la familia.' });
      if (esSeg) { res.setHeader('Cache-Control', 'no-store'); return res.status(200).json({ ok: true, fiesta: { nombre: e.nombre, tipo: e.tipo, modoP: 'seguridad', mozas: [], salon: e.salon, saludNom: e.seguNom || '' }, pedidos: (await pedidosDe(code, esAbierto(e) ? '&_noche' : '')).filter(p => (p.items || []).some(x => x.n === SEGU)) }); }
      if (esSalud) { res.setHeader('Cache-Control', 'no-store'); return res.status(200).json({ ok: true, fiesta: { nombre: e.nombre, tipo: e.tipo, modoP: 'salud', mozas: [], salon: e.salon, saludNom: e.saludNom || '' }, pedidos: (await pedidosDe(code)).filter(p => (p.items || []).some(x => x.n === AYUDA)) }); }
      if (!vivoOk(e)) return res.status(403).json({ error: 'La fiesta en vivo no está activa todavía.' });
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ ok: true, fiesta: { nombre: e.nombre, tipo: e.tipo, fecha: e.fecha, hora: e.hora, mozas: e.mozas || [], modoP: esAbierto(e) ? 'barra' : (e.modoP || 'encargada'), abierto: esAbierto(e), crono: e.crono || [], carta: e.carta || [], atraso: e.atraso || 0, catering: e.catering || '', listo: e.listo || '' }, pedidos: await pedidosDe(code, esAbierto(e) ? '&_noche' : ''), avisos: (e.avisos || []).slice(-15), llegaron: (await respuestas(code)).filter(x => x.va).length, invitados: (e.invitados || []).length });
    }
    if (req.method === 'POST' && ['estado', 'avisar', 'atrasar', 'listo'].includes(acc)) {
      const b = cuerpo(req);
      const rolS = acc === 'estado' && b.s ? (skDe(e) && String(b.s) === skDe(e) ? AYUDA : gkDe(e) && String(b.s) === gkDe(e) ? SEGU : '') : '', esSalud = !!rolS;
      if (!esPersonal(b.p) && !esFamilia(b.k) && !esSalud) return res.status(403).json({ error: 'No tenés permiso.' });
      if (!vivoOk(e)) return res.status(403).json({ error: 'La fiesta en vivo no está activa todavía.' });
      if (acc === 'estado') {
        if (esSalud) { const pid = parseInt(b.id, 10), p = (await pedidosDe(code)).find(x => x.id === pid); if (!p || !(p.items || []).some(x => x.n === rolS)) return res.status(403).json({ error: 'No tenés permiso.' }); }
        const id = parseInt(b.id, 10); if (!id) return res.status(400).json({ error: 'Pedido inválido.' });
        const cambio = { tu: new Date().toISOString() };
        if (['nuevo', 'camino', 'entregado', 'cancelado'].includes(b.estado)) cambio.estado = b.estado;
        if (typeof b.moza === 'string') cambio.moza = corto(b.moza, 30);
        await rest('PATCH', 'fiesta_pedidos?id=eq.' + id + '&code=eq.' + code, cambio, 'return=minimal');
        return res.status(200).json({ ok: true });
      }
      if (esDemo) return res.status(200).json({ ok: true, demo: true });
      if (acc === 'avisar') { const txt = largo(b.txt, 160); if (!txt) return res.status(400).json({ error: 'Escribí el aviso.' }); e.avisos = (e.avisos || []).concat([{ id: Date.now().toString(36), t: new Date().toISOString(), txt }]).slice(-40); }
      if (acc === 'atrasar') e.atraso = Math.max(-120, Math.min(240, (e.atraso || 0) + (parseInt(b.min, 10) || 0)));
      if (acc === 'listo') e.listo = new Date().toISOString();
      await guardarObj(code, e);
      return res.status(200).json({ ok: true, atraso: e.atraso || 0 });
    }

    return res.status(400).json({ error: 'Acción desconocida.' });
  } catch (err) { if (process.env.DEBUG_FIESTA) console.error(err);
    return res.status(err.st || 500).json({ error: err.st ? err.message : 'Algo falló. Probá de nuevo en un momento.' });
  }
};
