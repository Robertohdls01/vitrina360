// Vitrina 360 · contador de visitas propio (gratis, sin cookies de terceros).
// Cada página lo incluye con <script src="/estad.js" data-p="inicio" defer></script>.
// Manda: qué página, de dónde vino la visita y un número al azar por navegador (para no contar dos veces a la misma persona).
(function(){
  try{
    var me = document.currentScript, p = (me && me.getAttribute('data-p')) || 'inicio';
    if(p === 'tienda' && !/^\/t\//.test(location.pathname)) return;   // el panel del dueño no cuenta como visita
    if(/^(localhost|127\.)/.test(location.hostname)) return;
    var q = new URLSearchParams(location.search), v = '';
    try{ v = localStorage.getItem('v360-vis') || ''; if(!v){ v = Math.random().toString(36).slice(2, 12); localStorage.setItem('v360-vis', v); } }catch(e){ v = Math.random().toString(36).slice(2, 12); }
    var ref = (q.get('ref') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
    var src = (q.get('utm_source') || q.get('fuente') || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24);
    var host = ''; try{ host = document.referrer ? new URL(document.referrer).hostname : ''; }catch(e){}
    if(host === location.hostname) host = '';
    var body = JSON.stringify({p: p, v: v, ref: ref, src: src, host: host, slug: (location.pathname.match(/^\/t\/([a-z0-9-]+)/) || [])[1] || ''});
    fetch('/api/estadisticas?accion=visita', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: body, keepalive: true}).catch(function(){});
  }catch(e){}
})();
