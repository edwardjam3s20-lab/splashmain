import { getSupabaseAdmin } from '@/lib/supabase'
import { getOperatorSession } from '@/lib/operatorSession'

export async function requireOperator() {
  const session = await getOperatorSession()
  if (!session?.email) return { error: 'Unauthorized', status: 401 }

  const supabase = getSupabaseAdmin()
  const { data: op, error } = await supabase
    .from('operators')
    .select('id,name,email,wash_point,wash_point_id,status')
    .eq('email', session.email.toLowerCase())
    .single()

  if (error || !op) return { error: 'Operator not found', status: 401 }
  return { operator: op }
}

export function bookingLocationFilter(op) {
  const filters = []
  if (op.wash_point) {
    filters.push({ column: 'location', value: op.wash_point })
  }
  if (op.wash_point_id) {
    filters.push({ column: 'wash_point_id', value: op.wash_point_id })
  }
  return filters
}

export function applyLocationFilter(query, op) {
  if (op.wash_point_id) {
    return query.or(`wash_point_id.eq.${op.wash_point_id},location.eq.${encodeURIComponent(op.wash_point || '')}`)
  }
  if (op.wash_point) {
    return query.eq('location', op.wash_point)
  }
  return query
}
