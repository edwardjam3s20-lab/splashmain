'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  adminDisplayName,
  timeGreeting,
  formatKSh,
  computeDashboardMetrics,
  relativeTime,
  initials,
  bookingDateKey,
} from './dashboard-utils'
import './admin-dashboard.css'

function Sparkline({ series, color }) {
  const values = series.map((d) => d.value)
  const max = Math.max(...values, 1)
  const w = 100
  const h = 30
  const pts = values
    .map((v, i) => {
      const x = values.length === 1 ? w / 2 : (i / (values.length - 1)) * w
      const y = h - (v / max) * (h - 4) - 2
      return `${x},${y}`
    })
    .join(' ')
  return (
    <svg className="adm-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={pts}
      />
    </svg>
  )
}

function LineChart({ series, color, formatValue }) {
  const values = series.map((d) => d.value)
  const max = Math.max(...values, 1)
  const w = 400
  const h = 160
  const pad = { t: 12, r: 12, b: 28, l: 12 }
  const innerW = w - pad.l - pad.r
  const innerH = h - pad.t - pad.b
  const pts = values.map((v, i) => {
    const x = pad.l + (values.length === 1 ? innerW / 2 : (i / (values.length - 1)) * innerW)
    const y = pad.t + innerH - (v / max) * innerH
    return { x, y, label: series[i].label, value: v }
  })
  const line = pts.map((p) => `${p.x},${p.y}`).join(' ')
  const peak = pts.reduce((a, b) => (b.value > a.value ? b : a), pts[0])

  return (
    <svg className="adm-line-chart" viewBox={`0 0 ${w} ${h}`}>
      <defs>
        <linearGradient id={`grad-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {pts.length > 1 && (
        <polygon
          fill={`url(#grad-${color.replace('#', '')})`}
          points={`${line} ${pts[pts.length - 1].x},${pad.t + innerH} ${pts[0].x},${pad.t + innerH}`}
        />
      )}
      <polyline fill="none" stroke={color} strokeWidth="2.5" points={line} />
      {peak && peak.value > 0 && (
        <g>
          <circle cx={peak.x} cy={peak.y} r="5" fill={color} />
          <text x={peak.x} y={peak.y - 10} textAnchor="middle" fill="#8a9bb0" fontSize="10">
            {formatValue ? formatValue(peak.value) : peak.value}
          </text>
        </g>
      )}
      {pts.map((p, i) => (
        <text
          key={i}
          x={p.x}
          y={h - 6}
          textAnchor="middle"
          fill="#6b7c93"
          fontSize="9"
        >
          {p.label}
        </text>
      ))}
    </svg>
  )
}

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: '▦' },
  { id: 'wash-points', label: 'Wash Points', icon: '◎' },
  { id: 'operators', label: 'Operators', icon: '👤' },
  { id: 'subscribers', label: 'Subscribers', icon: '◉' },
  { id: 'bookings', label: 'Bookings', icon: '📅' },
  { id: 'analytics', label: 'Analytics', icon: '📈' },
  { id: 'transactions', label: 'Transactions', icon: '💳', soon: true },
  { id: 'coupons', label: 'Coupons', icon: '🏷', soon: true },
  { id: 'settings', label: 'Settings', icon: '⚙', soon: true },
]

const AVATAR_COLORS = ['#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#06b6d4']

function OperatorCard({
  op,
  washPoints,
  onResetOperatorPassword,
  onDeleteOperator,
  onAssignOperatorWashPoint,
  onAssignOperatorTier,
}) {
  const [washPoint, setWashPoint] = useState(op.wash_point || '')
  const [tier, setTier] = useState(String(op.commission_tier != null ? op.commission_tier : 1))
  const [saving, setSaving] = useState(false)
  const [savingTier, setSavingTier] = useState(false)

  useEffect(() => {
    setWashPoint(op.wash_point || '')
  }, [op.wash_point])

  useEffect(() => {
    setTier(String(op.commission_tier != null ? op.commission_tier : 1))
  }, [op.commission_tier])

  const unchanged = washPoint === (op.wash_point || '')
  const tierUnchanged = tier === String(op.commission_tier != null ? op.commission_tier : 1)

  async function saveWashPoint() {
    const point = washPoints.find((wp) => wp.name === washPoint)
    setSaving(true)
    try {
      await onAssignOperatorWashPoint(op.id, washPoint, point?.id || '')
    } finally {
      setSaving(false)
    }
  }

  async function saveTier() {
    setSavingTier(true)
    try {
      await onAssignOperatorTier(op.id, Number(tier))
    } finally {
      setSavingTier(false)
    }
  }

  return (
    <div className="op-card">
      <div className="op-card-name">{op.full_name || op.name || '—'}</div>
      <div className="op-card-email">{op.email}</div>
      <div className="adm-op-assign">
        <label htmlFor={`wp-${op.id}`}>Wash point</label>
        <select
          id={`wp-${op.id}`}
          value={washPoint}
          onChange={(e) => setWashPoint(e.target.value)}
          disabled={saving || !washPoints.length}
        >
          <option value="">Select wash point</option>
          {washPoints.map((p) => (
            <option key={p.id} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn-gold adm-op-save"
          disabled={saving || !washPoint || unchanged}
          onClick={saveWashPoint}
        >
          {saving ? 'Saving…' : unchanged ? 'Assigned' : 'Save assignment'}
        </button>
        <label htmlFor={`tier-${op.id}`} style={{ marginTop: 12 }}>
          Commission tier
        </label>
        <select
          id={`tier-${op.id}`}
          value={tier}
          onChange={(e) => setTier(e.target.value)}
          disabled={savingTier}
        >
          <option value="1">Tier 1 — operator 80% / SplashPass 20%</option>
          <option value="2">Tier 2 — operator 90% / SplashPass 10%</option>
        </select>
        <button
          type="button"
          className="btn btn-outline adm-op-save"
          disabled={savingTier || tierUnchanged}
          onClick={saveTier}
        >
          {savingTier ? 'Saving…' : tierUnchanged ? 'Tier saved' : 'Save tier'}
        </button>
      </div>
      <button
        type="button"
        className="btn btn-outline"
        style={{ padding: '6px 14px', fontSize: 12, width: '100%', marginTop: 8 }}
        onClick={() => onResetOperatorPassword(op)}
      >
        Reset password
      </button>
      <button
        type="button"
        className="btn btn-danger"
        style={{ padding: '6px 14px', fontSize: 12, width: '100%', marginTop: 6 }}
        onClick={() => onDeleteOperator(op.id)}
      >
        Remove
      </button>
    </div>
  )
}

export default function AdminDashboard({
  adminEmail,
  adminTab,
  setAdminTab,
  data,
  dataLoading,
  loadData,
  onLogout,
  onAddWashPoint,
  onAddOperator,
  onDeleteWashPoint,
  onDeleteOperator,
  onResetOperatorPassword,
  onAssignOperatorWashPoint,
  onAssignOperatorTier,
  analyticsPanel,
}) {
  const name = adminDisplayName(adminEmail)
  const metrics = useMemo(() => computeDashboardMetrics(data), [data])

  const dateRangeLabel = useMemo(() => {
    const end = new Date()
    const start = new Date()
    start.setDate(end.getDate() - 6)
    const fmt = (d) =>
      d.toLocaleDateString('en-KE', { month: 'short', day: 'numeric', year: 'numeric' })
    return `${fmt(start)} – ${fmt(end)}`
  }, [])

  function goTab(id) {
    if (NAV.find((n) => n.id === id)?.soon) return
    setAdminTab(id)
  }

  return (
    <div className="adm-root">
      <aside className="adm-sidebar">
        <div className="adm-brand">
          <div className="adm-brand-icon">S</div>
          <div>
            <div className="adm-brand-title">SplashPass</div>
            <div className="adm-brand-sub">Admin</div>
          </div>
        </div>
        <nav className="adm-nav">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`adm-nav-item ${adminTab === item.id ? 'active' : ''} ${item.soon ? 'muted-tab' : ''}`}
              onClick={() => goTab(item.id)}
            >
              <span className="adm-nav-icon">{item.icon}</span>
              {item.label}
              {item.soon && (
                <span style={{ marginLeft: 'auto', fontSize: 10, opacity: 0.6 }}>Soon</span>
              )}
            </button>
          ))}
        </nav>
        <div className="adm-profile">
          <div className="adm-avatar">{initials(name, adminEmail)}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="adm-profile-name">{name}</div>
            <div className="adm-profile-role">Super Admin</div>
          </div>
        </div>
      </aside>

      <div className="adm-main">
        <header className="adm-header">
          <div>
            <h1>
              {timeGreeting()}, {name.split(' ')[0]} 👋
            </h1>
            <p>Here&apos;s what&apos;s happening with your platform today.</p>
          </div>
          <div className="adm-header-actions">
            <div className="adm-pill">{dateRangeLabel}</div>
            <button type="button" className="adm-icon-btn" title="Notifications">
              🔔
              {metrics.recentActivity.length > 0 && (
                <span className="badge">{Math.min(9, metrics.recentActivity.length)}</span>
              )}
            </button>
            <button type="button" className="adm-icon-btn" onClick={onLogout} title="Log out">
              ⎋
            </button>
          </div>
        </header>

        <div className="adm-content">
          {adminTab === 'dashboard' && (
            <>
              <div className="adm-kpi-row">
                <div className="adm-kpi">
                  <div className="adm-kpi-label">Total Revenue</div>
                  <div className="adm-kpi-value" style={{ color: 'var(--adm-gold)' }}>
                    {formatKSh(metrics.totalRevenue)}
                  </div>
                  <div className={`adm-kpi-delta ${metrics.revenueDelta >= 0 ? 'up' : 'neutral'}`}>
                    {metrics.revenueDelta >= 0 ? '+' : ''}
                    {metrics.revenueDelta}% this week
                  </div>
                  <Sparkline series={metrics.revenueSeries} color="#f59e0b" />
                </div>
                <div className="adm-kpi">
                  <div className="adm-kpi-label">Total Bookings</div>
                  <div className="adm-kpi-value" style={{ color: 'var(--adm-blue)' }}>
                    {metrics.totalBookings}
                  </div>
                  <div className={`adm-kpi-delta ${metrics.bookingDelta >= 0 ? 'up' : 'neutral'}`}>
                    {metrics.bookingDelta >= 0 ? '+' : ''}
                    {metrics.bookingDelta}% this week
                  </div>
                  <Sparkline series={metrics.bookingsSeries} color="#3b82f6" />
                </div>
                <div className="adm-kpi">
                  <div className="adm-kpi-label">Active Subscribers</div>
                  <div className="adm-kpi-value" style={{ color: 'var(--adm-purple)' }}>
                    {metrics.activeSubscribers}
                  </div>
                  <div className="adm-kpi-delta up">+{metrics.subscriberDelta} recent</div>
                  <Sparkline
                    series={metrics.bookingsSeries.map((d) => ({
                      ...d,
                      value: Math.max(1, Math.round(d.value * 0.6)),
                    }))}
                    color="#8b5cf6"
                  />
                </div>
                <div className="adm-kpi">
                  <div className="adm-kpi-label">Wash Points</div>
                  <div className="adm-kpi-value" style={{ color: 'var(--adm-green)' }}>
                    {metrics.washPointCount}
                  </div>
                  <div className="adm-kpi-delta neutral">{metrics.operatorCount} operators</div>
                  <Sparkline
                    series={[{ value: metrics.washPointCount }, { value: metrics.washPointCount }]}
                    color="#10b981"
                  />
                </div>
              </div>

              <div className="adm-charts-row">
                <div className="adm-chart-card">
                  <div className="adm-chart-head">
                    <h3>Bookings Overview</h3>
                    <span className="adm-pill" style={{ padding: '6px 10px', fontSize: 11 }}>
                      Last 7 days
                    </span>
                  </div>
                  <LineChart series={metrics.bookingsSeries} color="#f59e0b" />
                </div>
                <div className="adm-chart-card">
                  <div className="adm-chart-head">
                    <h3>Revenue Overview</h3>
                    <span className="adm-pill" style={{ padding: '6px 10px', fontSize: 11 }}>
                      Last 7 days
                    </span>
                  </div>
                  <LineChart
                    series={metrics.revenueSeries}
                    color="#10b981"
                    formatValue={(v) => formatKSh(v)}
                  />
                </div>
              </div>

              <div className="adm-bottom-row">
                <div>
                  <div className="adm-table-card" style={{ marginBottom: 16 }}>
                    <h3>Top Performing Wash Points</h3>
                    {dataLoading ? (
                      <div className="adm-empty">Loading…</div>
                    ) : !metrics.topWashPoints.length ? (
                      <div className="adm-empty">No wash point data yet.</div>
                    ) : (
                      <table className="adm-table">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Wash Point</th>
                            <th>Bookings</th>
                            <th>Revenue</th>
                            <th>Growth</th>
                          </tr>
                        </thead>
                        <tbody>
                          {metrics.topWashPoints.map((p) => (
                            <tr key={p.id}>
                              <td className="adm-rank">{p.rank}</td>
                              <td>
                                <div className="adm-point-cell">
                                  {p.image_url ? (
                                    <img src={p.image_url} alt="" className="adm-point-thumb" />
                                  ) : (
                                    <div className="adm-point-thumb placeholder">💧</div>
                                  )}
                                  <div>
                                    <div style={{ fontWeight: 600 }}>{p.name}</div>
                                    <div style={{ fontSize: 12, color: 'var(--adm-muted)' }}>
                                      {p.area || 'Mombasa'}
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td>{p.bookings}</td>
                              <td>{formatKSh(p.revenue)}</td>
                              <td className="adm-growth up">{p.growth}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                  <div className="adm-table-card">
                    <h3>Recent Subscribers</h3>
                    {dataLoading ? (
                      <div className="adm-empty">Loading…</div>
                    ) : !metrics.recentSubscribers.length ? (
                      <div className="adm-empty">No subscribers yet.</div>
                    ) : (
                      <table className="adm-table">
                        <thead>
                          <tr>
                            <th>Subscriber</th>
                            <th>Plan</th>
                            <th>Vehicle</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {metrics.recentSubscribers.map((u, i) => (
                            <tr key={u.id}>
                              <td>
                                <span
                                  className="adm-sub-avatar"
                                  style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}
                                >
                                  {initials(u.name, u.phone)}
                                </span>
                                <span style={{ fontWeight: 600 }}>{u.name || '—'}</span>
                                <div style={{ fontSize: 12, color: 'var(--adm-muted)' }}>
                                  {u.phone || '—'}
                                </div>
                              </td>
                              <td>{u.plan || '—'}</td>
                              <td style={{ fontWeight: 700, letterSpacing: 1 }}>{u.plate || '—'}</td>
                              <td>
                                <span
                                  className={`adm-status ${
                                    (u.sub_status || '').toLowerCase() === 'active' ? 'active' : 'pending'
                                  }`}
                                >
                                  {u.sub_status || 'pending'}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>

                <div className="adm-side-col">
                  <div className="adm-table-card">
                    <h3>Recent Activity</h3>
                    {metrics.recentActivity.length === 0 ? (
                      <div className="adm-empty">No recent activity.</div>
                    ) : (
                      metrics.recentActivity.map((a) => (
                        <div key={a.id} className="adm-activity-item">
                          <div
                            className={`adm-activity-icon ${a.type === 'subscriber' ? 'sub' : 'book'}`}
                          >
                            {a.type === 'subscriber' ? '◉' : '📅'}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="adm-activity-text">{a.text}</div>
                            <div className="adm-activity-sub">{a.sub}</div>
                          </div>
                          <div className="adm-activity-time">{relativeTime(a.at)}</div>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="adm-table-card">
                    <h3>Quick Actions</h3>
                    <div className="adm-quick-grid">
                      <button type="button" className="adm-quick-btn" onClick={onAddWashPoint}>
                        <span style={{ color: 'var(--adm-green)' }}>+</span>
                        Add Wash Point
                      </button>
                      <button type="button" className="adm-quick-btn" onClick={onAddOperator}>
                        <span style={{ color: 'var(--adm-blue)' }}>+</span>
                        Add Operator
                      </button>
                      <button
                        type="button"
                        className="adm-quick-btn"
                        onClick={() => setAdminTab('subscribers')}
                      >
                        <span style={{ color: 'var(--adm-purple)' }}>◉</span>
                        View Subscribers
                      </button>
                      <button
                        type="button"
                        className="adm-quick-btn"
                        onClick={() => setAdminTab('analytics')}
                      >
                        <span style={{ color: 'var(--adm-gold)' }}>📈</span>
                        View Reports
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {adminTab === 'wash-points' && (
            <>
              <div className="adm-section-actions">
                <h2 className="adm-page-title" style={{ margin: 0 }}>
                  Wash Points
                </h2>
                <button type="button" className="btn btn-gold" onClick={onAddWashPoint}>
                  + Add Wash Point
                </button>
              </div>
              <div className="op-grid">
                {dataLoading ? (
                  <div className="adm-empty">Loading…</div>
                ) : !data.washPoints.length ? (
                  <div className="adm-empty">No wash points yet.</div>
                ) : (
                  data.washPoints.map((p) => (
                    <div key={p.id} className="op-card">
                      {p.image_url && (
                        <img
                          src={p.image_url}
                          style={{
                            width: '100%',
                            height: 110,
                            objectFit: 'cover',
                            borderRadius: 8,
                            marginBottom: 10,
                          }}
                          alt=""
                        />
                      )}
                      <div className="op-card-name">💧 {p.name}</div>
                      <div className="op-card-email">{p.area}</div>
                      <div className="op-card-point" style={{ color: 'var(--grey)' }}>
                        📌 {parseFloat(p.lat).toFixed(4)}, {parseFloat(p.lng).toFixed(4)}
                      </div>
                      {p.description && (
                        <div style={{ fontSize: 12, color: 'var(--grey)', marginBottom: 10 }}>
                          {p.description}
                        </div>
                      )}
                      <button
                        type="button"
                        className="btn btn-danger"
                        style={{ padding: '6px 14px', fontSize: 12, width: '100%' }}
                        onClick={() => onDeleteWashPoint(p.id)}
                      >
                        Remove
                      </button>
                    </div>
                  ))
                )}
              </div>
            </>
          )}

          {adminTab === 'operators' && (
            <>
              <div className="adm-section-actions">
                <h2 className="adm-page-title" style={{ margin: 0 }}>
                  Operators
                </h2>
                <button type="button" className="btn btn-gold" onClick={onAddOperator}>
                  + Add Operator
                </button>
              </div>
              <div className="op-grid">
                {dataLoading ? (
                  <div className="adm-empty">Loading…</div>
                ) : !data.operators.length ? (
                  <div className="adm-empty">No operators yet.</div>
                ) : (
                  data.operators.map((op) => (
                    <OperatorCard
                      key={op.id}
                      op={op}
                      washPoints={data.washPoints}
                      onResetOperatorPassword={onResetOperatorPassword}
                      onDeleteOperator={onDeleteOperator}
                      onAssignOperatorWashPoint={onAssignOperatorWashPoint}
                      onAssignOperatorTier={onAssignOperatorTier}
                    />
                  ))
                )}
              </div>
            </>
          )}

          {adminTab === 'subscribers' && (
            <>
              <div className="adm-section-actions">
                <h2 className="adm-page-title" style={{ margin: 0 }}>
                  Subscribers
                </h2>
                <button type="button" className="btn btn-outline" onClick={loadData}>
                  ↻ Refresh
                </button>
              </div>
              <div className="adm-table-card">
                <div style={{ overflowX: 'auto' }}>
                  <table className="adm-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Phone</th>
                        <th>Plan</th>
                        <th>Credits</th>
                        <th>Status</th>
                        <th>Plate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dataLoading ? (
                        <tr>
                          <td colSpan={6} className="adm-empty">
                            Loading…
                          </td>
                        </tr>
                      ) : !data.subscribers.length ? (
                        <tr>
                          <td colSpan={6} className="adm-empty">
                            No subscribers yet
                          </td>
                        </tr>
                      ) : (
                        data.subscribers.map((u) => (
                          <tr key={u.id}>
                            <td>{u.name || '—'}</td>
                            <td>{u.phone || '—'}</td>
                            <td>{u.plan || '—'}</td>
                            <td style={{ color: 'var(--adm-gold)', fontWeight: 700 }}>
                              {u.plan === 'Fleet' ? '∞' : u.credits || 0}
                            </td>
                            <td>
                              <span
                                className={`adm-status ${
                                  (u.sub_status || '').toLowerCase() === 'active' ? 'active' : 'pending'
                                }`}
                              >
                                {u.sub_status || 'pending'}
                              </span>
                            </td>
                            <td style={{ fontWeight: 700, letterSpacing: 1 }}>{u.plate || '—'}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {adminTab === 'bookings' && (
            <>
              <div className="adm-section-actions">
                <h2 className="adm-page-title" style={{ margin: 0 }}>
                  Bookings
                </h2>
                <button type="button" className="btn btn-outline" onClick={loadData}>
                  ↻ Refresh
                </button>
              </div>
              <div className="adm-table-card">
                <div style={{ overflowX: 'auto' }}>
                  <table className="adm-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Location</th>
                        <th>Vehicle</th>
                        <th>Status</th>
                        <th>Payment</th>
                        <th>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dataLoading ? (
                        <tr>
                          <td colSpan={6} className="adm-empty">
                            Loading…
                          </td>
                        </tr>
                      ) : !data.bookings.length ? (
                        <tr>
                          <td colSpan={6} className="adm-empty">
                            No bookings yet
                          </td>
                        </tr>
                      ) : (
                        [...data.bookings]
                          .sort(
                            (a, b) =>
                              new Date(b.date || b.created_at || 0) -
                              new Date(a.date || a.created_at || 0)
                          )
                          .map((b) => (
                            <tr key={b.id}>
                              <td>{b.date || bookingDateKey(b) || '—'}</td>
                              <td>{b.location || b.wash_point || '—'}</td>
                              <td>{b.car_type || b.plate || '—'}</td>
                              <td>{b.status || '—'}</td>
                              <td>{b.payment_status || '—'}</td>
                              <td>{b.amount ? formatKSh(b.amount) : '—'}</td>
                            </tr>
                          ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {adminTab === 'analytics' && (
            <div className="adm-analytics-wrap">{analyticsPanel}</div>
          )}
        </div>
      </div>
    </div>
  )
}
