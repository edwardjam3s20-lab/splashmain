import { NextResponse } from 'next/server'
import { clearOperatorSessionCookie } from '@/lib/operatorSession'

export async function POST() {
  const res = NextResponse.json({ success: true })
  clearOperatorSessionCookie(res)
  return res
}
