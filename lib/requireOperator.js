import { getOperatorSession } from '@/lib/operatorSession'
import { loadOperatorByEmail } from '@/lib/loadOperator'

export async function requireOperator() {
  const session = await getOperatorSession()
  if (!session?.email) return { error: 'Unauthorized', status: 401 }

  const { op, error } = await loadOperatorByEmail(session.email)
  if (error) return { error: 'Could not load operator', status: 500 }
  if (!op) return { error: 'Operator not found', status: 401 }

  return { operator: op }
}
