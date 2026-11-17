// ShopEventos Boliche · avisos al celular de los clientes ("Mañana noche de cumbia") y reseñas.
// Lo usan el panel del dueño (clave k) y la barra (link del personal, clave p).
(function () {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const IDEAS = { dueno: ['🎶 Mañana: noche de cumbia', '🎤 Este sábado toca en vivo…', '🎂 ¿Cumplís años? Entrás gratis', '🎉 Abrimos el feriado'], barra: ['🍹 2x1 en tragos hasta la 1', '🍻 Happy hour de 0 a 1', '🥃 Jueves: primer trago gratis', '🧊 Nueva carta de tragos'] };
  const hoy = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  const fecha = s => { try { return new Date(s).toLocaleString('es-AR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return s; } };
  const estrellas = n => '★★★★★'.slice(0, Math.round(n)) + '☆☆☆☆☆'.slice(0, 5 - Math.round(n));
  window.AvisosUI = function (el, o) { // o: {code, k, p, autor: 'dueno'|'barra', resenas: bool}
    const qs = (o.k ? '&k=' + encodeURIComponent(o.k) : '') + (o.p ? '&p=' + encodeURIComponent(o.p) : '');
    const post = async (accion, body) => { const r = await fetch('/api/fiesta?accion=' + accion, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ f: o.code, k: o.k, p: o.p }, body)) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'No se pudo'); return j; };
    const quien = o.autor === 'barra' ? 'la barra' : 'el boliche';
    el.innerHTML = `<h3 style="margin-top:0">📣 Avisos al celular de tus clientes</h3>
      <p class="muted" style="margin-top:0">Le llega como notificación a todos los que pasaron por ${o.autor === 'barra' ? 'el boliche' : 'tu boliche'} y aceptaron los avisos. Aparece con el nombre y el logo. Máximo ${o.autor === 'barra' ? 2 : 3} por semana, así nadie los apaga.</p>
      <p id="avCli" style="font-weight:700">📱 …</p>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin:6px 0">${IDEAS[o.autor === 'barra' ? 'barra' : 'dueno'].map(x => `<button type="button" class="btn alt sm" data-idea="${esc(x)}">${esc(x)}</button>`).join('')}</div>
      <input id="avTit" maxlength="70" placeholder="Título: Mañana noche de cumbia 🎶" style="width:100%;box-sizing:border-box;margin:4px 0">
      <textarea id="avTxt" maxlength="300" rows="2" placeholder="Detalle: Toca tal banda. Entrada libre hasta la 1." style="width:100%;box-sizing:border-box;margin:4px 0"></textarea>
      <label style="display:block;margin:6px 0"><input type="radio" name="avCu" value="ya" checked> Mandar ahora</label>
      <label style="display:block;margin:6px 0"><input type="radio" name="avCu" value="prog"> Programar: <input type="date" id="avDia" min="${hoy()}" value="${hoy()}"> a las <input type="time" id="avHora" value="19:00" step="3600"></label>
      <p class="muted" style="margin:0">Los programados salen a las 19 h del día elegido.</p>
      <button class="btn" id="avEnv" style="margin-top:8px">📣 Enviar a mis clientes</button><p id="avMsg"></p>
      <div id="avHist"></div>${o.resenas ? '<div id="avRes" style="margin-top:14px"></div>' : ''}`;
    el.querySelector('#avHora').disabled = true; // por ahora sale a las 19 h (un envío por día)
    el.querySelectorAll('[data-idea]').forEach(b => b.onclick = () => { el.querySelector('#avTit').value = b.dataset.idea; el.querySelector('#avTxt').focus(); });
    const cargar = async () => {
      try {
        const j = await (await fetch('/api/fiesta?accion=novedades&f=' + o.code + qs)).json();
        el.querySelector('#avCli').textContent = '📱 ' + (j.clientes || 0) + ' ' + ((j.clientes === 1) ? 'cliente recibe' : 'clientes reciben') + ' tus avisos';
        const L = j.items || [];
        el.querySelector('#avHist').innerHTML = L.length ? '<h4 style="margin:12px 0 6px">Avisos mandados</h4>' + L.map(x => `<div style="border-top:1px solid #e6e1d6;padding:8px 0"><b>${x.autor === 'barra' ? '🍹 Barra' : '🏠 Boliche'} · ${esc(x.titulo)}</b>${x.texto ? '<br>' + esc(x.texto) : ''}<br><small>${x.enviado ? '✅ ' + fecha(x.enviar_at) + ' · llegó a ' + (x.n || 0) + ' celulares' : '⏳ Programado para ' + fecha(x.enviar_at) + ` <button class="btn alt sm" data-borrar="${x.id}">Cancelar</button>`}</small></div>`).join('') : '';
        el.querySelectorAll('[data-borrar]').forEach(b => b.onclick = async () => { try { await post('novedadBorrar', { id: +b.dataset.borrar }); cargar(); } catch (e) { alert(e.message); } });
      } catch (e) {}
      if (o.resenas) try {
        const r = await (await fetch('/api/fiesta?accion=resenas&f=' + o.code + qs)).json();
        el.querySelector('#avRes').innerHTML = `<h3 style="margin:0 0 6px">⭐ Reseñas de tus clientes</h3>${r.cantidad ? `<p style="font-size:20px;margin:4px 0"><b>${r.promedio}</b> <span style="color:#d4a017">${estrellas(r.promedio)}</span> · ${r.cantidad} opiniones</p>` + (r.items || []).filter(x => x.texto).slice(0, 30).map(x => `<div style="border-top:1px solid #e6e1d6;padding:6px 0"><span style="color:#d4a017">${estrellas(x.estrellas)}</span> <b>${esc(x.nombre)}</b> <small>${esc(x.noche)}</small><br>${esc(x.texto)}</div>`).join('') : '<p class="muted">Todavía no hay reseñas. Cada noche, la app le pide a cada cliente que diga cómo la pasó.</p>'}`;
      } catch (e) {}
    };
    el.querySelector('#avEnv').onclick = async () => {
      const titulo = el.querySelector('#avTit').value.trim(), texto = el.querySelector('#avTxt').value.trim(), prog = el.querySelector('[name=avCu]:checked').value === 'prog', msg = el.querySelector('#avMsg');
      if (titulo.length < 3) return (msg.textContent = 'Escribí el título del aviso.');
      const b = el.querySelector('#avEnv'); b.disabled = true; msg.textContent = 'Enviando…';
      try {
        const j = await post('novedad', { titulo, texto, dia: prog ? el.querySelector('#avDia').value : '' });
        msg.textContent = j.enviado ? '✅ Enviado: llegó a ' + j.celulares + ' celulares.' : '⏳ Programado. Sale el ' + fecha(j.programado) + '.';
        el.querySelector('#avTit').value = ''; el.querySelector('#avTxt').value = ''; cargar();
      } catch (e) { msg.textContent = '⚠️ ' + e.message; }
      b.disabled = false;
    };
    cargar();
  };
})();
