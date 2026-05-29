'use client'
import { useState, useEffect, useRef } from 'react'

export default function AdminPage() {
  const [screen, setScreen] = useState('login') // login | tfa-setup | tfa-verify | admin
  const [loginData, setLoginData] = useState({ email: '', password: '' })
  const [loginError, setLoginError] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)
  const [pending, setPending] = useState({ email: '', token: '' })
  const [tfaSetup, setTfaSetup] = useState({ qrDataUrl: '', secret: '' })
  const [setupCode, setSetupCode] = useState(['','','','','',''])
  const [setupError, setSetupError] = useState('')
  const [setupLoading, setSetupLoading] = useState(false)
  const [verifyCode, setVerifyCode] = useState(['','','','','',''])
  const [verifyError, setVerifyError] = useState('')
  const [verifyLoading, setVerifyLoading] = useState(false)
  const [countdown, setCountdown] = useState(30)
  const [adminEmail, setAdminEmail] = useState('')
  const [data, setData] = useState({ operators:[], subscribers:[], bookings:[], washPoints:[] })
  const [dataLoading, setDataLoading] = useState(false)
  const [toast, setToast] = useState({ msg:'', show:false, error:false })
  const [createModal, setCreateModal] = useState(false)
  const [addPointModal, setAddPointModal] = useState(false)
  const [newOp, setNewOp] = useState({ name:'', email:'', password:'', wash_point:'' })
  const [createError, setCreateError] = useState('')
  const [createLoading, setCreateLoading] = useState(false)
  const [newPoint, setNewPoint] = useState({ name:'', area:'', lat:'', lng:'', description:'' })
  const [pointFile, setPointFile] = useState(null)
  const [pointPreview, setPointPreview] = useState('')
  const [addPointError, setAddPointError] = useState('')
  const [addPointLoading, setAddPointLoading] = useState(false)
  const countdownRef = useRef(null)
  const setupRefs = useRef([])
  const verifyRefs = useRef([])

  function showToast(msg, isError=false) {
    setToast({ msg, show:true, error:isError })
    setTimeout(() => setToast(t => ({...t, show:false})), 3500)
  }

  // ── LOGIN ──────────────────────────────────────────────────────────
  async function handleLogin(e) {
    e?.preventDefault()
    setLoginError('')
    if (!loginData.email || !loginData.password) { setLoginError('Please enter your email and password.'); return }
    setLoginLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ email: loginData.email, password: loginData.password })
      })
      const json = await res.json()
      if (!res.ok) { setLoginError(json.error || 'Login failed.'); return }
      setPending({ email: json.email, token: json.pendingToken })
      if (json.hasTfa) {
        setScreen('tfa-verify')
        startCountdown()
        setTimeout(() => verifyRefs.current[0]?.focus(), 100)
      } else {
        // First time — generate 2FA setup
        const setupRes = await fetch('/api/tfa/setup', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ action:'generate', email:json.email, pendingToken:json.pendingToken })
        })
        const setupJson = await setupRes.json()
        if (!setupRes.ok) { setLoginError(setupJson.error || 'Failed to generate 2FA.'); return }
        setTfaSetup({ qrDataUrl: setupJson.qrDataUrl, secret: setupJson.secret })
        setSetupCode(['','','','','',''])
        setScreen('tfa-setup')
        setTimeout(() => setupRefs.current[0]?.focus(), 100)
      }
    } catch(e) { setLoginError('Network error. Please try again.') }
    finally { setLoginLoading(false) }
  }

  // ── 2FA SETUP CONFIRM ──────────────────────────────────────────────
  async function handleSetupConfirm() {
    const code = setupCode.join('')
    if (code.length < 6) { setSetupError('Enter the full 6-digit code.'); return }
    setSetupLoading(true); setSetupError('')
    try {
      const res = await fetch('/api/tfa/setup', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ action:'confirm', email:pending.email, pendingToken:pending.token, code, secret:tfaSetup.secret })
      })
      const json = await res.json()
      if (!res.ok) { setSetupError(json.error || 'Verification failed.'); return }
      setAdminEmail(pending.email)
      setScreen('admin')
      loadData()
      showToast('2FA enabled & logged in securely ✓')
    } catch(e) { setSetupError('Network error.') }
    finally { setSetupLoading(false) }
  }

  // ── 2FA VERIFY ─────────────────────────────────────────────────────
  async function handleVerify() {
    const code = verifyCode.join('')
    if (code.length < 6) { setVerifyError('Enter the full 6-digit code.'); return }
    setVerifyLoading(true); setVerifyError('')
    try {
      const res = await fetch('/api/tfa/verify', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ email:pending.email, pendingToken:pending.token, code })
      })
      const json = await res.json()
      if (!res.ok) {
        setVerifyError(json.error || 'Incorrect code.')
        setVerifyCode(['','','','','',''])
        setTimeout(() => verifyRefs.current[0]?.focus(), 50)
        return
      }
      clearInterval(countdownRef.current)
      setAdminEmail(pending.email)
      setScreen('admin')
      loadData()
      showToast('Logged in securely ✓')
    } catch(e) { setVerifyError('Network error.') }
    finally { setVerifyLoading(false) }
  }

  function startCountdown() {
    clearInterval(countdownRef.current)
    const tick = () => setCountdown(30 - (Math.floor(Date.now()/1000) % 30))
    tick()
    countdownRef.current = setInterval(tick, 1000)
  }

  function cancelTfa() {
    clearInterval(countdownRef.current)
    setPending({ email:'', token:'' })
    setScreen('login')
  }

  // ── OTP INPUT HELPERS ──────────────────────────────────────────────
  function handleOtpInput(index, value, codeArr, setCode, refs, onComplete) {
    const digit = value.replace(/\D/g,'').slice(-1)
    const newCode = [...codeArr]
    newCode[index] = digit
    setCode(newCode)
    if (digit && index < 5) refs.current[index+1]?.focus()
    if (newCode.every(d=>d) && onComplete) setTimeout(onComplete, 50)
  }

  function handleOtpKeyDown(e, index, refs, codeArr, setCode) {
    if (e.key === 'Backspace' && !codeArr[index] && index > 0) {
      refs.current[index-1]?.focus()
    }
  }

  function handleOtpPaste(e, setCode, refs, onComplete) {
    const text = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g,'').slice(0,6)
    if (text.length === 6) {
      setCode(text.split(''))
      refs.current[5]?.focus()
      e.preventDefault()
      if (onComplete) setTimeout(onComplete, 50)
    }
  }

  // ── LOGOUT ─────────────────────────────────────────────────────────
  async function handleLogout() {
    await fetch('/api/auth/logout', { method:'POST' })
    clearInterval(countdownRef.current)
    setScreen('login')
    setLoginData({ email:'', password:'' })
    setAdminEmail('')
    setData({ operators:[], subscribers:[], bookings:[], washPoints:[] })
  }

  // ── DATA ──────────────────────────────────────────────────────────
  async function loadData() {
    setDataLoading(true)
    try {
      const res = await fetch('/api/data')
      if (res.status === 401) { handleLogout(); return }
      const json = await res.json()
      setData(json)
    } catch(e) { showToast('Error loading data', true) }
    finally { setDataLoading(false) }
  }

  // ── CREATE OPERATOR ───────────────────────────────────────────────
  async function handleCreateOperator() {
    setCreateError('')
    if (!newOp.name || !newOp.email || !newOp.password || !newOp.wash_point) {
      setCreateError('Please fill in all fields.'); return
    }
    setCreateLoading(true)
    try {
      const res = await fetch('/api/operators', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify(newOp)
      })
      const json = await res.json()
      if (!res.ok) { setCreateError(json.error || 'Failed to create operator.'); return }
      showToast('Operator created successfully!')
      setCreateModal(false)
      setNewOp({ name:'', email:'', password:'', wash_point:'' })
      loadData()
    } catch(e) { setCreateError('Network error.') }
    finally { setCreateLoading(false) }
  }

  // ── DELETE OPERATOR ───────────────────────────────────────────────
  async function handleDeleteOperator(id) {
    if (!confirm('Remove this operator? They will lose access immediately.')) return
    try {
      const res = await fetch('/api/operators', {
        method:'DELETE', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ id })
      })
      if (!res.ok) { showToast('Error removing operator', true); return }
      showToast('Operator removed.')
      loadData()
    } catch(e) { showToast('Network error', true) }
  }

  // ── CREATE WASH POINT ─────────────────────────────────────────────
  async function handleCreateWashPoint() {
    setAddPointError('')
    if (!newPoint.name || !newPoint.area || !newPoint.lat || !newPoint.lng) {
      setAddPointError('Name, area, lat and lng are required.'); return
    }
    setAddPointLoading(true)
    try {
      let image_url = null
      if (pointFile) {
        // Upload image using anon key (storage is public)
        const ext = pointFile.name.split('.').pop()
        const fileName = 'point-' + Date.now() + '.' + ext
        const uploadRes = await fetch(
          process.env.NEXT_PUBLIC_SUPABASE_URL + '/storage/v1/object/wash-point-images/' + fileName,
          {
            method:'POST',
            headers: {
              'apikey': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
              'Authorization': 'Bearer ' + process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
              'Content-Type': pointFile.type,
              'x-upsert': 'true'
            },
            body: pointFile
          }
        )
        if (uploadRes.ok) {
          image_url = process.env.NEXT_PUBLIC_SUPABASE_URL + '/storage/v1/object/public/wash-point-images/' + fileName
        }
      }
      const res = await fetch('/api/wash-points', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ ...newPoint, image_url })
      })
      const json = await res.json()
      if (!res.ok) { setAddPointError(json.error || 'Failed to add wash point.'); return }
      showToast('Wash point added!')
      setAddPointModal(false)
      setNewPoint({ name:'', area:'', lat:'', lng:'', description:'' })
      setPointFile(null); setPointPreview('')
      loadData()
    } catch(e) { setAddPointError('Network error.') }
    finally { setAddPointLoading(false) }
  }

  // ── DELETE WASH POINT ─────────────────────────────────────────────
  async function handleDeleteWashPoint(id) {
    if (!confirm('Remove this wash point? This will not affect existing bookings.')) return
    try {
      const res = await fetch('/api/wash-points', {
        method:'DELETE', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ id })
      })
      if (!res.ok) { showToast('Error removing wash point', true); return }
      showToast('Wash point removed.')
      loadData()
    } catch(e) { showToast('Network error', true) }
  }

  const rev = data.subscribers.reduce((s,u) => s + (u.plan_price ? parseInt(u.plan_price)*4 : 0), 0)

  // ── RENDER ────────────────────────────────────────────────────────
  return (
    <>

      {/* LOGIN */}
      {screen === 'login' && (
        <div className="center-screen">
          <div className="login-card">
            <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
              <div className="login-icon">S</div>
              <div style={{fontFamily:'Syne,sans-serif',fontSize:18,fontWeight:800}}>SplashPass</div>
            </div>
            <div className="login-tag">Admin Panel</div>
            <div className="form-group">
              <label>Email</label>
              <input type="email" placeholder="you@example.com" value={loginData.email}
                onChange={e=>setLoginData({...loginData,email:e.target.value})}
                onKeyDown={e=>e.key==='Enter'&&handleLogin()} />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input type="password" placeholder="Your password" value={loginData.password}
                onChange={e=>setLoginData({...loginData,password:e.target.value})}
                onKeyDown={e=>e.key==='Enter'&&handleLogin()} />
            </div>
            {loginError && <div className="form-error">{loginError}</div>}
            <button className="btn btn-gold btn-full" disabled={loginLoading} onClick={handleLogin} style={{marginTop:8}}>
              {loginLoading ? 'Please wait...' : 'Access Admin Panel'}
            </button>
          </div>
        </div>
      )}

      {/* 2FA SETUP */}
      {screen === 'tfa-setup' && (
        <div className="center-screen">
          <div className="tfa-card">
            <div style={{fontSize:36,marginBottom:12}}>🔐</div>
            <h2>Set Up Two-Factor Auth</h2>
            <p className="tfa-subtitle">Scan this QR code with Google Authenticator or Authy, then enter the 6-digit code to confirm setup.</p>
            {tfaSetup.qrDataUrl && (
              <div className="qr-wrap"><img src={tfaSetup.qrDataUrl} alt="QR Code" /></div>
            )}
            <div style={{fontSize:12,color:'var(--grey)',marginBottom:8,textAlign:'center'}}>Or enter this key manually:</div>
            <div className="secret-box">{tfaSetup.secret.match(/.{1,4}/g)?.join(' ')}</div>
            <div className="otp-input-row">
              {setupCode.map((d,i) => (
                <input key={i} className="otp-digit" maxLength={1} type="text" inputMode="numeric" value={d}
                  ref={el=>setupRefs.current[i]=el}
                  onChange={e=>handleOtpInput(i,e.target.value,setupCode,setSetupCode,setupRefs,handleSetupConfirm)}
                  onKeyDown={e=>handleOtpKeyDown(e,i,setupRefs,setupCode,setSetupCode)}
                  onPaste={e=>handleOtpPaste(e,setSetupCode,setupRefs,handleSetupConfirm)} />
              ))}
            </div>
            {setupError && <div className="form-error" style={{textAlign:'center',marginBottom:12}}>{setupError}</div>}
            <button className="btn btn-gold btn-full" disabled={setupLoading} onClick={handleSetupConfirm}>
              {setupLoading ? 'Please wait...' : 'Confirm & Enable 2FA'}
            </button>
            <div style={{marginTop:12,textAlign:'center'}}>
              <button className="btn btn-outline" onClick={cancelTfa} style={{padding:'8px 20px',fontSize:13}}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* 2FA VERIFY */}
      {screen === 'tfa-verify' && (
        <div className="center-screen">
          <div className="tfa-card">
            <div style={{fontSize:36,marginBottom:12}}>🔒</div>
            <h2>Two-Factor Verification</h2>
            <p className="tfa-subtitle">Enter the 6-digit code from your authenticator app to continue.</p>
            <div className="otp-input-row">
              {verifyCode.map((d,i) => (
                <input key={i} className="otp-digit" maxLength={1} type="text" inputMode="numeric" value={d}
                  ref={el=>verifyRefs.current[i]=el}
                  onChange={e=>handleOtpInput(i,e.target.value,verifyCode,setVerifyCode,verifyRefs,handleVerify)}
                  onKeyDown={e=>handleOtpKeyDown(e,i,verifyRefs,verifyCode,setVerifyCode)}
                  onPaste={e=>handleOtpPaste(e,setVerifyCode,verifyRefs,handleVerify)} />
              ))}
            </div>
            <div className="tfa-timer">Code refreshes in <span>{countdown}</span>s</div>
            {verifyError && <div className="form-error" style={{textAlign:'center',marginBottom:12}}>{verifyError}</div>}
            <button className="btn btn-gold btn-full" disabled={verifyLoading} onClick={handleVerify}>
              {verifyLoading ? 'Please wait...' : 'Verify'}
            </button>
            <div style={{marginTop:12,textAlign:'center'}}>
              <button className="btn btn-outline" onClick={cancelTfa} style={{padding:'8px 20px',fontSize:13}}>Back to Login</button>
            </div>
          </div>
        </div>
      )}

      {/* ADMIN DASHBOARD */}
      {screen === 'admin' && (
        <div>
          <div className="admin-nav">
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <div className="admin-nav-icon">S</div>
              <div>
                <div style={{fontFamily:'Syne,sans-serif',fontSize:16,fontWeight:800}}>SplashPass</div>
                <div style={{fontSize:11,color:'var(--gold)',fontWeight:700}}>Admin Panel</div>
              </div>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <span style={{fontSize:12,color:'var(--grey)',marginRight:4}}>{adminEmail}</span>
              <button className="btn btn-outline" onClick={handleLogout} style={{padding:'8px 16px',fontSize:13}}>Log Out</button>
            </div>
          </div>

          <div className="admin-body">
            {/* STATS */}
            <div className="admin-stats">
              <div className="stat-card"><div className="stat-num">{data.operators.length}</div><div className="stat-label">Operators</div></div>
              <div className="stat-card"><div className="stat-num">{data.subscribers.length}</div><div className="stat-label">Subscribers</div></div>
              <div className="stat-card"><div className="stat-num">{data.bookings.length}</div><div className="stat-label">Total Bookings</div></div>
              <div className="stat-card"><div className="stat-num" style={{fontSize:20}}>KSh {rev.toLocaleString()}</div><div className="stat-label">Est. Revenue</div></div>
            </div>

            {/* WASH POINTS */}
            <div className="section">
              <div className="section-header">
                <div className="section-title">Wash Points</div>
                <button className="btn btn-gold" onClick={()=>setAddPointModal(true)}>+ Add Wash Point</button>
              </div>
              <div className="op-grid">
                {dataLoading ? <div style={{color:'var(--grey)',fontSize:14}}>Loading...</div> :
                  !data.washPoints.length ? <div style={{color:'var(--grey)',fontSize:14}}>No wash points yet.</div> :
                  data.washPoints.map(p => (
                    <div key={p.id} className="op-card">
                      {p.image_url && <img src={p.image_url} style={{width:'100%',height:110,objectFit:'cover',borderRadius:8,marginBottom:10,border:'1px solid rgba(255,255,255,.06)'}} alt="" />}
                      <div className="op-card-name">💧 {p.name}</div>
                      <div className="op-card-email">{p.area}</div>
                      <div className="op-card-point" style={{color:'var(--grey)'}}>📌 {parseFloat(p.lat).toFixed(4)}, {parseFloat(p.lng).toFixed(4)}</div>
                      {p.description && <div style={{fontSize:12,color:'var(--grey)',marginBottom:10,lineHeight:1.4}}>{p.description}</div>}
                      <div style={{display:'flex',gap:8,marginTop:4}}>
                        <button className="btn btn-danger" style={{padding:'6px 14px',fontSize:12,flex:1}} onClick={()=>handleDeleteWashPoint(p.id)}>Remove</button>
                      </div>
                    </div>
                  ))
                }
              </div>
            </div>

            {/* OPERATORS */}
            <div className="section">
              <div className="section-header">
                <div className="section-title">Wash Point Operators</div>
                <button className="btn btn-gold" onClick={()=>setCreateModal(true)}>+ Add Operator</button>
              </div>
              <div className="op-grid">
                {dataLoading ? <div style={{color:'var(--grey)',fontSize:14}}>Loading...</div> :
                  !data.operators.length ? <div style={{color:'var(--grey)',fontSize:14}}>No operators yet.</div> :
                  data.operators.map(op => (
                    <div key={op.id} className="op-card">
                      <div className="op-card-name">{op.full_name || op.name || '—'}</div>
                      <div className="op-card-email">{op.email}</div>
                      <div className="op-card-point">📍 {op.wash_point}</div>
                      <div style={{display:'flex',gap:8}}>
                        <button className="btn btn-danger" style={{padding:'6px 14px',fontSize:12,flex:1}} onClick={()=>handleDeleteOperator(op.id)}>Remove</button>
                      </div>
                    </div>
                  ))
                }
              </div>
            </div>

            {/* SUBSCRIBERS */}
            <div className="section">
              <div className="section-header">
                <div className="section-title">Subscribers</div>
                <button className="btn btn-outline" onClick={loadData}>↻ Refresh</button>
              </div>
              <div style={{overflowX:'auto'}}>
                <table className="sub-table">
                  <thead><tr><th>Name</th><th>Phone</th><th>Plan</th><th>Credits</th><th>Status</th><th>Plate</th></tr></thead>
                  <tbody>
                    {dataLoading ? (
                      <tr><td colSpan={6} style={{color:'var(--grey)',textAlign:'center',padding:20}}>Loading...</td></tr>
                    ) : !data.subscribers.length ? (
                      <tr><td colSpan={6} style={{color:'var(--grey)',textAlign:'center',padding:20}}>No subscribers yet</td></tr>
                    ) : data.subscribers.map(u => (
                      <tr key={u.id}>
                        <td>{u.name||'—'}</td>
                        <td>{u.phone||'—'}</td>
                        <td>{u.plan||'—'}</td>
                        <td style={{color:'var(--gold)',fontWeight:700}}>{u.plan==='Fleet'?'∞':(u.credits||0)}</td>
                        <td><span className={`status-badge ${u.sub_status==='active'?'badge-active':'badge-pending'}`}>{u.sub_status||'pending'}</span></td>
                        <td style={{fontWeight:700,letterSpacing:1}}>{u.plate||'—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CREATE OPERATOR MODAL */}
      <div className={`modal-overlay ${createModal?'show':''}`}>
        <div className="modal">
          <h3>Add New Operator</h3>
          <div className="form-group"><label>Full Name</label><input type="text" placeholder="John Kamau" value={newOp.name} onChange={e=>setNewOp({...newOp,name:e.target.value})} /></div>
          <div className="form-group"><label>Email</label><input type="email" placeholder="john@splashpass.co.ke" value={newOp.email} onChange={e=>setNewOp({...newOp,email:e.target.value})} /></div>
          <div className="form-group"><label>Password</label><input type="password" placeholder="Temporary password" value={newOp.password} onChange={e=>setNewOp({...newOp,password:e.target.value})} /></div>
          <div className="form-group">
            <label>Assign Wash Point</label>
            <select value={newOp.wash_point} onChange={e=>setNewOp({...newOp,wash_point:e.target.value})}>
              <option value="">Select wash point</option>
              {data.washPoints.map(p=><option key={p.id} value={p.name}>{p.name}</option>)}
            </select>
          </div>
          {createError && <div className="form-error">{createError}</div>}
          <div style={{display:'flex',gap:10,marginTop:8}}>
            <button className="btn btn-gold" disabled={createLoading} onClick={handleCreateOperator} style={{flex:1}}>{createLoading?'Please wait...':'Create Operator'}</button>
            <button className="btn btn-outline" onClick={()=>{setCreateModal(false);setCreateError('');setNewOp({name:'',email:'',password:'',wash_point:''})}} style={{flex:1}}>Cancel</button>
          </div>
        </div>
      </div>

      {/* ADD WASH POINT MODAL */}
      <div className={`modal-overlay ${addPointModal?'show':''}`}>
        <div className="modal" style={{maxHeight:'90vh',overflowY:'auto'}}>
          <h3>Add Wash Point</h3>
          <div className="form-group"><label>Name</label><input type="text" placeholder="SplashPass Nyali" value={newPoint.name} onChange={e=>setNewPoint({...newPoint,name:e.target.value})} /></div>
          <div className="form-group"><label>Area / Suburb</label><input type="text" placeholder="Nyali, Mombasa" value={newPoint.area} onChange={e=>setNewPoint({...newPoint,area:e.target.value})} /></div>
          <div className="form-group"><label>Latitude</label><input type="number" step="any" placeholder="-4.0435" value={newPoint.lat} onChange={e=>setNewPoint({...newPoint,lat:e.target.value})} /></div>
          <div className="form-group"><label>Longitude</label><input type="number" step="any" placeholder="39.7173" value={newPoint.lng} onChange={e=>setNewPoint({...newPoint,lng:e.target.value})} /></div>
          <div className="form-group"><label>Description</label><textarea placeholder="e.g. Located at the Nyali Centre parking lot." style={{resize:'vertical',minHeight:80}} value={newPoint.description} onChange={e=>setNewPoint({...newPoint,description:e.target.value})} /></div>
          <div className="form-group">
            <label>Photo</label>
            <input type="file" accept="image/*" style={{padding:'10px 12px',cursor:'pointer'}} onChange={e=>{
              const f=e.target.files[0]; if(!f) return
              setPointFile(f)
              const reader=new FileReader()
              reader.onload=ev=>setPointPreview(ev.target.result)
              reader.readAsDataURL(f)
            }} />
            {pointPreview && <img src={pointPreview} style={{width:'100%',height:160,objectFit:'cover',borderRadius:10,border:'1px solid var(--navy3)',marginTop:10}} alt="" />}
          </div>
          {addPointError && <div className="form-error">{addPointError}</div>}
          <div style={{display:'flex',gap:10,marginTop:8}}>
            <button className="btn btn-gold" disabled={addPointLoading} onClick={handleCreateWashPoint} style={{flex:1}}>{addPointLoading?'Please wait...':'Add Wash Point'}</button>
            <button className="btn btn-outline" onClick={()=>{setAddPointModal(false);setAddPointError('');setNewPoint({name:'',area:'',lat:'',lng:'',description:''});setPointFile(null);setPointPreview('')}} style={{flex:1}}>Cancel</button>
          </div>
        </div>
      </div>

      {/* TOAST */}
      <div id="toast" className={toast.show?'show':''} style={{borderLeftColor:toast.error?'var(--danger)':'var(--gold)'}}>{toast.msg}</div>
    </>
  )
}
