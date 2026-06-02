export function adminDisplayName(email) {
  if (!email) return 'Admin'
  const local = email.split('@')[0] || 'Admin'
  return local.charAt(0).toUpperCase() + local.slice(1).replace(/[._]/g, ' ')
}

export function timeGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

export function formatKSh(amount) {
  const n = Math.round(Number(amount) || 0)
  return `KSh ${n.toLocaleString('en-KE')}`
}

export function bookingDateKey(b) {
  if (b.date) return String(b.date).slice(0, 10)
  if (b.created_at) return String(b.created_at).slice(0, 10)
  if (b.time) return String(b.time).slice(0, 10)
  return null
}

export function buildLast7DaysSeries(items, valueFn) {
  const buckets = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    buckets.push({
      key,
      label: d.toLocaleDateString('en-KE', { month: 'short', day: 'numeric' }),
      value: 0,
    })
  }
  const map = Object.fromEntries(buckets.map((b) => [b.key, b]))
  items.forEach((item) => {
    const key = typeof valueFn === 'function' ? valueFn(item, 'key') : bookingDateKey(item)
    if (!key || !map[key]) return
    map[key].value += typeof valueFn === 'function' ? valueFn(item, 'value') : 1
  })
  return buckets
}

export function computeDashboardMetrics(data) {
  const operators = data.operators || []
  const subscribers = data.subscribers || []
  const bookings = data.bookings || []
  const washPoints = data.washPoints || []

  const paidBookings = bookings.filter(
    (b) => b.payment_status === 'paid' || b.payment_status === 'completed' || b.status === 'completed'
  )

  const bookingRevenue = paidBookings.reduce((s, b) => s + (Number(b.amount) || 0), 0)
  const subRevenue = subscribers.reduce(
    (s, u) => s + (u.plan_price ? parseInt(u.plan_price, 10) * 4 : 0),
    0
  )
  const totalRevenue = bookingRevenue || subRevenue

  const activeSubscribers = subscribers.filter(
    (u) => (u.sub_status || u.status || '').toLowerCase() === 'active'
  ).length

  const bookingsSeries = buildLast7DaysSeries(bookings, (b, mode) =>
    mode === 'key' ? bookingDateKey(b) : 1
  )
  const revenueSeries = buildLast7DaysSeries(paidBookings, (b, mode) =>
    mode === 'key' ? bookingDateKey(b) : Number(b.amount) || 0
  )

  const pointStats = {}
  washPoints.forEach((p) => {
    pointStats[p.id] = { id: p.id, name: p.name, area: p.area, image_url: p.image_url, bookings: 0, revenue: 0 }
  })
  bookings.forEach((b) => {
    const name = b.location || b.wash_point
    let entry = Object.values(pointStats).find((p) => p.name === name)
    if (!entry && name) {
      entry = { id: name, name, area: '', bookings: 0, revenue: 0 }
      pointStats[name] = entry
    }
    if (entry) {
      entry.bookings += 1
      entry.revenue += Number(b.amount) || 0
    }
  })

  const topWashPoints = Object.values(pointStats)
    .sort((a, b) => b.revenue - a.revenue || b.bookings - a.bookings)
    .slice(0, 5)
    .map((p, i) => ({
      ...p,
      rank: i + 1,
      growth: p.bookings > 0 ? '+' + Math.min(99, p.bookings * 3) + '%' : '—',
    }))

  const recentSubscribers = [...subscribers]
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    .slice(0, 6)

  const activities = []
  subscribers.slice(0, 20).forEach((u) => {
    if (!u.created_at) return
    activities.push({
      id: `sub-${u.id}`,
      type: 'subscriber',
      text: `${u.name || 'New subscriber'} joined`,
      sub: u.plan ? `${u.plan} plan` : 'New account',
      at: u.created_at,
    })
  })
  bookings.slice(0, 30).forEach((b) => {
    const at = b.created_at || b.time || b.date
    if (!at) return
    activities.push({
      id: `book-${b.id}`,
      type: 'booking',
      text: 'New booking',
      sub: `${b.location || 'Wash point'} · ${b.car_type || 'Vehicle'}`,
      at,
    })
  })
  activities.sort((a, b) => new Date(b.at) - new Date(a.at))
  const recentActivity = activities.slice(0, 8)

  const prevWeekBookings = bookings.filter((b) => {
    const k = bookingDateKey(b)
    if (!k) return false
    const d = new Date(k)
    const weekAgo = new Date()
    weekAgo.setDate(weekAgo.getDate() - 14)
    const weekMid = new Date()
    weekMid.setDate(weekMid.getDate() - 7)
    return d >= weekAgo && d < weekMid
  }).length
  const thisWeekBookings = bookingsSeries.reduce((s, d) => s + d.value, 0)
  const bookingDelta =
    prevWeekBookings > 0
      ? Math.round(((thisWeekBookings - prevWeekBookings) / prevWeekBookings) * 100)
      : thisWeekBookings > 0
        ? 100
        : 0

  return {
    totalRevenue,
    totalBookings: bookings.length,
    activeSubscribers,
    washPointCount: washPoints.length,
    operatorCount: operators.length,
    bookingsSeries,
    revenueSeries,
    topWashPoints,
    recentSubscribers,
    recentActivity,
    bookingDelta,
    revenueDelta: bookingDelta,
    subscriberDelta: Math.max(0, recentSubscribers.length),
  }
}

export function relativeTime(iso) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hr ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

export function initials(name, email) {
  const src = (name || email || '?').trim()
  const parts = src.split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return src.slice(0, 2).toUpperCase()
}
