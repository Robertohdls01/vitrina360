// ShopGuía · "Flashy, tu compañero de viaje: te guía, te cuida y te dice qué comer"
// Los lugares y paseos de cada ciudad están cargados en la página (andan sin internet); la IA solo se usa para:
//   POST ?accion=preguntar {q, lang, ciudad, cerca:[nombres], hist:[{role,content}], perfil}  → {texto}
//   POST ?accion=foto      {img (dataURL jpeg), lang, perfil}                                   → {texto}   "¿Qué es esto?" (plato o carta)
//   POST ?accion=traducir  {lang, textos:[...]}                                                  → {textos}
// Tope global por día (GUIA_IA_DIA, 2500 por defecto) para que el costo no se dispare.
const { cuerpo } = require('./_comun');

const BUCKET = 'pedidos';
const base = () => String(process.env.SUPABASE_URL || '').replace(/\/+$/, '') + '/storage/v1';
const head = extra => { const k = process.env.SUPABASE_SERVICE_KEY, h = Object.assign({ apikey: k }, extra || {}); if (String(k).startsWith('eyJ')) h.Authorization = 'Bearer ' + k; return h; };
const t = (v, n) => String(v == null ? '' : v).slice(0, n);
const IDI = { es: 'castellano rioplatense (Argentina), cálido y simple', neutro: 'español neutro internacional (sin voseo ni modismos locales), cálido y simple', en: 'English', pt: 'português do Brasil', fr: 'français', it: 'italiano', de: 'Deutsch', ru: 'русский', zh: '简体中文', ja: '日本語', ko: '한국어', hi: 'हिन्दी', ar: 'العربية', tr: 'Türkçe', id: 'Bahasa Indonesia', vi: 'Tiếng Việt', th: 'ภาษาไทย', pl: 'polski', uk: 'українська', nl: 'Nederlands', sw: 'Kiswahili', bn: 'বাংলা', ur: 'اردو', fa: 'فارسی', ha: 'Hausa', am: 'አማርኛ', ms: 'Bahasa Melayu', tl: 'Filipino', el: 'Ελληνικά', cs: 'čeština', ro: 'română', hu: 'magyar', sv: 'svenska', da: 'dansk', nb: 'norsk', fi: 'suomi', he: 'עברית', ta: 'தமிழ்', sr: 'srpski', yo: 'Yorùbá', zu: 'isiZulu' };

async function leer(path) { try { const r = await fetch(base() + '/object/' + BUCKET + '/' + path, { headers: head({ 'cache-control': 'no-cache' }) }); return r.ok ? await r.json() : null; } catch (e) { return null; } }
async function guardar(path, obj) { try { await fetch(base() + '/object/' + BUCKET + '/' + path, { method: 'POST', headers: head({ 'Content-Type': 'application/json', 'x-upsert': 'true', 'cache-control': 'no-cache' }), body: JSON.stringify(obj) }); } catch (e) {} }

async function cupo() {
  const hoy = new Date().toISOString().slice(0, 10), p = 'guia/uso-' + hoy + '.json', u = (await leer(p)) || { n: 0 };
  if (u.n >= Number(process.env.GUIA_IA_DIA || 2500)) return false;
  u.n++; await guardar(p, u); return true;
}

async function claude(system, content, max) {
  if (process.env.MOCK_IA) return 'Respuesta de prueba de Flashy sobre: ' + (typeof content === 'string' ? content : 'la foto').slice(0, 60);
  const KEY = process.env.ANTHROPIC_API_KEY; if (!KEY) return '';
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: process.env.IA_MODEL_TEXT || 'claude-haiku-5-5', max_tokens: max, system, messages: Array.isArray(content) && content[0] && content[0].role ? content : [{ role: 'user', content }] }) });
  if (!r.ok) return '';
  const j = await r.json(); return (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('').replace(/[*#_`]/g, '').trim();
}

const perfilTx = p => {
  if (!p || typeof p !== 'object') return '';
  const x = [];
  if (p.con) x.push('viaja ' + t(p.con, 20));
  if (p.dieta) x.push('dieta/alergias: ' + t(p.dieta, 120));
  if (p.mov) x.push('se mueve ' + t(p.mov, 20));
  return x.length ? 'Datos del viajero: ' + x.join('; ') + '.' : '';
};

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Usá POST.' });
  const a = String(req.query.accion || ''), b = cuerpo(req), lang = IDI[b.lang] ? b.lang : 'es';
  try {
    if (a === 'mundo') { // ShopRevista Mundial: la búsqueda traducida para cada tienda del mundo
      const q = t(b.q, 120).trim(); if (!q) return res.status(400).json({ error: 'Decime qué buscás 😊' });
      if (!(await cupo())) return res.status(429).json({ error: 'cupo' });
      const out = await claude('Convertís lo que alguien quiere comprar en palabras clave cortas para buscar en tiendas online de cada país. Devolvé SOLO un objeto JSON, sin comentarios.', `Producto buscado (puede estar en cualquier idioma): "${q}"\nDevolvé {"es":"…","en":"…","pt":"…","ru":"…","ja":"…","zh":"…","ko":"…","rubro":"…","consejo":"…"} con 1 a 4 palabras por idioma (como se busca en esa tienda), "rubro" = una palabra en castellano (tecnologia, hogar, belleza, moda, deporte, chicos, mascotas, salud, auto, otros) y "consejo" = un consejo corto de compra (máx. 120 caracteres) escrito en ${IDI[lang]}.`, 600);
      let o = null; try { o = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)); } catch (e) {}
      if (!o) o = { es: q, en: q };
      Object.keys(o).forEach(k => { o[k] = t(o[k], 160); });
      return res.status(200).json(o);
    }
    if (a === 'ideas') { // ShopRevista Mundial: ideas de productos para un negocio
      const q = t(b.q, 120).trim(), pais = t(b.pais, 40) || 'cualquier país';
      if (!(await cupo())) return res.status(429).json({ error: 'cupo' });
      const out = await claude('Sos Flashy, asesora de comercio internacional de ShopRevista Mundial. Proponés productos novedosos y poco conocidos para vender, honestos y legales (nada de réplicas de marcas, armas, medicamentos ni productos prohibidos de importar). Devolvé SOLO un objeto JSON, sin comentarios.',
        `La persona vive en: ${pais}. Rubro o interés: "${q || 'cualquiera'}".\nDevolvé {"intro":"…","ideas":[{"producto":"…","porque":"…","donde":"…","buscar":"…","consejo":"…"}]} con 5 ideas. "producto" = nombre corto; "porque" = por qué puede venderse bien en su país (máx. 110 caracteres); "donde" = país o región donde conviene conseguirlo; "buscar" = 2 a 4 palabras en inglés para buscarlo en directorios de proveedores; "consejo" = cómo venderlo o qué revisar antes de comprar (máx. 110 caracteres); "intro" = una frase cálida. Todo el texto (menos "buscar") escrito en ${IDI[lang]}, con palabras neutras que se entiendan en cualquier país. Aclarar en "intro" que son ideas para verificar, no garantías de ganancia.`, 1200);
      let o = null; try { o = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)); } catch (e) {}
      if (!o || !Array.isArray(o.ideas)) return res.status(502).json({ error: 'sin ideas' });
      o.ideas = o.ideas.slice(0, 6).map(x => ({ producto: t(x.producto, 80), porque: t(x.porque, 160), donde: t(x.donde, 60), buscar: t(x.buscar, 60), consejo: t(x.consejo, 160) }));
      o.intro = t(o.intro, 240);
      return res.status(200).json(o);
    }
    if (a === 'traducir') {
      const L = (Array.isArray(b.textos) ? b.textos : []).slice(0, 30).map(x => t(x, 700));
      if (!L.length || lang === 'es') return res.status(200).json({ textos: L });
      if (!(await cupo())) return res.status(429).json({ error: 'cupo' });
      const out = await claude('Sos traductor. Devolvé SOLO un array JSON de strings, mismo orden y cantidad, sin comentarios.', `Traducí al ${IDI[lang]} manteniendo nombres propios y emojis:\n${JSON.stringify(L)}`, 2500);
      let arr = null; try { arr = JSON.parse(out.slice(out.indexOf('['), out.lastIndexOf(']') + 1)); } catch (e) {}
      return res.status(200).json({ textos: Array.isArray(arr) && arr.length === L.length ? arr.map(x => t(x, 900)) : L });
    }
    if (a === 'preguntar') {
      const q = t(b.q, 400).trim(); if (!q) return res.status(400).json({ error: 'Preguntame algo 😊' });
      if (!(await cupo())) return res.status(429).json({ error: 'Hoy ya respondí muchísimas preguntas 😅 Probá con los botones, que andan igual.' });
      const ciudad = t(b.ciudad, 60) || 'Mar del Plata', cerca = (Array.isArray(b.cerca) ? b.cerca : []).slice(0, 8).map(x => t(x, 60)).join(', ');
      const sys = `Sos Flashy, guía turística virtual de ShopGuía (Pro Video JSRHG). Acompañás a un viajero en ${ciudad}, Argentina. Respondé en ${IDI[lang]}, cálido, con buen humor, como un amigo que conoce la ciudad.
${perfilTx(b.perfil)} ${cerca ? 'Lugares cerca del viajero ahora: ' + cerca + '.' : ''}
Tus respuestas se leen en voz alta: máximo 90 palabras, sin listas largas, sin markdown ni asteriscos.
Reglas: contá solo cosas que sepas con seguridad (historia y datos conocidos). No inventes direcciones exactas, precios, horarios ni nombres de comercios: si te piden eso, decí que lo confirmen con el botón "Cómo llego" (Google Maps) o en el lugar. En salud y alergias, consejos generales y "consultá con un médico"; en emergencia, 911 (policía), 107 (ambulancia) o 100 (bomberos). Si preguntan algo que no es de viaje, respondé breve y volvé al paseo.`;
      const hist = (Array.isArray(b.hist) ? b.hist : []).slice(-6).filter(m => m && (m.role === 'user' || m.role === 'assistant')).map(m => ({ role: m.role, content: t(m.content, 600) }));
      while (hist.length && hist[0].role !== 'user') hist.shift();
      const txt = await claude(sys, hist.concat([{ role: 'user', content: q }]), 400);
      return txt ? res.status(200).json({ texto: txt }) : res.status(502).json({ error: 'Me distraje un segundo 😅 Preguntame de nuevo.' });
    }
    if (a === 'foto') {
      const img = String(b.img || ''), m = img.match(/^data:image\/(jpeg|png|webp);base64,(.+)$/);
      if (!m || img.length > 2200000) return res.status(400).json({ error: 'No pude leer la foto. Probá de nuevo con más luz.' });
      if (!(await cupo())) return res.status(429).json({ error: 'Hoy ya miré muchísimas fotos 😅 Probá mañana.' });
      const sys = `Sos Flashy, guía de viaje. Te muestran una foto de un plato, una comida, una bebida o una carta de restaurante (puede estar en otro idioma). Respondé en ${IDI[lang]}, breve (máximo 110 palabras, se lee en voz alta, sin markdown):
- qué es y de dónde es típico;
- ingredientes probables, si pica o es pesado;
- avisos de alérgenos comunes (gluten, maní, frutos secos, mariscos, lácteos, huevo).
${perfilTx(b.perfil)} Si el viajero tiene alergias o dieta, decile claramente si el plato podría no ser apto y que lo confirme siempre con el mozo. Si es una carta, contá los 3 o 4 platos más recomendables y qué son. Si no se ve bien, pedí otra foto. Nunca afirmes con certeza ingredientes que no se ven.`;
      const txt = await claude(sys, [{ type: 'image', source: { type: 'base64', media_type: 'image/' + m[1], data: m[2] } }, { type: 'text', text: '¿Qué es esto?' }], 450);
      return txt ? res.status(200).json({ texto: txt }) : res.status(502).json({ error: 'No pude mirar bien la foto 😅 Probá de nuevo.' });
    }
    return res.status(400).json({ error: 'Acción desconocida.' });
  } catch (e) {
    return res.status(500).json({ error: 'Algo falló. Probá de nuevo.' });
  }
};
