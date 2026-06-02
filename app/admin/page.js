'use client'
import { useState, useEffect, useRef } from 'react'
import Intelligence from './splashpass-admin-intelligence'
import AdminDashboard from './AdminDashboard'

export default function AdminPage() {
  const [screen, setScreen] = useState('login')
  const [adminTab, setAdminTab] = useState('dashboard')
  const [loginData, setLoginData] = useState({ email: '', password: '' })
  const [loginError, setLoginError] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)
  const [pending, setPending] = useState({ email: '', token: '' })
  const [verifyCode, setVerifyCode] = useState(['','','','','',''])
  const [verifyError, setVerifyError] = useState('')
  const [verifyLoading, setVerifyLoading] = useState(false)
  const [adminEmail, setAdminEmail] = useState('')
  const [data, setData] = useState({ operators:[], subscribers:[], bookings:[], washPoints:[] })
  const [dataLoading, setDataLoading] = useState(false)
  const [toast, setToast] = useState({ msg:'', show:false, error:false })
  const [createModal, setCreateModal] = useState(false)
  const [addPointModal, setAddPointModal] = useState(false)
  const [newOp, setNewOp] = useState({ name:'', email:'', password:'', wash_point:'', wash_point_id:'', commission_tier:'1' })
  const [createError, setCreateError] = useState('')
  const [createLoading, setCreateLoading] = useState(false)
  const [newPoint, setNewPoint] = useState({ name:'', area:'', lat:'', lng:'', description:'' })
  const [pointFile, setPointFile] = useState(null)
  const [pointPreview, setPointPreview] = useState('')
  const [addPointError, setAddPointError] = useState('')
  const [addPointLoading, setAddPointLoading] = useState(false)
  const countdownRef = useRef(null)
  const verifyRefs = useRef([])

  function showToast(msg, isError=false) {
    setToast({ msg, show:true, error:isError })
    setTimeout(() => setToast(t => ({...t, show:false})), 3500)
  }

  function closeCreateModal() {
    setCreateModal(false)
    setCreateError('')
    setNewOp({ name:'', email:'', password:'', wash_point:'', wash_point_id:'', commission_tier:'1' })
  }

  function closeAddPointModal() {
    setAddPointModal(false)
    setAddPointError('')
    setNewPoint({ name:'', area:'', lat:'', lng:'', description:'' })
    setPointFile(null)
    setPointPreview('')
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
      const sendRes = await fetch('/api/tfa/email-send', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ email: json.email, pendingToken: json.pendingToken })
      })
      const sendJson = await sendRes.json()
      if (!sendRes.ok) { setLoginError(sendJson.error || 'Failed to send code.'); return }
      setScreen('tfa-verify')
      setTimeout(() => verifyRefs.current[0]?.focus(), 100)
    } catch(e) { setLoginError('Network error. Please try again.') }
    finally { setLoginLoading(false) }
  }

  // ── 2FA VERIFY ─────────────────────────────────────────────────────
  async function handleVerify() {
    const code = verifyCode.join('')
    if (code.length < 6) { setVerifyError('Enter the full 6-digit code.'); return }
    setVerifyLoading(true); setVerifyError('')
    try {
      const res = await fetch('/api/tfa/email-verify', {
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

  function cancelTfa() {
    clearInterval(countdownRef.current)
    setPending({ email:'', token:'' })
    setVerifyCode(['','','','','',''])
    setVerifyError('')
    setScreen('login')
  }

  function handleOtpInput(index, value, codeArr, setCode, refs, onComplete) {
    const digit = value.replace(/\D/g,'').slice(-1)
    const newCode = [...codeArr]
    newCode[index] = digit
    setCode(newCode)
    if (digit && index < 5) refs.current[index+1]?.focus()
    if (newCode.every(d=>d) && onComplete) setTimeout(onComplete, 50)
  }

  function handleOtpKeyDown(e, index, refs, codeArr, setCode) {
    if (e.key === 'Backspace' && !codeArr[index] && index > 0) refs.current[index-1]?.focus()
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
    setAdminTab('dashboard')
    setLoginData({ email:'', password:'' })
    setAdminEmail('')
    setData({ operators:[], subscribers:[], bookings:[], washPoints:[] })
    setCreateModal(false)
    setAddPointModal(false)
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
      closeCreateModal()
      loadData()
    } catch(e) { setCreateError('Network error.') }
    finally { setCreateLoading(false) }
  }

  // ── DELETE OPERATOR ───────────────────────────────────────────────
  async function handleResetOperatorPassword(op) {
    const password = prompt(`New password for ${op.email}:`)
    if (!password || password.length < 6) {
      if (password !== null) showToast('Password must be at least 6 characters', true)
      return
    }
    try {
      const res = await fetch('/api/operators', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: op.id, password }),
      })
      const json = await res.json()
      if (!res.ok) { showToast(json.error || 'Reset failed', true); return }
      showToast('Operator password updated — they can sign in now.')
    } catch (e) { showToast('Network error', true) }
  }

  async function handleAssignOperatorTier(opId, commission_tier) {
    try {
      const res = await fetch('/api/operators', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: opId, commission_tier }),
      })
      const json = await res.json()
      if (!res.ok) {
        showToast(json.error || 'Could not update tier', true)
        return
      }
      showToast('Commission tier updated.')
      loadData()
    } catch (e) {
      showToast('Network error', true)
    }
  }

  async function handleAssignOperatorWashPoint(opId, wash_point, wash_point_id) {
    if (!wash_point) {
      showToast('Select a wash point.', true)
      return
    }
    try {
      const res = await fetch('/api/operators', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: opId, wash_point, wash_point_id: wash_point_id || undefined }),
      })
      const json = await res.json()
      if (!res.ok) {
        showToast(json.error || 'Could not assign wash point', true)
        return
      }
      showToast('Wash point assigned.')
      loadData()
    } catch (e) {
      showToast('Network error', true)
    }
  }

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
      closeAddPointModal()
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

  // ── MODAL OVERLAY COMPONENT ───────────────────────────────────────
  function Modal({ onClose, children }) {
    useEffect(() => {
      function onKey(e) { if (e.key === 'Escape') onClose() }
      document.addEventListener('keydown', onKey)
      return () => document.removeEventListener('keydown', onKey)
    }, [onClose])
    return (
      <div
        style={{
          position:'fixed', inset:0, zIndex:1000,
          background:'rgba(0,0,0,0.7)',
          display:'flex', alignItems:'center', justifyContent:'center',
          backdropFilter:'blur(4px)'
        }}
        onClick={e => { if (e.target === e.currentTarget) onClose() }}
      >
        <div style={{
          background:'var(--navy2,#0d1117)', border:'1px solid rgba(255,255,255,.1)',
          borderRadius:16, padding:28, width:420, maxWidth:'95vw',
          maxHeight:'90vh', overflowY:'auto'
        }}>
          {children}
        </div>
      </div>
    )
  }

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

      {/* 2FA VERIFY */}
      {screen === 'tfa-verify' && (
        <div className="center-screen">
          <div className="tfa-card">
            <div style={{fontSize:36,marginBottom:12}}>📧</div>
            <h2>Check Your Email</h2>
            <p className="tfa-subtitle">We sent a 6-digit code to <strong style={{color:'var(--gold)'}}>{pending.email}</strong>. Enter it below to continue.</p>
            <div className="otp-input-row">
              {verifyCode.map((d,i) => (
                <input key={i} className="otp-digit" maxLength={1} type="text" inputMode="numeric" value={d}
                  ref={el=>verifyRefs.current[i]=el}
                  onChange={e=>handleOtpInput(i,e.target.value,verifyCode,setVerifyCode,verifyRefs,handleVerify)}
                  onKeyDown={e=>handleOtpKeyDown(e,i,verifyRefs,verifyCode,setVerifyCode)}
                  onPaste={e=>handleOtpPaste(e,setVerifyCode,verifyRefs,handleVerify)} />
              ))}
            </div>
            <div className="tfa-timer">Code expires in <span>10</span> minutes</div>
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
        <AdminDashboard
          adminEmail={adminEmail}
          adminTab={adminTab}
          setAdminTab={setAdminTab}
          data={data}
          dataLoading={dataLoading}
          loadData={loadData}
          onLogout={handleLogout}
          onAddWashPoint={() => setAddPointModal(true)}
          onAddOperator={() => setCreateModal(true)}
          onDeleteWashPoint={handleDeleteWashPoint}
          onDeleteOperator={handleDeleteOperator}
          onResetOperatorPassword={handleResetOperatorPassword}
          onAssignOperatorWashPoint={handleAssignOperatorWashPoint}
          onAssignOperatorTier={handleAssignOperatorTier}
          analyticsPanel={<Intelligence />}
        />
      )}

      {/* CREATE OPERATOR MODAL */}
      {createModal && (
        <Modal onClose={closeCreateModal}>
          <h3 style={{marginBottom:20}}>Add New Operator</h3>
          <div className="form-group">
            <label>Full Name</label>
            <input type="text" placeholder="John Kamau" value={newOp.name} onChange={e=>setNewOp({...newOp,name:e.target.value})} />
          </div>
          <div className="form-group">
            <label>Email</label>
            <input type="email" placeholder="john@splashpass.co.ke" value={newOp.email} onChange={e=>setNewOp({...newOp,email:e.target.value})} />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input type="password" placeholder="Temporary password" value={newOp.password} onChange={e=>setNewOp({...newOp,password:e.target.value})} />
          </div>
          <div className="form-group">
            <label>Assign Wash Point</label>
            <select value={newOp.wash_point} onChange={e=>{
              const p = data.washPoints.find(wp => wp.name === e.target.value)
              setNewOp({...newOp, wash_point: e.target.value, wash_point_id: p ? p.id : ''})
            }}>
              <option value="">Select wash point</option>
              {data.washPoints.map(p=><option key={p.id} value={p.name}>{p.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Commission tier</label>
            <select value={newOp.commission_tier} onChange={e=>setNewOp({...newOp, commission_tier: e.target.value})}>
              <option value="1">Tier 1 — operator 80% / SplashPass 20%</option>
              <option value="2">Tier 2 — operator 90% / SplashPass 10%</option>
            </select>
          </div>
          {createError && <div className="form-error">{createError}</div>}
          <div style={{display:'flex',gap:10,marginTop:16}}>
            <button className="btn btn-gold" disabled={createLoading} onClick={handleCreateOperator} style={{flex:1}}>
              {createLoading ? 'Please wait...' : 'Create Operator'}
            </button>
            <button className="btn btn-outline" onClick={closeCreateModal} style={{flex:1}}>Cancel</button>
          </div>
        </Modal>
      )}

      {/* ADD WASH POINT MODAL */}
      {addPointModal && (
        <Modal onClose={closeAddPointModal}>
          <h3 style={{marginBottom:20}}>Add Wash Point</h3>
          <div className="form-group">
            <label>Name</label>
            <input type="text" placeholder="SplashPass Nyali" value={newPoint.name} onChange={e=>setNewPoint({...newPoint,name:e.target.value})} />
          </div>
          <div className="form-group">
            <label>Area / Suburb</label>
            <input type="text" placeholder="Nyali, Mombasa" value={newPoint.area} onChange={e=>setNewPoint({...newPoint,area:e.target.value})} />
          </div>
          <div className="form-group">
            <label>Latitude</label>
            <input type="number" step="any" placeholder="-4.0435" value={newPoint.lat} onChange={e=>setNewPoint({...newPoint,lat:e.target.value})} />
          </div>
          <div className="form-group">
            <label>Longitude</label>
            <input type="number" step="any" placeholder="39.7173" value={newPoint.lng} onChange={e=>setNewPoint({...newPoint,lng:e.target.value})} />
          </div>
          <div className="form-group">
            <label>Description</label>
            <textarea placeholder="e.g. Located at the Nyali Centre parking lot." style={{resize:'vertical',minHeight:80,width:'100%',background:'var(--navy3,#1a2233)',border:'1px solid rgba(255,255,255,.1)',borderRadius:8,padding:'10px 12px',color:'inherit',fontFamily:'inherit',fontSize:14}} value={newPoint.description} onChange={e=>setNewPoint({...newPoint,description:e.target.value})} />
          </div>
          <div className="form-group">
            <label>Photo</label>
            <input type="file" accept="image/*" style={{padding:'10px 12px',cursor:'pointer'}} onChange={e=>{
              const f=e.target.files[0]; if(!f) return
              setPointFile(f)
              const reader=new FileReader()
              reader.onload=ev=>setPointPreview(ev.target.result)
              reader.readAsDataURL(f)
            }} />
            {pointPreview && <img src={pointPreview} style={{width:'100%',height:160,objectFit:'cover',borderRadius:10,border:'1px solid rgba(255,255,255,.1)',marginTop:10}} alt="" />}
          </div>
          {addPointError && <div className="form-error">{addPointError}</div>}
          <div style={{display:'flex',gap:10,marginTop:16}}>
            <button className="btn btn-gold" disabled={addPointLoading} onClick={handleCreateWashPoint} style={{flex:1}}>
              {addPointLoading ? 'Please wait...' : 'Add Wash Point'}
            </button>
            <button className="btn btn-outline" onClick={closeAddPointModal} style={{flex:1}}>Cancel</button>
          </div>
        </Modal>
      )}

      {/* TOAST */}
      <div id="toast" className={toast.show?'show':''} style={{borderLeftColor:toast.error?'var(--danger)':'var(--gold)'}}>{toast.msg}</div>
    </>
  )
}
