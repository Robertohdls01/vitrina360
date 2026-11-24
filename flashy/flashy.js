/* Flashy, la cara de Pro Video JSRHG.
   - FLASHY_HTML({redonda}) arma a Flashy en video: saluda cuando está quieta y gesticula cuando habla.
   - La boca sigue a la voz: mueve los labios en cada palabra, hace una pausa en comas y puntos,
     arranca cada vez en un gesto distinto y cierra la boca apenas termina de hablar. */
(function(){
  if(window.FLASHY_HTML) return;
  var V = '/flashy/';
  window.FLASHY_HTML = function(o){
    o = o || {};
    return '<span class="flashyv' + (o.redonda ? ' red' : '') + '" aria-hidden="true">' +
      '<video class="vi" src="' + V + 'flashy-saluda.mp4" poster="' + V + (o.redonda ? 'flashy-cara.jpg' : 'flashy.jpg') + '" autoplay muted loop playsinline preload="auto"></video>' +
      '<video class="vh" src="' + V + 'flashy-habla.mp4" muted loop playsinline preload="auto"></video></span>';
  };
  var css = '.flashyv{display:block;position:relative;width:100%;height:100%;border-radius:20px;overflow:hidden;border:3px solid #ff5fc8;box-shadow:0 8px 22px rgba(200,0,143,.3);background:#f6c9e6 url(' + V + 'flashy.jpg) center/cover}' +
    '.flashyv.red{border-radius:50%;background-image:url(' + V + 'flashy-cara.jpg)}' +
    '.flashyv video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}' +
    '.flashyv.red video{object-position:50% 18%}' +
    '.flashyv .vh{opacity:0;transition:opacity .18s}' +
    '.flashyv.fl-h .vh,.habla .flashyv .vh,.talk .flashyv .vh,.talking .flashyv .vh,.flashyv.talk .vh{opacity:1}';
  function ponerCSS(){ if(document.getElementById('flashy-css')) return; var s = document.createElement('style'); s.id = 'flashy-css'; s.textContent = css; (document.head || document.documentElement).appendChild(s); }
  ponerCSS(); document.addEventListener('DOMContentLoaded', ponerCSS);


  // ---- tamaños de Flashy: chica, mediana, grande, muy grande (cada celular recuerda el suyo) ----
  var TAMS = [0.8, 1, 1.35, 1.75], NOMS = ['chica', 'mediana', 'grande', 'muy grande'];
  function tamIdx(){ var i = -1; try{ i = parseInt(localStorage.getItem('flashy-tam'), 10); }catch(e){} if(!(i >= 0 && i < TAMS.length)) i = (window.innerWidth || 800) < 640 ? 2 : 1; return i; }
  function aplicarTam(){ document.documentElement.style.setProperty('--fl-k', TAMS[tamIdx()]); }
  aplicarTam();
  window.FLASHY_BOTON = '<button type="button" class="fltam" aria-label="Cambiar el tamaño de Flashy" title="Tamaño de Flashy">⤢</button>';
  css += '.fltam{position:absolute;left:-6px;top:-6px;z-index:5;width:26px;height:26px;border-radius:50%;border:2px solid #fff;background:#c8008f;color:#fff;font:900 14px/1 system-ui;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.25);padding:0;display:grid;place-items:center}' +
    '.fltoast{position:fixed;left:50%;top:18px;transform:translateX(-50%);background:#c8008f;color:#fff;border-radius:999px;padding:8px 16px;font:800 14px system-ui;z-index:99999;box-shadow:0 6px 18px rgba(0,0,0,.25)}';
  var st = document.getElementById('flashy-css'); if(st) st.textContent = css;
  document.addEventListener('click', function(e){
    var b = e.target.closest && e.target.closest('.fltam'); if(!b) return;
    e.preventDefault(); e.stopPropagation();
    var i = (tamIdx() + 1) % TAMS.length; try{ localStorage.setItem('flashy-tam', i); }catch(_){} aplicarTam();
    var t = document.createElement('div'); t.className = 'fltoast'; t.textContent = '⚡ Flashy ' + NOMS[i]; document.body.appendChild(t); setTimeout(function(){ t.remove(); }, 1300);
  }, true);
  // ---- la boca sigue a la voz ----
  var hablando = false, callar = null, pausa = null, hubo = false;
  function bocas(){ return Array.prototype.slice.call(document.querySelectorAll('video.vh')); }
  function caras(){ return Array.prototype.slice.call(document.querySelectorAll('.flashyv')); }
  function mover(){ bocas().forEach(function(v){ if(v.paused){ var p = v.play(); if(p && p.catch) p.catch(function(){}); } }); }
  function quieta(){ bocas().forEach(function(v){ try{ v.pause(); }catch(e){} }); }
  function empezar(){
    clearTimeout(callar); hubo = false;
    if(!hablando){ bocas().forEach(function(v){ try{ if(v.duration) v.currentTime = Math.random() * Math.max(0, v.duration - 0.6); }catch(e){} }); }
    hablando = true; caras().forEach(function(c){ c.classList.add('fl-h'); }); mover();
  }
  function palabra(e){
    if(e && e.name && e.name !== 'word') return;
    hubo = true; clearTimeout(pausa); clearTimeout(callar);
    var t = (e && e.utterance && e.utterance.text) || '', i = (e && e.charIndex) || 0, antes = t.slice(Math.max(0, i - 3), i);
    if(/[.,;:!?…]/.test(antes)){ quieta(); pausa = setTimeout(mover, 230); } else mover();
    callar = setTimeout(quieta, 700); // si no llegan más palabras, cierra la boca
  }
  function terminar(){
    clearTimeout(callar); clearTimeout(pausa);
    setTimeout(function(){
      try{ if(window.speechSynthesis && (speechSynthesis.speaking || speechSynthesis.pending)) return; }catch(e){}
      hablando = false; quieta(); caras().forEach(function(c){ c.classList.remove('fl-h'); });
    }, 160);
  }
  try{
    if(window.speechSynthesis && !speechSynthesis.__flashy){
      var orig = speechSynthesis.speak.bind(speechSynthesis);
      speechSynthesis.speak = function(u){
        try{ u.addEventListener('start', empezar); u.addEventListener('boundary', palabra); u.addEventListener('end', terminar); u.addEventListener('error', terminar); }catch(e){}
        return orig(u);
      };
      var cancel = speechSynthesis.cancel.bind(speechSynthesis);
      speechSynthesis.cancel = function(){ var r = cancel(); terminar(); return r; };
      speechSynthesis.__flashy = 1;
    }
  }catch(e){}
  // quieta hasta que hable
  document.addEventListener('DOMContentLoaded', function(){ setTimeout(quieta, 300); });
  setTimeout(quieta, 1200);
})();
