/**
 * Reset an operator password (run locally with .env.local present):
 *   node scripts/reset-operator-password.mjs husseinmohamed003@gmail.com YourNewPassword
 */
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const email = process.argv[2]?.toLowerCase().trim()
const password = process.argv[3]

if (!email || !password) {
  console.error('Usage: node scripts/reset-operator-password.mjs <email> <new-password>')
  process.exit(1)
}

const envPath = resolve(process.cwd(), '.env.local')
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i), l.slice(i + 1)]
    })
)

const secret =
  env.SESSION_SECRET || 'fallback_secret_32_chars_minimum!!'
const hash = createHash('sha256')
  .update(password + secret)
  .digest('hex')

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY
)

const { data: existing } = await supabase
  .from('operators')
  .select('id,email,name')
  .eq('email', email)
  .maybeSingle()

if (!existing) {
  console.error('No operator found for:', email)
  console.error('Create the operator in Admin first, then run this script again.')
  process.exit(1)
}

const { error } = await supabase
  .from('operators')
  .update({ password: hash })
  .eq('id', existing.id)

if (error) {
  console.error('Update failed:', error.message)
  process.exit(1)
}

console.log('Password updated for:', existing.name || existing.email)
console.log('They can now sign in at /operator_v4.html with the password you set.')
console.log('')
console.log('IMPORTANT: Vercel must use the same SESSION_SECRET as .env.local')
console.log('(or run this script after setting Vercel SESSION_SECRET to match)')
