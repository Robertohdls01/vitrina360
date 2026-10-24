"use client";

export default function EnPage() {
  const HOTMART_START = "https://pay.hotmart.com/REEMPLAZA_START";
  const HOTMART_PLUS = "https://pay.hotmart.com/REEMPLAZA_PLUS";
  const HOTMART_PRO = "https://pay.hotmart.com/REEMPLAZA_PRO";

  return (
    <main className="min-h-screen bg-white text-black">
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;600;700&display=swap'); *{font-family:'Instrument Sans', sans-serif}`}</style>
      
      {/* Top bar */}
      <div className="border-b border-zinc-200">
        <div className="mx-auto max-w-6xl px-6 h-16 flex items-center justify-between">
          <span className="font-bold text-lg">Vitrina 360</span>
          <div className="flex gap-2 text-sm">
            <a href="/" className="px-3 py-1.5 rounded-full border">🇦🇷 AR</a>
            <span className="px-3 py-1.5 rounded-full bg-black text-white">🌎 EN</span>
          </div>
        </div>
      </div>

      {/* Hero */}
      <div className="mx-auto max-w-6xl px-6 py-16 text-center">
        <h1 className="text-5xl font-bold tracking-tight">Take a photo.<br/>Your store builds itself.</h1>
        <p className="mt-4 text-zinc-600 max-w-2xl mx-auto">Snap your products or a full catalog page. Vitrina 360 AI recognizes them, writes names & features, and places them in 360° rotating showcases. Customers order via WhatsApp.</p>
        <div className="mt-6 flex justify-center gap-3">
          <span className="text-xs px-3 py-1 bg-violet-100 text-violet-700 rounded-full">✓ No Shopify</span>
          <span className="text-xs px-3 py-1 bg-violet-100 text-violet-700 rounded-full">✓ No coder</span>
          <span className="text-xs px-3 py-1 bg-violet-100 text-violet-700 rounded-full">✓ 360° viewer</span>
        </div>
      </div>

      {/* Plans - INTERNATIONAL ONLY */}
      <div className="mx-auto max-w-6xl px-6 pb-20">
        <h2 className="text-center text-2xl font-bold mb-2">Start free, choose later</h2>
        <p className="text-center text-sm text-zinc-500 mb-8">7 days free, no card. Cancel anytime. Hotmart secure checkout.</p>
        
        <div className="grid md:grid-cols-3 gap-6">
          {/* START */}
          <div className="border border-zinc-200 rounded-2xl p-6">
            <h3 className="font-bold">Start</h3>
            <p className="text-sm text-zinc-500">For starters</p>
            <div className="mt-4 text-3xl font-bold">$29<span className="text-base font-normal text-zinc-500">/mo</span></div>
            <ul className="mt-4 text-sm space-y-2 text-zinc-700">
              <li>• 1 store with 10 vitrines</li>
              <li>• Up to 300 products (30 per vitrine)</li>
              <li>• 10 videos</li>
              <li>• WhatsApp orders</li>
            </ul>
            <a href={HOTMART_START} target="_blank" className="mt-6 block text-center bg-black text-white rounded-full py-3 text-sm font-semibold">Start with Hotmart</a>
          </div>

          {/* PLUS - Most chosen */}
          <div className="border-2 border-violet-600 rounded-2xl p-6 relative">
            <span className="absolute -top-3 left-6 bg-violet-600 text-white text-xs px-3 py-1 rounded-full">Most chosen</span>
            <h3 className="font-bold">Plus</h3>
            <p className="text-sm text-zinc-500">For stores</p>
            <div className="mt-4 text-3xl font-bold">$49<span className="text-base font-normal text-zinc-500">/mo</span></div>
            <ul className="mt-4 text-sm space-y-2 text-zinc-700">
              <li>• 1 store with 20 vitrines</li>
              <li>• Up to 600 products, 8 photos each</li>
              <li>• 30 videos</li>
              <li>• Everything in Start</li>
            </ul>
            <a href={HOTMART_PLUS} target="_blank" className="mt-6 block text-center bg-violet-600 text-white rounded-full py-3 text-sm font-semibold">Start with Hotmart</a>
          </div>

          {/* PRO */}
          <div className="border border-zinc-200 rounded-2xl p-6">
            <h3 className="font-bold">Pro</h3>
            <p className="text-sm text-zinc-500">Multiple businesses</p>
            <div className="mt-4 text-3xl font-bold">$79<span className="text-base font-normal text-zinc-500">/mo</span></div>
            <ul className="mt-4 text-sm space-y-2 text-zinc-700">
              <li>• Up to 4 stores, 20 vitrines each</li>
              <li>• Up to 2,400 products</li>
              <li>• 60 videos</li>
              <li>• Everything in Plus</li>
            </ul>
            <a href={HOTMART_PRO} target="_blank" className="mt-6 block text-center bg-black text-white rounded-full py-3 text-sm font-semibold">Start with Hotmart</a>
          </div>
        </div>

        {/* Inside badge demo */}
        <div className="mt-16 border border-zinc-200 rounded-2xl p-6 bg-zinc-50">
          <h4 className="font-bold">How it appears inside the store (only badge + vitrine added):</h4>
          <p className="text-sm text-zinc-600 mt-1">✓ Your current behavior stays same: customer only sees vitrines with products, empty ones hidden and rotating. Only badge changes.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="px-3 py-1 bg-white border rounded-full text-xs">✓ Plan Start · active until 25/11/2026</span>
            <span className="px-3 py-1 bg-white border rounded-full text-xs">✓ Plan Plus · 20 vitrines</span>
            <span className="px-3 py-1 bg-white border rounded-full text-xs">✓ Plan Pro · 4 stores</span>
          </div>
          <p className="text-xs text-zinc-500 mt-3">When Hotmart webhook sets plan = START/PLUS/PRO, only this badge updates and vitrine count increases. Page stays same, no weird changes.</p>
        </div>

        <p className="text-center text-xs text-zinc-400 mt-8">Argentina version untouched at / - Mercado Pago $9.900 / $14.900 / $19.900 - Already works automatically.</p>
      </div>
    </main>
  );
}
