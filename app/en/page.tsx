export default function EnPage() {
  const links = {
    start: "https://pay.hotmart.com/I108173020N",
    plus: "https://pay.hotmart.com/F108173050I",
    pro: "https://pay.hotmart.com/T108173095W"
  };
  return (
    <main style={fontFamily:'system-ui', background:'#fff', color:'#111827'}>
      <section style={background:'linear-gradient(135deg,#6d28d9,#8b5cf6)', color:'white', padding:'80px 20px', textAlign:'center'}>
        <h1 style={fontSize:'48px', margin:'0 0 16px'}>Take a photo. Your store builds itself.</h1>
        <p style={fontSize:'20px', opacity:0.95, margin:'0 0 32px'}>Turn phone photos into a professional store in minutes. AI recognizes products, creates descriptions, videos and WhatsApp checkout.</p>
        <a href={links.start} style={display:'inline-block', padding:'14px 28px', borderRadius:'12px', fontWeight:700, textDecoration:'none', background:'white', color:'#6d28d9'}>Start with Hotmart - $29/mo</a>
      </section>
      <section style={display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))', gap:'24px', maxWidth:'1100px', margin:'60px auto', padding:'0 20px'}>
        <div style={border:'1px solid #e5e7eb', borderRadius:'16px', padding:'24px', background:'white'}>
          <h3>Vitrina 360 Start</h3>
          <div style={fontSize:'36px', fontWeight:800, color:'#6d28d9'}>$29/mo</div>
          <ul>
            <li>1 store with 10 showcases</li>
            <li>Up to 300 products</li>
            <li>10 AI videos</li>
            <li>WhatsApp orders</li>
            <li>AI recognition</li>
          </ul>
          <a href={links.start} style={display:'inline-block', marginTop:'16px', padding:'12px 20px', borderRadius:'10px', background:'#ff6b00', color:'white', textDecoration:'none', fontWeight:700}>Start with Hotmart - $29</a>
        </div>
        <div style={border:'2px solid #6d28d9', borderRadius:'16px', padding:'24px', background:'white'}>
          <h3>Vitrina 360 Plus</h3>
          <div style={fontSize:'36px', fontWeight:800, color:'#6d28d9'}>$49/mo</div>
          <ul>
            <li>1 store with 20 showcases</li>
            <li>Up to 600 products</li>
            <li>30 videos</li>
            <li>WhatsApp orders</li>
            <li>Everything in Start</li>
          </ul>
          <a href={links.plus} style={display:'inline-block', marginTop:'16px', padding:'12px 20px', borderRadius:'10px', background:'#ff6b00', color:'white', textDecoration:'none', fontWeight:700}>Start with Hotmart - $49</a>
        </div>
        <div style={border:'1px solid #e5e7eb', borderRadius:'16px', padding:'24px', background:'white'}>
          <h3>Vitrina 360 Pro</h3>
          <div style={fontSize:'36px', fontWeight:800, color:'#6d28d9'}>$79/mo</div>
          <ul>
            <li>Up to 4 stores, 20 showcases each</li>
            <li>Up to 2400 products</li>
            <li>60 videos</li>
            <li>Everything in Plus</li>
            <li>For multiple businesses</li>
          </ul>
          <a href={links.pro} style={display:'inline-block', marginTop:'16px', padding:'12px 20px', borderRadius:'10px', background:'#ff6b00', color:'white', textDecoration:'none', fontWeight:700}>Start with Hotmart - $79</a>
        </div>
      </section>
      <div style={textAlign:'center', padding:'40px', color:'#6b7280'}>
        <p>Secure payment via Hotmart • Cancel anytime • https://vitrina360-kappa.vercel.app/en</p>
        <p><a href="/">Ver en Español - $9.900 / $14.900 / $19.900</a></p>
      </div>
    </main>
  );
}
