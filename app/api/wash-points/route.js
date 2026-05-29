import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getSession } from '@/lib/session'

export async function POST(request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { name, area, lat, lng, description, image_url } = body

  if (!name || !area || !lat || !lng) {
    return NextResponse.json({ error: 'Name, area, lat and lng are required.' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('wash_points')
    .insert({ name, area, lat: parseFloat(lat), lng: parseFloat(lng), description: description || null, image_url: image_url || null })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ washPoint: data })
}

export async function DELETE(request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await request.json()
  if (!id) return NextResponse.json({ error: 'ID required.' }, { status: 400 })

  const supabase = getSupabaseAdmin()
  const { error } = await supabase.from('wash_points').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
