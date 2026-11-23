/* ⚡ Flashy ayudante para armar el café en ShopMenu · Pro Video JSRHG
   Cuando el dueño toca un casillero, Flashy le explica para qué sirve (con voz si quiere). */
(function(){
  const AY = {
    fDueno: 'Tu nombre. En la caja te saludo por tu nombre y te aviso de los pedidos.',
    fLogo: 'El logo de tu café. Sale arriba del menú, en los carteles y en el ícono que tus clientes guardan en el celular.',
    fNombre: 'El nombre de tu local, como lo conoce la gente. Sale en el menú, en los QR y en la postal de recuerdo.',
    fMesas: 'Cuántas mesas tenés. Con eso armo los QR: mesa 1, mesa 2… Para la prueba con el kit, poné 2.',
    fLugar: 'Cómo se llaman tus lugares: mesas en un café, habitaciones en un hotel, máquinas en un casino o carpas en un balneario.',
    fAsis: 'El nombre del asistente que atiende las mesas. Puede ser Flashy o el nombre que quieras, por ejemplo Lola.',
    fSaludo: 'Una frase que digo al saludar a cada mesa. Ideal para la promo del día o si hay música en vivo.',
    fIdioma: 'El idioma en que escribís tu carta. Yo la traduzco sola a 8 idiomas para los turistas.',
    fDem: 'Más o menos cuántos minutos tarda un pedido. Se lo digo al cliente cuando pide, así sabe cuánto espera.',
    fMozos: 'Los nombres de tus mozos, separados por coma. El cliente puede llamar al mozo y en la caja ves a quién le toca.',
    fEnvio: 'Tildalo si llevan pedidos cerca, por ejemplo a oficinas o bancos. Así tus clientes fijos te piden desde el trabajo.',
    fEnvioTx: 'Aclará cómo es el envío, por ejemplo: solo a 5 cuadras, sin cargo.',
    fMoneda: 'La moneda de tus precios.',
    fAlias: 'Tu alias de Mercado Pago o del banco. El cliente transfiere, adjunta la captura del comprobante y vos, en la caja, tocás "Me llegó" cuando ves la plata en tu cuenta.',
    fPay: 'Un link de pago que ya tengas armado en tu app de Mercado Pago. Ojo: con este link el cliente escribe el monto él y la caja no se entera sola, tenés que controlar el comprobante. Si más abajo conectás tu Mercado Pago, este casillero lo podés dejar vacío.',
    fBills: 'Otras billeteras: Ualá, MODO, Naranja X, Cuenta DNI, tu banco, y para turistas PayPal o Zelle. El cliente elige con cuál pagarte.',
    fBillAdd: 'Tocá acá para sumar otra billetera con su alias o link.',
    fGrev: 'El link para que te dejen reseñas en Google. Cómo sacarlo: buscá tu café en Google con tu cuenta, tocá "Pedir reseñas" y después "Copiar". Pegalo acá. Con eso te ofrezco la reseña de Google a cada cliente y sale en tu cartel de reseñas.',
    fOpiPub: 'Si lo dejás tildado, las opiniones buenas de tus clientes se ven en tu menú. Eso da confianza a los que llegan por primera vez.',
    fWa: 'Tu WhatsApp. Tus clientes te escriben con un toque y yo te aviso por ahí si algo necesita tu atención.',
    fLinks: 'Tus redes: Instagram, Facebook, TikTok, tu ubicación en Maps. Se las muestro a los clientes para que te sigan.',
    fNov: 'Novedades o eventos: música en vivo, un plato nuevo, horario especial. Se los cuento a los clientes cuando entran.',
    fFondo: 'Una foto linda de tu local. Va de fondo en el menú y también la podés usar en la postal de recuerdo.',
    fFondoCaja: 'Si lo tildás, tu foto también sale de fondo en la caja.',
    fDeco: 'Adornos según la fecha: Navidad, verano, Día de la Madre… Le dan vida al menú.',
    fMusica: 'Música suave mientras el cliente mira la carta. Si no la querés, dejala apagada.',
    fAva: 'Cómo se ve la moza o el mozo virtual que atiende las mesas.',
    fPelo: 'El pelo de tu asistente virtual.', fLargo: 'El largo de pelo de tu asistente virtual.', fPiel: 'El tono de piel de tu asistente virtual.', fBarba: 'Si tu asistente virtual tiene barba.',
    fCajaAva: 'Cómo me ves a mí en la caja.',
    bLeer: 'Subí fotos de tu carta de papel y tocá acá: la leo entera y cargo todos los platos con sus precios. Después revisás y corregís lo que haga falta.',
    bSave: 'Cuando termines, tocá Guardar. Sin guardar, los cambios no se ven en las mesas.'
  };
  const MP = 'Esta es la mejor forma de cobrar: tocá "Conectar mi Mercado Pago", entrás con la cuenta del café y tocás Autorizar. Desde ahí, cada mesa paga el monto exacto con tarjeta o con su Mercado Pago, la plata va directo a tu cuenta y a la caja le llega el aviso de pago confirmado, sin comprobantes. Así no necesitás el link de pago de arriba. Si es la primera vez y te pide guardar, tocá Guardar abajo de todo y después volvé a este cuadro para conectarlo.';
  const BIENV = '¡Hola! Soy Flashy ⚡ Te ayudo a armar tu café. Tocá cualquier casillero y te explico para qué sirve.';
  const FACE = '<svg viewBox="0 0 100 100" width="44" height="44" aria-hidden="true"><path d="M52 2 38 26h12l-6 16 18-24H50l8-16z" fill="#f020c0" stroke="#c8008f" stroke-width="2" stroke-linejoin="round"/><circle cx="50" cy="60" r="34" fill="#facc15" stroke="#ca8a04" stroke-width="2.5"/><ellipse cx="38" cy="56" rx="6" ry="8" fill="#1f2937"/><ellipse cx="62" cy="56" rx="6" ry="8" fill="#1f2937"/><circle cx="40" cy="53" r="2.4" fill="#fff"/><circle cx="64" cy="53" r="2.4" fill="#fff"/><path d="M39 71q11 12 22 0z" fill="#7f1d1d"/></svg>';
  let box, txt, voz = true, ultimo = '', mpDicho = false;
  try{ voz = localStorage.getItem('smAyVoz') !== '0'; }catch(e){}
  const hablar = t => { if(!voz || !window.speechSynthesis) return; try{ speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(t.replace(/[⚡📲]/g, '')); u.lang = 'es-AR'; const v = speechSynthesis.getVoices().find(v => /^es/i.test(v.lang)); if(v) u.voice = v; speechSynthesis.speak(u); }catch(e){} };
  function decir(t){ if(!box || t === ultimo) return; ultimo = t; txt.textContent = t; box.hidden = false; box.classList.remove('ayMin'); hablar(t); }
  function armar(){
    if(box) return;
    const st = document.createElement('style'); st.textContent = `#ayF{position:fixed;left:10px;bottom:10px;}#ayF{z-index:80;max-width:min(420px,calc(100vw - 20px));background:#fff;border:2px solid #ffb5e6;border-radius:18px;box-shadow:0 10px 30px rgba(200,0,143,.22);padding:10px 12px;display:grid;grid-template-columns:44px 1fr;gap:10px;align-items:start;font-size:15px;line-height:1.4;color:#2a1226}
      #ayF .ayB{display:flex;gap:6px;grid-column:1/-1;justify-content:flex-end}#ayF .ayB button{border:0;background:#ffe1ef;border-radius:999px;padding:6px 10px;font:600 13px system-ui,sans-serif;cursor:pointer;color:#8a005c}
      #ayF.ayMin{grid-template-columns:44px;padding:6px;border-radius:50%;cursor:pointer}#ayF.ayMin .ayT,#ayF.ayMin .ayB{display:none}@media(min-width:1250px){#ayF{left:auto;right:12px;bottom:16px;max-width:calc((100vw - 760px) / 2 - 16px)}}`;
    document.head.appendChild(st);
    box = document.createElement('div'); box.id = 'ayF'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite');
    box.innerHTML = FACE + '<div class="ayT"></div><div class="ayB"><button type="button" data-v>' + (voz ? '🔊 Voz' : '🔇 Sin voz') + '</button><button type="button" data-m>Achicar</button></div>';
    document.body.appendChild(box); txt = box.querySelector('.ayT');
    box.querySelector('[data-v]').onclick = e => { e.stopPropagation(); voz = !voz; try{ localStorage.setItem('smAyVoz', voz ? '1' : '0'); speechSynthesis.cancel(); }catch(err){} e.target.textContent = voz ? '🔊 Voz' : '🔇 Sin voz'; };
    box.querySelector('[data-m]').onclick = e => { e.stopPropagation(); box.classList.add('ayMin'); try{ speechSynthesis.cancel(); }catch(err){} };
    box.addEventListener('click', () => { if(box.classList.contains('ayMin')) box.classList.remove('ayMin'); });
    decir(BIENV);
    document.addEventListener('focusin', e => { const el = e.target.closest('[id]'); if(el && AY[el.id] && document.getElementById('paso1')) decir(AY[el.id]); });
    document.addEventListener('click', e => { const b = e.target.closest('#bLeer,#bSave,#fBillAdd'); if(b && AY[b.id] && b.id !== 'bSave') decir(AY[b.id]); }, true);
    const mp = document.getElementById('mpBox');
    if(mp && 'IntersectionObserver' in window){ new IntersectionObserver(es => { es.forEach(x => { if(x.isIntersecting && !mpDicho){ mpDicho = true; decir(MP); } }); }, {threshold: .6}).observe(mp); }
  }
  // aparece solo cuando se abre la pantalla de armar el café
  const mira = () => { if(document.getElementById('paso1')) armar(); else if(box){ box.remove(); box = null; ultimo = ''; mpDicho = false; } };
  new MutationObserver(mira).observe(document.documentElement, {childList: true, subtree: true});
  document.addEventListener('DOMContentLoaded', mira); mira();
})();
