// lib/operatorAccess.js
//
// Operator-side equivalent of the customer isOnTrial/isSubscribed check in
// app/api/bookings/route.js. 14-day free trial from operators.created_at,
// then a hard gate: trial expired + not subscribed blocks login and going
// online. Requires operators.created_at and operators.sub_status columns
// — see supabase/operator_freemium.sql. Reimplemented here rather than
// imported from app/api/bookings/route.js since that file isn't a shared
// module (it only exports the route handlers).

export const OPERATOR_TRIAL_DAYS = 14

export function isOperatorOnTrial(operator) {
  if (!operator?.created_at) return false
  const created = new Date(operator.created_at).getTime()
  const daysLeft = Math.ceil((created + OPERATOR_TRIAL_DAYS * 86400000 - Date.now()) / 86400000)
  const status = operator.sub_status
  return daysLeft > 0 && (!status || status === 'trial' || status === 'pending')
}

export function isOperatorSubscribed(operator) {
  return operator?.sub_status === 'active'
}

// True if the operator currently has access (trial or paid) — the single
// check every gate (login, status/open toggle) should call.
export function operatorHasAccess(operator) {
  return isOperatorOnTrial(operator) || isOperatorSubscribed(operator)
}

export function operatorTrialDaysLeft(operator) {
  if (!operator?.created_at) return 0
  const created = new Date(operator.created_at).getTime()
  return Math.max(0, Math.ceil((created + OPERATOR_TRIAL_DAYS * 86400000 - Date.now()) / 86400000))
}
