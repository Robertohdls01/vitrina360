/* 📮 Postal de recuerdo de ShopMenu · Pro Video JSRHG
   - El cliente arma su postal: fondo del café o de la ciudad, su foto (opcional), un mensaje y su firma con el dedo.
   - Abajo va la firma del dueño (hecha con el dedo o subida como foto).
   - La descarga, la comparte y, si quiere, la deja en el muro del café (el dueño la aprueba antes de que se vea). */
(function(){
  const W = 1200, H = 800;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const loadImg = src => new Promise(res => { if(!src) return res(null); const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
  const cover = (ctx, img, x, y, w, h) => { const r = Math.max(w / img.width, h / img.height), iw = img.width * r, ih = img.height * r; ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih); };
  function wrap(ctx, text, x, y, maxW, lh, maxLines){
    const words = String(text || '').split(/\s+/).filter(Boolean); let line = '', n = 0;
    for(const w of words){ const t = line ? line + ' ' + w : w; if(ctx.measureText(t).width > maxW && line){ ctx.fillText(line, x, y); y += lh; line = w; if(++n >= maxLines - 1){ break; } } else line = t; }
    if(line && n < maxLines){ let l = line; while(ctx.measureText(l + '…').width > maxW && l.length > 1) l = l.slice(0, -1); ctx.fillText(l === line ? l : l + '…', x, y); y += lh; }
    return y;
  }
  // Ilustración de la ciudad costera (dibujada, sin fotos de nadie): cielo, sol, mar, olas, arena y rambla
  function ciudad(ctx, w, h){
    let g = ctx.createLinearGradient(0, 0, 0, h * .55); g.addColorStop(0, '#ffd6e8'); g.addColorStop(1, '#ffeef5'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffc94d'; ctx.beginPath(); ctx.arc(w * .78, h * .2, 70, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.8)'; [[.18, .14, 1], [.42, .22, .8], [.62, .1, .7]].forEach(([cx, cy, s]) => { ctx.beginPath(); ctx.ellipse(w * cx, h * cy, 70 * s, 22 * s, 0, 0, Math.PI * 2); ctx.ellipse(w * cx + 40 * s, h * cy - 12 * s, 45 * s, 20 * s, 0, 0, Math.PI * 2); ctx.fill(); });
    // edificios de la rambla
    const base = h * .5; ctx.fillStyle = '#e8c9d8';
    [[.02, .12, .2], [.15, .1, .26], [.26, .09, .16], [.36, .13, .3], [.5, .08, .2], [.6, .1, .24]].forEach(([x, bw, bh]) => ctx.fillRect(w * x, base - h * bh, w * bw, h * bh));
    ctx.fillStyle = 'rgba(255,255,255,.55)'; for(let x = 10; x < w * .7; x += 26) for(let y = base - h * .28; y < base - 10; y += 26) ctx.fillRect(x, y, 8, 10);
    g = ctx.createLinearGradient(0, base, 0, h * .78); g.addColorStop(0, '#4db6d6'); g.addColorStop(1, '#2b8fb8'); ctx.fillStyle = g; ctx.fillRect(0, base, w, h * .3);
    ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 4;
    for(let r = 0; r < 4; r++){ ctx.beginPath(); const y0 = base + 30 + r * 38; for(let x = 0; x <= w; x += 20) ctx.lineTo(x, y0 + Math.sin(x / 40 + r) * 6); ctx.stroke(); }
    ctx.fillStyle = '#f3dcb0'; ctx.beginPath(); ctx.moveTo(0, h * .8); for(let x = 0; x <= w; x += 30) ctx.lineTo(x, h * .78 + Math.sin(x / 90) * 10); ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.fill();
    // sombrilla
    ctx.fillStyle = '#d6156f'; ctx.beginPath(); ctx.arc(w * .14, h * .86, 70, Math.PI, 0); ctx.fill(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(w * .14, h * .86); ctx.arc(w * .14, h * .86, 70, Math.PI * 1.33, Math.PI * 1.66); ctx.fill();
    ctx.strokeStyle = '#7a5a3a'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(w * .14, h * .86); ctx.lineTo(w * .14, h); ctx.stroke();
  }
  // Arma la postal en un canvas
  async function dibujar(cv, o){
    const ctx = cv.getContext('2d'); cv.width = W; cv.height = H;
    const fondo = o.fondoSrc ? await loadImg(o.fondoSrc) : null;
    if(fondo){ cover(ctx, fondo, 0, 0, W, H); ctx.fillStyle = 'rgba(0,0,0,.08)'; ctx.fillRect(0, 0, W, H); } else ciudad(ctx, W, H);
    // título grande sobre el fondo
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 10; ctx.fillStyle = '#fff'; ctx.font = '700 30px system-ui, sans-serif'; ctx.fillText('Saludos desde', 40, 64);
    ctx.font = '900 64px Georgia, serif'; ctx.fillText(o.ciudad || 'Mar del Plata', 40, 128); ctx.restore();
    // foto tipo polaroid
    const foto = o.fotoSrc ? await loadImg(o.fotoSrc) : null;
    if(foto){ ctx.save(); ctx.translate(90, 200); ctx.rotate(-.05); ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(0,0,0,.3)'; ctx.shadowBlur = 18; ctx.fillRect(0, 0, 380, 440); ctx.shadowBlur = 0;
      ctx.save(); ctx.beginPath(); ctx.rect(18, 18, 344, 344); ctx.clip(); cover(ctx, foto, 18, 18, 344, 344); ctx.restore();
      ctx.fillStyle = '#444'; ctx.font = 'italic 26px Georgia, serif'; ctx.textAlign = 'center'; ctx.fillText(o.fecha || '', 190, 410); ctx.restore(); }
    // tarjeta de la derecha
    const x = foto ? 520 : 600, cw = W - x - 40, y = 180, ch = H - y - 40;
    ctx.save(); ctx.fillStyle = 'rgba(255,255,255,.98)'; ctx.shadowColor = 'rgba(0,0,0,.25)'; ctx.shadowBlur = 20;
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, cw, ch, 24) : ctx.rect(x, y, cw, ch); ctx.fill(); ctx.restore();
    // estampilla
    ctx.save(); ctx.strokeStyle = '#d6156f'; ctx.setLineDash([6, 5]); ctx.lineWidth = 3; ctx.strokeRect(x + cw - 120, y + 20, 96, 110); ctx.setLineDash([]);
    ctx.fillStyle = '#ffe1ef'; ctx.fillRect(x + cw - 114, y + 26, 84, 98); ctx.font = '48px serif'; ctx.textAlign = 'center'; ctx.fillText('☕', x + cw - 72, y + 92); ctx.restore();
    ctx.fillStyle = '#2a1226'; ctx.font = '700 22px system-ui, sans-serif'; ctx.fillText('Estuve en', x + 30, y + 50);
    ctx.font = '900 40px Georgia, serif'; ctx.fillStyle = '#c8008f'; let yy = wrap(ctx, o.cafe || 'el café', x + 30, y + 96, cw - 180, 44, 2);
    ctx.fillStyle = '#6b4763'; ctx.font = '20px system-ui, sans-serif'; ctx.fillText(o.fecha || '', x + 30, yy + 4);
    ctx.fillStyle = '#2a1226'; ctx.font = 'italic 28px Georgia, serif'; yy = wrap(ctx, o.msg ? '“' + o.msg + '”' : '', x + 30, Math.max(yy + 54, y + 190), cw - 60, 36, 4);
    // firmas
    const fy = y + ch - 150;
    ctx.strokeStyle = '#e0c3d2'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x + 30, fy + 100); ctx.lineTo(x + cw / 2 - 20, fy + 100); ctx.moveTo(x + cw / 2 + 20, fy + 100); ctx.lineTo(x + cw - 30, fy + 100); ctx.stroke();
    const fc = o.firmaCli ? await loadImg(o.firmaCli) : null, fd = o.firmaDueno ? await loadImg(o.firmaDueno) : null;
    const put = (img, x0, w0) => { if(!img) return; const r = Math.min(w0 / img.width, 90 / img.height); ctx.drawImage(img, x0 + (w0 - img.width * r) / 2, fy + 96 - img.height * r, img.width * r, img.height * r); };
    put(fc, x + 30, cw / 2 - 50); put(fd, x + cw / 2 + 20, cw / 2 - 50);
    ctx.fillStyle = '#6b4763'; ctx.font = '18px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(o.nombre ? o.nombre : 'Mi firma', x + cw / 4, fy + 124); ctx.fillText(o.dueno ? o.dueno + ' · ' + (o.cafe || '') : (o.cafe || 'El café'), x + cw * 3 / 4, fy + 124);
    ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = '600 16px system-ui, sans-serif'; ctx.fillText('ShopMenu · Pro Video JSRHG', 40, H - 18);
    return cv;
  }
  // Panel de firma con el dedo
  function pad(cv){
    const ctx = cv.getContext('2d'); let on = false, used = false, last = null;
    const fit = () => { const r = cv.getBoundingClientRect(); cv.width = Math.max(300, r.width * 2); cv.height = Math.max(120, r.height * 2); ctx.lineWidth = 5; ctx.lineCap = ctx.lineJoin = 'round'; ctx.strokeStyle = '#1f2a6b'; };
    const pt = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
    cv.style.touchAction = 'none';
    cv.addEventListener('pointerdown', e => { on = true; used = true; last = pt(e); cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', e => { if(!on) return; const p = pt(e); ctx.beginPath(); ctx.moveTo(last[0], last[1]); ctx.lineTo(p[0], p[1]); ctx.stroke(); last = p; });
    ['pointerup', 'pointercancel'].forEach(ev => cv.addEventListener(ev, () => { on = false; cv.dispatchEvent(new Event('firma')); }));
    requestAnimationFrame(fit);
    return {clear(){ ctx.clearRect(0, 0, cv.width, cv.height); used = false; cv.dispatchEvent(new Event('firma')); }, png(){ return used ? recorte(cv) : ''; }, get used(){ return used; }};
  }
  // recorta la firma a lo que tiene tinta (para que entre prolija en la postal)
  function recorte(src){
    const c = src.getContext('2d'), d = c.getImageData(0, 0, src.width, src.height).data; let x0 = src.width, y0 = src.height, x1 = 0, y1 = 0;
    for(let y = 0; y < src.height; y += 2) for(let x = 0; x < src.width; x += 2){ if(d[(y * src.width + x) * 4 + 3] > 20){ if(x < x0) x0 = x; if(x > x1) x1 = x; if(y < y0) y0 = y; if(y > y1) y1 = y; } }
    if(x1 <= x0) return ''; const p = 8, w = Math.min(src.width, x1 - x0 + p * 2), h = Math.min(src.height, y1 - y0 + p * 2), o = document.createElement('canvas');
    const k = Math.min(1, 600 / w); o.width = Math.round(w * k); o.height = Math.round(h * k); o.getContext('2d').drawImage(src, Math.max(0, x0 - p), Math.max(0, y0 - p), w, h, 0, 0, o.width, o.height);
    return o.toDataURL('image/png');
  }
  // Foto de una firma en papel: saca el fondo blanco y deja solo la tinta
  function firmaDeFoto(file){
    return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => { const i = new Image(); i.onload = () => {
      const k = Math.min(1, 900 / Math.max(i.width, i.height)), c = document.createElement('canvas'); c.width = Math.round(i.width * k); c.height = Math.round(i.height * k);
      const x = c.getContext('2d'); x.drawImage(i, 0, 0, c.width, c.height); const im = x.getImageData(0, 0, c.width, c.height), d = im.data;
      let sum = 0; for(let j = 0; j < d.length; j += 4) sum += (d[j] + d[j + 1] + d[j + 2]) / 3; const avg = sum / (d.length / 4), cut = avg * .72;
      for(let j = 0; j < d.length; j += 4){ const l = (d[j] + d[j + 1] + d[j + 2]) / 3; if(l > cut){ d[j + 3] = 0; } else { d[j] = 25; d[j + 1] = 35; d[j + 2] = 100; d[j + 3] = Math.min(255, (cut - l) * 4); } }
      x.putImageData(im, 0, 0); res(recorte(c)); }; i.onerror = rej; i.src = fr.result; }; fr.onerror = rej; fr.readAsDataURL(file); });
  }
  const achicar = (file, max) => new Promise(res => { const fr = new FileReader(); fr.onload = () => { const i = new Image(); i.onload = () => { const k = Math.min(1, max / Math.max(i.width, i.height)), c = document.createElement('canvas'); c.width = Math.round(i.width * k); c.height = Math.round(i.height * k); c.getContext('2d').drawImage(i, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', .85)); }; i.onerror = () => res(''); i.src = fr.result; }; fr.readAsDataURL(file); });
  const hoy = () => new Date().toLocaleDateString('es-AR', {day: 'numeric', month: 'long', year: 'numeric'});
  const sheet = html => { const d = document.createElement('div'); d.className = 'sheet'; d.style.zIndex = 95; d.innerHTML = `<div style="max-height:92vh">${html}</div>`; document.body.appendChild(d); d.addEventListener('click', e => { if(e.target === d) d.remove(); }); return d; };
  const CSS = `.pvp-pad{width:100%;height:130px;border:2px dashed #d6156f;border-radius:14px;background:#fff;display:block}.pvp-prev{width:100%;border-radius:12px;box-shadow:0 6px 20px rgba(0,0,0,.18)}.pvp-row{display:flex;gap:8px;flex-wrap:wrap}.pvp-row>*{flex:1 1 140px}.pvp-mini{font-size:13px;color:#6b4763}`;
  const css = () => { if(!document.getElementById('pvpCss')){ const s = document.createElement('style'); s.id = 'pvpCss'; s.textContent = CSS; document.head.appendChild(s); } };

  // ===== Cliente: armar y llevarse la postal =====
  async function abrir(o){
    css(); let cfg = {}; try{ cfg = await (await fetch('/api/menu?postalcfg=' + encodeURIComponent(o.id))).json(); }catch(e){}
    const fondoSrc = cfg.fondo === 'local' ? '/api/menu?fondo=' + encodeURIComponent(o.id) + '&v=' + (cfg.fondoV || '') : '';
    const d = sheet(`<h2 style="margin:0">📮 Tu postal de recuerdo</h2>
      <p class="pvp-mini" style="margin:0">Firmala, descargala y llevátela${cfg.muro ? '. Si querés, queda también en el muro de ' + esc(cfg.nombre || 'este café') : ''}.</p>
      <canvas class="pvp-prev" id="pvpPrev"></canvas>
      <input id="pvpNom" maxlength="30" placeholder="Tu nombre" value="${esc(o.nombre || '')}">
      <textarea id="pvpMsg" rows="2" maxlength="160" placeholder="Un mensaje (ej: ¡El mejor submarino de la costa! Volvimos desde Córdoba)"></textarea>
      <label class="btn sec" style="cursor:pointer;text-align:center">📸 Sumar una foto (opcional)<input type="file" accept="image/*" capture="user" id="pvpFoto" hidden></label>
      <b>✍️ Firmá con el dedo</b><canvas class="pvp-pad" id="pvpPad"></canvas>
      <div class="pvp-row"><button class="btn sec" type="button" id="pvpBorrar">🧽 Borrar firma</button></div>
      ${cfg.muro ? '<label style="display:flex;gap:8px;align-items:center;font-weight:600"><input type="checkbox" id="pvpMuro" checked style="width:auto"> Dejarla en el muro del café</label>' : ''}
      <div class="pvp-row"><button class="btn pri" type="button" id="pvpOk">📥 Descargar mi postal</button><button class="btn sec" type="button" id="pvpShare" hidden>📤 Compartir</button></div>
      <button class="btn sec" type="button" id="pvpX">Cerrar</button>`);
    const $ = s => d.querySelector(s), P = pad($('#pvpPad')); let foto = '', t = null;
    const datos = () => ({cafe: cfg.nombre || o.cafe || '', ciudad: cfg.ciudad || 'Mar del Plata', dueno: cfg.dueno || '', firmaDueno: cfg.firma || '', fondoSrc, fotoSrc: foto, msg: $('#pvpMsg').value.trim(), nombre: $('#pvpNom').value.trim(), firmaCli: P.png(), fecha: hoy()});
    const prev = () => { clearTimeout(t); t = setTimeout(() => dibujar($('#pvpPrev'), datos()), 250); };
    ['#pvpNom', '#pvpMsg'].forEach(s => $(s).addEventListener('input', prev)); $('#pvpPad').addEventListener('firma', prev);
    $('#pvpFoto').onchange = async e => { const f = e.target.files && e.target.files[0]; if(f){ foto = await achicar(f, 900); prev(); } };
    $('#pvpBorrar').onclick = () => P.clear(); $('#pvpX').onclick = () => d.remove();
    if(navigator.canShare) $('#pvpShare').hidden = false;
    const blob = async () => { const cv = await dibujar(document.createElement('canvas'), datos()); return {cv, b: await new Promise(r => cv.toBlob(r, 'image/jpeg', .88))}; };
    const nombreArch = () => 'Postal ' + (cfg.nombre || 'cafe').replace(/[^\p{L}\p{N} ]/gu, '') + '.jpg';
    $('#pvpOk').onclick = async () => {
      if(!P.used){ alert('Firmá la postal con el dedo antes de descargarla ✍️'); return; }
      const bt = $('#pvpOk'); bt.disabled = true; bt.textContent = 'Armando tu postal…';
      const {cv, b} = await blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = nombreArch(); document.body.appendChild(a); a.click(); setTimeout(() => { a.remove(); URL.revokeObjectURL(a.href); }, 4000);
      if(cfg.muro && $('#pvpMuro') && $('#pvpMuro').checked && !bt.dataset.subida){ try{ await fetch('/api/menu?accion=postal', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id: o.id, mesa: o.mesa || 0, nombre: $('#pvpNom').value, msg: $('#pvpMsg').value, img: cv.toDataURL('image/jpeg', .72)})}); bt.dataset.subida = '1'; }catch(e){} }
      bt.disabled = false; bt.textContent = '✅ ¡Descargada! (otra vez)';
      if(o.onDone) o.onDone(!!bt.dataset.subida);
    };
    $('#pvpShare').onclick = async () => { if(!P.used){ alert('Firmá la postal con el dedo ✍️'); return; } const {b} = await blob(); const f = new File([b], nombreArch(), {type: 'image/jpeg'}); try{ await navigator.share({files: [f], title: 'Mi postal de ' + (cfg.nombre || 'el café')}); }catch(e){} };
    prev();
  }

  // ===== Muro de postales (público) =====
  async function muro(o){
    css(); let j = {items: []}; try{ j = await (await fetch('/api/menu?id=' + encodeURIComponent(o.id) + '&postales=1')).json(); }catch(e){}
    const d = sheet(`<h2 style="margin:0">📮 Muro de postales</h2>${(j.items || []).length ? '<div style="display:grid;gap:10px">' + j.items.map(x => `<figure style="margin:0"><img loading="lazy" src="/api/menu?id=${encodeURIComponent(o.id)}&postal=${x.id}" alt="Postal de ${esc(x.nombre)}" style="width:100%;border-radius:12px"><figcaption class="pvp-mini">${esc(x.nombre || 'Cliente')}${x.msg ? ' · “' + esc(x.msg) + '”' : ''}</figcaption></figure>`).join('') + '</div>' : '<p>Todavía no hay postales. ¡Sé el primero en dejar la tuya!</p>'}<button class="btn sec" type="button" data-x>Cerrar</button>`);
    d.querySelector('[data-x]').onclick = () => d.remove();
  }

  // ===== Dueño (caja): firma, fondo y aprobar postales =====
  async function dueno(o){
    css(); let cfg = {}; try{ cfg = await (await fetch('/api/menu?postalcfg=' + encodeURIComponent(o.id))).json(); }catch(e){}
    let firma = cfg.firma || '';
    const d = sheet(`<h2 style="margin:0">📮 Postal de recuerdo</h2>
      <p class="pvp-mini" style="margin:0">Tus clientes firman una postal del café, se la llevan y la pueden dejar en tu muro. Abajo va tu firma.</p>
      <canvas class="pvp-prev" id="pdPrev"></canvas>
      <label>Fondo de la postal<select id="pdFondo"><option value="ciudad">🏖️ Dibujo de la ciudad</option><option value="local">📷 La foto de fondo de mi local</option></select></label>
      <div class="pvp-row"><input id="pdCiudad" maxlength="40" placeholder="Ciudad" value="${esc(cfg.ciudad || 'Mar del Plata')}"><input id="pdDueno" maxlength="40" placeholder="Tu nombre (va abajo de tu firma)" value="${esc(cfg.dueno || o.dueno || '')}"></div>
      <b>✍️ Tu firma</b><p class="pvp-mini" style="margin:0">Firmá con el dedo, o si te queda más prolija en papel, sacale una foto y subila: le saco el fondo sola.</p>
      <canvas class="pvp-pad" id="pdPad"></canvas>
      <div class="pvp-row"><button class="btn sec" type="button" id="pdBorrar">🧽 Borrar</button><label class="btn sec" style="cursor:pointer;text-align:center">📷 Subir foto de mi firma<input type="file" accept="image/*" id="pdFoto" hidden></label></div>
      <label style="display:flex;gap:8px;align-items:center;font-weight:600"><input type="checkbox" id="pdMuro" ${cfg.muro === false ? '' : 'checked'} style="width:auto"> Mostrar el muro de postales a mis clientes</label>
      <button class="btn pri" type="button" id="pdOk">Guardar</button>
      <h3 style="margin:8px 0 0">Postales de tus clientes</h3><p class="pvp-mini" style="margin:0">Las nuevas no se ven en el muro hasta que tocás ✅.</p><div id="pdLista">Cargando…</div>
      <button class="btn sec" type="button" id="pdX">Cerrar</button>`);
    const $ = s => d.querySelector(s), P = pad($('#pdPad'));
    if(cfg.fondoV){ $('#pdFondo').value = cfg.fondo; } else { $('#pdFondo').querySelector('[value=local]').disabled = true; $('#pdFondo').querySelector('[value=local]').textContent += ' (primero subí una en Carta y precios)'; }
    const datos = () => ({cafe: cfg.nombre || '', ciudad: $('#pdCiudad').value.trim() || 'Mar del Plata', dueno: $('#pdDueno').value.trim(), firmaDueno: P.used ? P.png() : firma, fondoSrc: $('#pdFondo').value === 'local' && cfg.fondoV ? '/api/menu?fondo=' + encodeURIComponent(o.id) + '&v=' + cfg.fondoV : '', msg: '¡Gracias por visitarnos!', nombre: 'Tu cliente', fecha: hoy()});
    let t = null; const prev = () => { clearTimeout(t); t = setTimeout(() => dibujar($('#pdPrev'), datos()), 250); };
    ['#pdCiudad', '#pdDueno'].forEach(s => $(s).addEventListener('input', prev)); $('#pdFondo').onchange = prev; $('#pdPad').addEventListener('firma', prev);
    $('#pdBorrar').onclick = () => { P.clear(); firma = ''; prev(); };
    $('#pdFoto').onchange = async e => { const f = e.target.files && e.target.files[0]; if(!f) return; try{ firma = await firmaDeFoto(f); P.clear(); prev(); }catch(err){ alert('No pude leer esa foto. Probá con otra, con buena luz y la firma en birome sobre papel blanco.'); } };
    $('#pdX').onclick = () => d.remove();
    $('#pdOk').onclick = async () => {
      const f = P.used ? P.png() : firma;
      try{ const r = await fetch('/api/menu?accion=postalcfg', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id: o.id, clave: o.clave, fondo: $('#pdFondo').value, ciudad: $('#pdCiudad').value, dueno: $('#pdDueno').value, firma: f, muro: $('#pdMuro').checked})});
        const j = await r.json(); if(!r.ok) throw new Error(j.error || 'No se pudo guardar.'); firma = f; $('#pdOk').textContent = '✅ Guardado'; setTimeout(() => { $('#pdOk').textContent = 'Guardar'; }, 1800); }catch(err){ alert(err.message); }
    };
    const lista = async () => {
      let j = {items: []}; try{ j = await (await fetch('/api/menu?id=' + encodeURIComponent(o.id) + '&postales=1&clave=' + encodeURIComponent(o.clave))).json(); }catch(e){}
      $('#pdLista').innerHTML = (j.items || []).length ? j.items.map(x => `<div style="display:grid;grid-template-columns:110px 1fr;gap:8px;align-items:center;border-bottom:1px solid #f3d6e5;padding:6px 0"><img loading="lazy" src="/api/menu?id=${encodeURIComponent(o.id)}&postal=${x.id}&clave=${encodeURIComponent(o.clave)}" style="width:110px;border-radius:8px" alt=""><div><b>${esc(x.nombre || 'Cliente')}</b>${x.mesa ? ' · mesa ' + x.mesa : ''}<div class="pvp-mini">${esc(x.msg || '')}</div><div class="pvp-row" style="margin-top:4px">${x.ok ? '<button class="btn sec" type="button" data-ok="0" data-p="' + x.id + '">🙈 Ocultar</button>' : '<button class="btn pri" type="button" data-ok="1" data-p="' + x.id + '">✅ Mostrar en el muro</button>'}<button class="btn sec" type="button" data-del="${x.id}">🗑️ Borrar</button></div></div></div>`).join('') : '<p class="pvp-mini">Todavía no hay postales.</p>';
    };
    $('#pdLista').addEventListener('click', async e => { const b = e.target.closest('[data-p],[data-del]'); if(!b) return;
      if(b.dataset.del && !confirm('¿Borrar esta postal?')) return;
      await fetch('/api/menu?accion=postalok', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(b.dataset.del ? {id: o.id, clave: o.clave, pid: b.dataset.del, borrar: true} : {id: o.id, clave: o.clave, pid: b.dataset.p, ok: b.dataset.ok === '1'})}); lista(); });
    prev(); lista();
  }
  window.PVPostal = {abrir, muro, dueno, dibujar};
})();
