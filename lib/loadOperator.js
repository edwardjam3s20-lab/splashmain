import { getSupabaseAdmin } from '@/lib/supabase'

/** Columns that exist on all SplashPass operator tables */
const BASE_COLUMNS = 'id,name,email,password,wash_point'

function isMissingColumnError(error, column) {
  const msg = error?.message || ''
  return msg.includes(column) && (msg.includes('does not exist') || msg.includes('Could not find'))
}

async function selectOperatorByEmail(supabase, normalized) {
  let { data: op, error } = await supabase
    .from('operators')
    .select(`${BASE_COLUMNS},wash_point_id,status`)
    .eq('email', normalized)
    .maybeSingle()

  if (isMissingColumnError(error, 'wash_point_id') || isMissingColumnError(error, 'status')) {
    const fallback = await supabase
      .from('operators')
      .select(BASE_COLUMNS)
      .eq('email', normalized)
      .maybeSingle()
    op = fallback.data
    error = fallback.error
  }

  if (error) return { op: null, error }

  if (!op) {
    const { data: rows, error: err2 } = await supabase
      .from('operators')
      .select(BASE_COLUMNS)
      .ilike('email', normalized)

    if (rows?.length === 1) op = rows[0]
    else if (rows?.length > 1) {
      op = rows.find((r) => r.email?.toLowerCase() === normalized) || rows[0]
    }
    if (!op) return { op: null, error: err2 }
  }

  if (!op.status) op.status = 'open'
  return { op, error: null }
}

async function attachWashPointId(supabase, op) {
  if (op.wash_point_id || !op.wash_point) return op
  const { data: wp } = await supabase
    .from('wash_points')
    .select('id')
    .eq('name', op.wash_point)
    .maybeSingle()
  if (wp?.id) op.wash_point_id = wp.id
  return op
}

export async function loadOperatorByEmail(email) {
  const supabase = getSupabaseAdmin()
  const normalized = email.toLowerCase().trim()

  const { op, error } = await selectOperatorByEmail(supabase, normalized)
  if (error) return { op: null, error }
  if (!op) return { op: null, error: null }

  await attachWashPointId(supabase, op)
  return { op, error: null }
}

export async function loadOperatorById(id) {
  const supabase = getSupabaseAdmin()

  let { data: op, error } = await supabase
    .from('operators')
    .select(`${BASE_COLUMNS},wash_point_id,status`)
    .eq('id', id)
    .maybeSingle()

  if (isMissingColumnError(error, 'wash_point_id') || isMissingColumnError(error, 'status')) {
    const fallback = await supabase
      .from('operators')
      .select(BASE_COLUMNS)
      .eq('id', id)
      .maybeSingle()
    op = fallback.data
    error = fallback.error
  }

  if (error || !op) return { op: null, error }

  if (!op.status) op.status = 'open'
  await attachWashPointId(supabase, op)
  return { op, error: null }
}
