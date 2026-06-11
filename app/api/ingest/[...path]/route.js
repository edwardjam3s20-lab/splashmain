export async function GET(request, { params }) {
  const path = (await params).path.join('/')
  const search = request.nextUrl.search
  const url = `https://eu.i.posthog.com/${path}${search}`
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
  })
  return new Response(res.body, {
    status: res.status,
    headers: res.headers,
  })
}

export async function POST(request, { params }) {
  const path = (await params).path.join('/')
  const search = request.nextUrl.search
  const url = `https://eu.i.posthog.com/${path}${search}`
  const body = await request.text()
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body).toString(),
    },
    body,
  })
  return new Response(res.body, {
    status: res.status,
    headers: res.headers,
  })
}
