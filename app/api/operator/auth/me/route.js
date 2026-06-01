import { NextResponse } from 'next/server'
import { requireOperator } from '@/lib/requireOperator'
import { publicOperator } from '@/lib/operatorSession'

export async function GET() {
  const result = await requireOperator()
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({ operator: publicOperator(result.operator) })
}
