// app/api/org/washpoints/[id]/photos/route.js
// POST   — upload a new photo for a washpoint, append its public URL to
//          wash_points.photos. Owner-only.
// DELETE — remove a photo URL from wash_points.photos (also best-effort
//          removes the underlying Storage object).
//
// Deliberately its own endpoint rather than letting `photos` be set
// through the generic PATCH in ../route.js: routing every mutation
// through upload/delete here means the max-photos cap, file-type/size
// validation, and array bookkeeping all live in one place, rather than a
// PATCH caller being able to set `photos` to arbitrary strings with none
// of that enforced.
//
// Also deliberately server-side, using the service-role client, rather
// than a direct browser-to-Storage upload with the public anon key (the
// pattern app/admin/page.js's internal admin tool uses for the same
// bucket). That shortcut is reasonable for a trusted internal tool but
// not for a broader, self-serve surface like the operator app — a public
// anon key with storage write access would let ANY visitor holding that
// key upload/overwrite arbitrary files in the bucket, not just verified
// organization owners. Routing through here means requireOrgMember() is
// the actual gate, not the storage bucket's own policies.

import { NextResponse } from 'next/server'
import { requireOrgMember } from '@/lib/requireOrgMember'
import { getSupabaseAdmin } from '@/lib/supabase'
import { orgCorsHeaders } from '@/lib/orgCors'

const MAX_PHOTOS_PER_WASHPOINT = 8
const MAX_FILE_BYTES = 5 * 1024 * 1024 // 5MB
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
// Same bucket app/admin/page.js's internal tool already uploads
// wash-point images into — reused rather than creating a second bucket
// for the same kind of asset.
const BUCKET = 'wash-point-images'

export async function OPTIONS(request) {
  const origin = request.headers.get('origin') || ''
  return new NextResponse(null, { status: 200, headers: orgCorsHeaders(origin) })
}

async function loadOwnedWashpoint(supabase, washpointId, organizationId) {
  const { data: washpoint, error } = await supabase
    .from('wash_points')
    .select('id, photos')
    .eq('id', washpointId)
    .eq('organization_id', organizationId)
    .maybeSingle()
  return { washpoint, error }
}

export async function POST(request, { params }) {
  const origin = request.headers.get('origin') || ''

  const formData = await request.formData().catch(() => null)
  if (!formData) {
    return NextResponse.json({ error: 'Expected multipart form data.' }, { status: 400, headers: orgCorsHeaders(origin) })
  }

  const organizationId = formData.get('organization_id')
  const file = formData.get('photo')

  const auth = await requireOrgMember(organizationId, ['owner'])
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: orgCorsHeaders(origin) })
  }

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'photo file is required.' }, { status: 400, headers: orgCorsHeaders(origin) })
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: 'Only JPEG, PNG, or WEBP images are allowed.' }, { status: 400, headers: orgCorsHeaders(origin) })
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: 'Image must be under 5MB.' }, { status: 400, headers: orgCorsHeaders(origin) })
  }

  const supabase = getSupabaseAdmin()

  // Confirm this washpoint actually belongs to the organization the
  // caller authenticated against — never trust the [id] alone (same
  // pattern the sibling PATCH route already uses).
  const { washpoint, error: fetchError } = await loadOwnedWashpoint(supabase, params.id, organizationId)
  if (fetchError) return NextResponse.json({ error: 'Could not load washpoint.' }, { status: 500, headers: orgCorsHeaders(origin) })
  if (!washpoint) return NextResponse.json({ error: 'Washpoint not found in this organization.' }, { status: 404, headers: orgCorsHeaders(origin) })

  const existingPhotos = Array.isArray(washpoint.photos) ? washpoint.photos : []
  if (existingPhotos.length >= MAX_PHOTOS_PER_WASHPOINT) {
    return NextResponse.json(
      { error: `A washpoint can have at most ${MAX_PHOTOS_PER_WASHPOINT} photos. Remove one first.` },
      { status: 400, headers: orgCorsHeaders(origin) }
    )
  }

  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const fileName = `${params.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

  const arrayBuffer = await file.arrayBuffer()
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(fileName, arrayBuffer, { contentType: file.type, upsert: false })

  if (uploadError) {
    console.error('[org washpoint photo upload] storage error:', uploadError.message)
    return NextResponse.json({ error: 'Could not upload photo.' }, { status: 500, headers: orgCorsHeaders(origin) })
  }

  const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(fileName)
  const photoUrl = publicUrlData?.publicUrl
  if (!photoUrl) {
    console.error('[org washpoint photo upload] getPublicUrl returned no URL for', fileName)
    return NextResponse.json({ error: 'Photo uploaded but could not be linked.' }, { status: 500, headers: orgCorsHeaders(origin) })
  }

  const { data: updated, error: updateError } = await supabase
    .from('wash_points')
    .update({ photos: [...existingPhotos, photoUrl] })
    .eq('id', params.id)
    .select()
    .single()

  if (updateError) {
    console.error('[org washpoint photo upload] update error:', updateError.message)
    return NextResponse.json({ error: 'Photo uploaded but could not be saved to the washpoint.' }, { status: 500, headers: orgCorsHeaders(origin) })
  }

  await supabase.from('audit_logs').insert({
    organization_id: organizationId,
    actor_user_id: auth.user.id,
    actor_type: 'organization_user',
    action: 'washpoint.photo_added',
    target_type: 'washpoint',
    target_id: params.id,
    metadata: { photo_url: photoUrl },
  })

  return NextResponse.json({ ok: true, washpoint: updated }, { headers: orgCorsHeaders(origin) })
}

export async function DELETE(request, { params }) {
  const origin = request.headers.get('origin') || ''
  const body = await request.json().catch(() => ({}))
  const { organization_id: organizationId, photo_url: photoUrl } = body || {}

  const auth = await requireOrgMember(organizationId, ['owner'])
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: orgCorsHeaders(origin) })
  }

  if (!photoUrl) {
    return NextResponse.json({ error: 'photo_url is required.' }, { status: 400, headers: orgCorsHeaders(origin) })
  }

  const supabase = getSupabaseAdmin()

  const { washpoint, error: fetchError } = await loadOwnedWashpoint(supabase, params.id, organizationId)
  if (fetchError) return NextResponse.json({ error: 'Could not load washpoint.' }, { status: 500, headers: orgCorsHeaders(origin) })
  if (!washpoint) return NextResponse.json({ error: 'Washpoint not found in this organization.' }, { status: 404, headers: orgCorsHeaders(origin) })

  const existingPhotos = Array.isArray(washpoint.photos) ? washpoint.photos : []
  const updatedPhotos = existingPhotos.filter((p) => p !== photoUrl)

  if (updatedPhotos.length === existingPhotos.length) {
    return NextResponse.json({ error: 'Photo not found on this washpoint.' }, { status: 404, headers: orgCorsHeaders(origin) })
  }

  const { data: updated, error: updateError } = await supabase
    .from('wash_points')
    .update({ photos: updatedPhotos })
    .eq('id', params.id)
    .select()
    .single()

  if (updateError) {
    console.error('[org washpoint photo delete] update error:', updateError.message)
    return NextResponse.json({ error: 'Could not remove photo.' }, { status: 500, headers: orgCorsHeaders(origin) })
  }

  // Best-effort: also remove the underlying Storage object. Not fatal if
  // this fails (e.g. unexpected URL format) — the photos array is already
  // updated, which is the part that actually controls what customers see.
  try {
    const marker = `/${BUCKET}/`
    const idx = photoUrl.indexOf(marker)
    if (idx !== -1) {
      const path = photoUrl.slice(idx + marker.length)
      await supabase.storage.from(BUCKET).remove([path])
    }
  } catch (e) {
    console.error('[org washpoint photo delete] storage cleanup failed (non-fatal):', e.message)
  }

  await supabase.from('audit_logs').insert({
    organization_id: organizationId,
    actor_user_id: auth.user.id,
    actor_type: 'organization_user',
    action: 'washpoint.photo_removed',
    target_type: 'washpoint',
    target_id: params.id,
    metadata: { photo_url: photoUrl },
  })

  return NextResponse.json({ ok: true, washpoint: updated }, { headers: orgCorsHeaders(origin) })
}
