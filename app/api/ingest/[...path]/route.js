export async function GET(request, { params }) {
  const { path } = await params
  const pathStr = Array.isArray(path) ? path.join('/') : path
  const search = request.nextUrl.search
  const url = `https://eu.i.posthog.com/${pathStr}${search}`

  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
    },
  })

  const body = await res.arrayBuffer()
  return new Response(body, {
    status: res.status,
    headers: {
      'Content-Type': res.headers.get('Content-Type') || 'application/json',
    },
  })
}

export async function POST(request, { params }) {
  const { path } = await params
  const pathStr = Array.isArray(path) ? path.join('/') : path
  const search = request.nextUrl.search
  const url = `https://eu.i.posthog.com/${pathStr}${search}`

  const body = await request.text()

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body,
  })

  const resBody = await res.arrayBuffer()
  return new Response(resBody, {
    status: res.status,
    headers: {
      'Content-Type': res.headers.get('Content-Type') || 'application/json',
    },
  })
}
