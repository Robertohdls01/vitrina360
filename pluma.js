// Pluma: trazo suave para firmar con el dedo, el mouse o un lápiz táctil.
// Suaviza el pulso (filtro), dibuja curvas en vez de rayitas, y el grosor varía como una lapicera:
// más fino si vas rápido, más grueso si vas lento (o según la presión del lápiz).
(function () {
  window.Pluma = function (cv, ctx, opt) {
    opt = opt || {};
    const base = opt.ancho || 2.8;
    let on = false, pts = [], w = base, prev = null, mid = null, hist = [];
    const pos = e => { const b = cv.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top, t: e.timeStamp || performance.now(), p: e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : null }; };
    const suave = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, t: b.t, p: b.p });
    function punto(q) {
      // filtro de pulso: el mouse y el dedo tiemblan; promediamos con el punto anterior
      const k = opt.mouse ? 0.45 : 0.6;
      const s = prev ? suave(prev, q, k) : q;
      if (prev) {
        const d = Math.hypot(s.x - prev.x, s.y - prev.y), dt = Math.max(1, s.t - prev.t), v = d / dt;
        let obj = s.p != null ? base * (0.45 + s.p * 1.3) : base * Math.max(0.55, Math.min(1.45, 1.5 - v * 0.55));
        w = w * 0.75 + obj * 0.25;
        const m = { x: (prev.x + s.x) / 2, y: (prev.y + s.y) / 2 };
        ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath(); ctx.moveTo(mid.x, mid.y); ctx.quadraticCurveTo(prev.x, prev.y, m.x, m.y); ctx.stroke();
        mid = m;
      }
      prev = s;
    }
    return {
      down(e) {
        try { hist.push(ctx.getImageData(0, 0, cv.width, cv.height)); if (hist.length > 15) hist.shift(); } catch (x) {}
        on = true; const q = pos(e); prev = null; w = base; mid = { x: q.x, y: q.y }; punto(q);
        ctx.beginPath(); ctx.arc(q.x, q.y, base * 0.45, 0, 7); ctx.fillStyle = ctx.strokeStyle; ctx.fill();
        try { cv.setPointerCapture(e.pointerId); } catch (x) {} e.preventDefault();
      },
      move(e) {
        if (!on) return; e.preventDefault();
        const L = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
        (L.length ? L : [e]).forEach(ev => punto(pos(ev)));
      },
      up() { if (on && prev && mid) { ctx.beginPath(); ctx.moveTo(mid.x, mid.y); ctx.lineTo(prev.x, prev.y); ctx.stroke(); } on = false; prev = null; },
      deshacer() { const im = hist.pop(); if (!im) return false; ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.putImageData(im, 0, 0); ctx.restore(); return hist.length > 0; },
      limpiarHist() { hist = []; }
    };
  };
})();
