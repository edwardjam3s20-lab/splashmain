'use client'
import { useEffect, useState, Fragment } from 'react'

const STATUS_CLASS = {
  verified: 'active',
  submitted: 'pending',
  under_review: 'pending',
  action_required: 'pending',
  rejected: 'danger',
  suspended: 'danger',
  draft: 'pending',
}

const STATUS_LABEL = {
  verified: 'Verified',
  submitted: 'Submitted',
  under_review: 'Under review',
  action_required: 'Action required',
  rejected: 'Rejected',
  suspended: 'Suspended',
  draft: 'Draft',
}

// Which actions make sense from each current status — mirrors
// TRANSITIONS in app/api/org-verifications/[id]/route.js. Kept here too
// (rather than trusting the server to just reject invalid ones) so the
// admin never sees a button that's guaranteed to 409.
const ACTIONS_FOR_STATUS = {
  submitted: ['approve', 'request_changes', 'reject'],
  under_review: ['approve', 'request_changes', 'reject'],
  action_required: ['approve', 'reject'],
  verified: ['suspend'],
  suspended: ['restore'],
  rejected: [],
  draft: [],
}

const ACTION_LABEL = {
  approve: 'Approve',
  request_changes: 'Request changes',
  reject: 'Reject',
  suspend: 'Suspend',
  restore: 'Restore',
}

const ACTION_BTN_CLASS = {
  approve: 'btn-approve',
  request_changes: 'btn-outline',
  reject: 'btn-danger-outline',
  suspend: 'btn-danger-outline',
  restore: 'btn-approve',
}

const NOTES_REQUIRED = new Set(['request_changes', 'reject', 'suspend'])

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-KE', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function OrgVerificationsPanel() {
  const [orgs, setOrgs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [actingId, setActingId] = useState(null)
  const [message, setMessage] = useState(null) // { text, error }

  async function load() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/org-verifications')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load.')
      setOrgs(json.organizations || [])
    } catch (e) {
      setError(e.message || 'Failed to load verifications.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function handleAction(org, action) {
    let notes = null
    if (NOTES_REQUIRED.has(action)) {
      notes = prompt(
        action === 'reject'
          ? `Why is "${org.name}" being rejected? This is shown to the business.`
          : action === 'suspend'
            ? `Why is "${org.name}" being suspended? This is shown to the business.`
            : `What does "${org.name}" need to fix? This is shown to the business.`
      )
      if (notes === null) return // cancelled
      if (!notes.trim()) {
        setMessage({ text: 'Notes are required for this action.', error: true })
        return
      }
    }

    setActingId(org.id)
    setMessage(null)
    try {
      const res = await fetch(`/api/org-verifications/${org.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, notes }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Action failed.')
      setMessage({ text: `${org.name}: ${ACTION_LABEL[action]} done.`, error: false })
      await load()
    } catch (e) {
      setMessage({ text: e.message || 'Action failed.', error: true })
    } finally {
      setActingId(null)
    }
  }

  return (
    <>
      <div className="adm-section-actions">
        <h2 className="adm-page-title" style={{ margin: 0 }}>
          Business Verifications
        </h2>
        <button type="button" className="btn btn-outline" onClick={load}>
          ↻ Refresh
        </button>
      </div>

      {message && (
        <div
          style={{
            marginBottom: 14,
            padding: '10px 14px',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            background: message.error ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.12)',
            color: message.error ? 'var(--adm-red)' : 'var(--adm-green)',
          }}
        >
          {message.text}
        </div>
      )}

      <div className="adm-table-card">
        <div style={{ overflowX: 'auto' }}>
          <table className="adm-table">
            <thead>
              <tr>
                <th>Business</th>
                <th>Owner</th>
                <th>Type</th>
                <th>Washpoints</th>
                <th>Status</th>
                <th>Submitted</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="adm-empty">Loading…</td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={7} className="adm-empty" style={{ color: 'var(--adm-red)' }}>{error}</td>
                </tr>
              ) : !orgs.length ? (
                <tr>
                  <td colSpan={7} className="adm-empty">No organizations yet.</td>
                </tr>
              ) : (
                orgs.map((org) => {
                  const isExpanded = expandedId === org.id
                  const availableActions = ACTIONS_FOR_STATUS[org.verification_status] || []
                  return (
                    <Fragment key={org.id}>
                      <tr>
                        <td>
                          <button
                            type="button"
                            onClick={() => setExpandedId(isExpanded ? null : org.id)}
                            style={{
                              background: 'none', border: 'none', color: 'inherit', cursor: 'pointer',
                              fontWeight: 700, padding: 0, textAlign: 'left',
                            }}
                          >
                            {isExpanded ? '▾' : '▸'} {org.name}
                          </button>
                        </td>
                        <td>
                          {org.owner ? (
                            <div>
                              <div>{org.owner.full_name || '—'}</div>
                              <div style={{ fontSize: 12, color: 'var(--adm-muted)' }}>{org.owner.email}</div>
                            </div>
                          ) : (
                            <span style={{ color: 'var(--adm-muted)' }}>No owner</span>
                          )}
                        </td>
                        <td style={{ textTransform: 'capitalize' }}>{(org.business_type || '').replace(/_/g, ' ')}</td>
                        <td>{org.washpoint_count}</td>
                        <td>
                          <span className={`adm-status ${STATUS_CLASS[org.verification_status] || 'pending'}`}>
                            {STATUS_LABEL[org.verification_status] || org.verification_status}
                          </span>
                        </td>
                        <td>{fmtDate(org.created_at)}</td>
                        <td>
                          <div className="adm-review-actions">
                            {availableActions.length === 0 ? (
                              <span style={{ color: 'var(--adm-muted)', fontSize: 12 }}>—</span>
                            ) : (
                              availableActions.map((action) => (
                                <button
                                  key={action}
                                  type="button"
                                  className={`btn ${ACTION_BTN_CLASS[action]}`}
                                  disabled={actingId === org.id}
                                  onClick={() => handleAction(org, action)}
                                  style={{ padding: '6px 12px', fontSize: 12 }}
                                >
                                  {actingId === org.id ? '…' : ACTION_LABEL[action]}
                                </button>
                              ))
                            )}
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={7} style={{ background: 'var(--adm-panel2)', padding: 16 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, fontSize: 13 }}>
                              <div><strong>Registration no.</strong><br />{org.registration_number || '—'}</div>
                              <div><strong>KRA PIN</strong><br />{org.kra_pin || '—'}</div>
                              <div><strong>Business phone</strong><br />{org.business_phone || '—'}</div>
                              <div><strong>Business email</strong><br />{org.business_email || '—'}</div>
                              <div style={{ gridColumn: '1 / -1' }}><strong>Address</strong><br />{org.address || '—'}</div>
                              {org.latest_verification?.notes && (
                                <div style={{ gridColumn: '1 / -1' }}>
                                  <strong>Latest review note</strong><br />
                                  {org.latest_verification.notes}
                                  {org.latest_verification.reviewed_by && (
                                    <span style={{ color: 'var(--adm-muted)' }}>
                                      {' '}— {org.latest_verification.reviewed_by} on {fmtDate(org.latest_verification.reviewed_at)}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
