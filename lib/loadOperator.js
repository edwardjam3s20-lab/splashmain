import { getSupabaseAdmin } from '@/lib/supabase'

const OPERATOR_COLUMNS = 'id,name,email,password,wash_point,status'

async function queryOperator(supabase, normalized) {
  let { data: op, error } = await supabase
    .from('operators')
    .select(`${OPERATOR_COLUMNS},wash_point_id`)
    .eq('email', normalized)
    .maybeSingle()

  if (error?.message?.includes('wash_point_id')) {
    const fallback = await supabase
      .from('operators')
      .select(OPERATOR_COLUMNS)
      .eq('email', normalized)
      .maybeSingle()
    return { op: fallback.data, error: fallback.error }
  }

  if (error) return { op: null, error }

  if (!op) {
    const { data: rows, error: err2 } = await supabase
      .from('operators')
      .select(`${OPERATOR_COLUMNS},wash_point_id`)
      .ilike('email', normalized)

    if (err2?.message?.includes('wash_point_id')) {
      const fb = await supabase
        .from('operators')
        .select(OPERATOR_COLUMNS)
        .ilike('email', normalized)
      if (fb.data?.length === 1) return { op: fb.data[0], error: null }
      return { op: null, error: fb.error }
    }

    if (rows?.length === 1) op = rows[0]
    else if (rows?.length > 1) {
      op = rows.find((r) => r.email?.toLowerCase() === normalized) || rows[0]
    }
    if (!op) return { op: null, error: err2 }
  }

  return { op, error: null }
}

async function attachWashPointId(supabase, op) {
  if (!op.wash_point_id && op.wash_point) {
    const { data: wp } = await supabase
      .from('wash_points')
      .select('id')
      .eq('name', op.wash_point)
      .maybeSingle()
    if (wp?.id) op.wash_point_id = wp.id
  }
  return op
}

export async function loadOperatorByEmail(email) {
  const supabase = getSupabaseAdmin()
  const normalized = email.toLowerCase().trim()

  const { op, error } = await queryOperator(supabase, normalized)
  if (error) return { op: null, error }
  if (!op) return { op: null, error: null }

  await attachWashPointId(supabase, op)
  return { op, error: null }
}

export async function loadOperatorById(id) {
  const supabase = getSupabaseAdmin()

  let { data: op, error } = await supabase
    .from('operators')
    .select(`${OPERATOR_COLUMNS},wash_point_id`)
    .eq('id', id)
    .maybeSingle()

  if (error?.message?.includes('wash_point_id')) {
    const fallback = await supabase
      .from('operators')
      .select(OPERATOR_COLUMNS)
      .eq('id', id)
      .maybeSingle()
    op = fallback.data
    error = fallback.error
  }

  if (error || !op) return { op: null, error }

  await attachWashPointId(supabase, op)
  return { op, error: null }
}
