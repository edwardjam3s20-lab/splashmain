import { useState, useEffect, useCallback } from "react";
import { enrichBookingCommission, COMMISSION_TIERS } from "@/lib/commission";

// ─── CONFIG ──────────────────────────────────────────────────────────────────
// Replace these with your actual Supabase credentials
const SUPABASE_URL = "https://msdvyiqjoogafzyaoycg.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_N_g24aU7TLHLNeu72gnfeg_1d7OleFW";

async function query(sql) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/execute_sql`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// Direct table fetch helper
async function fetchTable(table, params = "") {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${params}`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function postTable(table, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function patchTable(table, filter, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const fmt = (n) => `KSh ${Number(n || 0).toLocaleString()}`;
const fmtNum = (n) => Number(n || 0).toLocaleString();
const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const fmtDateTime = (d) => d ? new Date(d).toLocaleString("en-KE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

function daysBetween(a, b) {
  return Math.round(Math.abs(new Date(b) - new Date(a)) / 86400000);
}

// ─── STYLES ──────────────────────────────────────────────────────────────────
const css = `
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Mono:wght@400;500&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #0a0c10;
    --surface: #111318;
    --surface2: #181b22;
    --border: #232733;
    --border2: #2e3340;
    --text: #e8eaf0;
    --muted: #6b7280;
    --accent: #00e5a0;
    --accent2: #0097ff;
    --warn: #ff6b35;
    --danger: #ff3b5c;
    --yellow: #ffd60a;
    --purple: #a78bfa;
    --radius: 12px;
    --radius-sm: 8px;
  }

  body { background: var(--bg); color: var(--text); font-family: 'Syne', sans-serif; min-height: 100vh; }

  .shell { display: flex; min-height: 100vh; }

  /* ── SIDEBAR ── */
  .sidebar {
    width: 220px; flex-shrink: 0; background: var(--surface);
    border-right: 1px solid var(--border); padding: 24px 0;
    display: flex; flex-direction: column; position: sticky; top: 0; height: 100vh;
  }
  .sidebar-logo {
    padding: 0 20px 28px; border-bottom: 1px solid var(--border);
    font-size: 18px; font-weight: 800; letter-spacing: -0.5px;
  }
  .sidebar-logo span { color: var(--accent); }
  .sidebar-label {
    font-size: 10px; font-weight: 600; letter-spacing: 2px; color: var(--muted);
    text-transform: uppercase; padding: 20px 20px 8px;
  }
  .nav-item {
    display: flex; align-items: center; gap: 10px; padding: 10px 20px;
    cursor: pointer; font-size: 13px; font-weight: 600; color: var(--muted);
    transition: all 0.15s; border-left: 3px solid transparent; margin: 1px 0;
  }
  .nav-item:hover { color: var(--text); background: var(--surface2); }
  .nav-item.active { color: var(--accent); border-left-color: var(--accent); background: rgba(0,229,160,0.06); }
  .nav-icon { font-size: 16px; width: 20px; text-align: center; }

  /* ── MAIN ── */
  .main { flex: 1; overflow-x: hidden; }
  .topbar {
    padding: 20px 32px; border-bottom: 1px solid var(--border);
    display: flex; align-items: center; justify-content: space-between;
    background: var(--surface); position: sticky; top: 0; z-index: 10;
  }
  .topbar-title { font-size: 20px; font-weight: 800; letter-spacing: -0.5px; }
  .topbar-sub { font-size: 12px; color: var(--muted); margin-top: 2px; font-family: 'DM Mono', monospace; }
  .refresh-btn {
    background: var(--surface2); border: 1px solid var(--border2);
    color: var(--text); padding: 8px 16px; border-radius: var(--radius-sm);
    cursor: pointer; font-size: 12px; font-family: 'Syne', sans-serif; font-weight: 600;
    transition: all 0.15s;
  }
  .refresh-btn:hover { border-color: var(--accent); color: var(--accent); }

  .content { padding: 28px 32px; }

  /* ── PERIOD TABS ── */
  .period-tabs { display: flex; gap: 4px; background: var(--surface2); border-radius: var(--radius-sm); padding: 4px; width: fit-content; margin-bottom: 24px; }
  .period-tab { padding: 6px 16px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600; color: var(--muted); transition: all 0.15s; }
  .period-tab.active { background: var(--accent); color: #000; }

  /* ── STAT CARDS ── */
  .stats-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; margin-bottom: 28px; }
  .stat-card {
    background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
    padding: 20px; position: relative; overflow: hidden;
  }
  .stat-card::before {
    content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px;
  }
  .stat-card.green::before { background: var(--accent); }
  .stat-card.blue::before { background: var(--accent2); }
  .stat-card.orange::before { background: var(--warn); }
  .stat-card.yellow::before { background: var(--yellow); }
  .stat-card.purple::before { background: var(--purple); }
  .stat-card.red::before { background: var(--danger); }
  .stat-label { font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px; }
  .stat-value { font-size: 26px; font-weight: 800; letter-spacing: -1px; line-height: 1; }
  .stat-sub { font-size: 11px; color: var(--muted); margin-top: 6px; font-family: 'DM Mono', monospace; }

  /* ── SECTION HEADER ── */
  .section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
  .section-title { font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; }
  .section-title .dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 8px; vertical-align: middle; }

  /* ── TABLE ── */
  .table-wrap { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; margin-bottom: 28px; }
  .table-scroll { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  thead th { padding: 12px 16px; text-align: left; font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid var(--border); background: var(--surface2); white-space: nowrap; }
  tbody td { padding: 12px 16px; border-bottom: 1px solid var(--border); vertical-align: middle; }
  tbody tr:last-child td { border-bottom: none; }
  tbody tr:hover { background: rgba(255,255,255,0.02); }
  .mono { font-family: 'DM Mono', monospace; font-size: 12px; }

  /* ── BADGES ── */
  .badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; }
  .badge-green { background: rgba(0,229,160,0.12); color: var(--accent); }
  .badge-blue { background: rgba(0,151,255,0.12); color: var(--accent2); }
  .badge-orange { background: rgba(255,107,53,0.12); color: var(--warn); }
  .badge-yellow { background: rgba(255,214,10,0.12); color: var(--yellow); }
  .badge-purple { background: rgba(167,139,250,0.12); color: var(--purple); }
  .badge-red { background: rgba(255,59,92,0.12); color: var(--danger); }
  .badge-gray { background: rgba(107,114,128,0.15); color: var(--muted); }

  /* ── CHART BAR ── */
  .bar-chart { display: flex; flex-direction: column; gap: 10px; }
  .bar-row { display: flex; align-items: center; gap: 12px; font-size: 12px; }
  .bar-label { width: 130px; flex-shrink: 0; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar-track { flex: 1; height: 8px; background: var(--surface2); border-radius: 4px; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 4px; transition: width 0.6s cubic-bezier(.4,0,.2,1); }
  .bar-val { width: 80px; text-align: right; font-family: 'DM Mono', monospace; color: var(--text); flex-shrink: 0; }

  /* ── REVENUE SPLIT ── */
  .split-track { height: 12px; border-radius: 6px; overflow: hidden; display: flex; margin: 12px 0; }
  .split-seg { height: 100%; transition: width 0.6s ease; }

  /* ── OPERATOR CARD ── */
  .op-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; margin-bottom: 28px; }
  .op-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; }
  .op-card-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 16px; }
  .op-name { font-weight: 700; font-size: 15px; }
  .op-location { font-size: 12px; color: var(--muted); margin-top: 2px; }
  .op-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px; }
  .op-stat { background: var(--surface2); border-radius: var(--radius-sm); padding: 12px; }
  .op-stat-label { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; }
  .op-stat-val { font-size: 18px; font-weight: 700; }
  .op-actions { display: flex; gap: 8px; }
  .btn { padding: 8px 14px; border-radius: var(--radius-sm); font-size: 12px; font-weight: 600; cursor: pointer; border: none; font-family: 'Syne', sans-serif; transition: all 0.15s; }
  .btn-primary { background: var(--accent); color: #000; }
  .btn-primary:hover { background: #00c988; }
  .btn-secondary { background: var(--surface2); color: var(--text); border: 1px solid var(--border2); }
  .btn-secondary:hover { border-color: var(--accent2); color: var(--accent2); }
  .btn-danger { background: rgba(255,59,92,0.1); color: var(--danger); border: 1px solid rgba(255,59,92,0.2); }
  .btn-danger:hover { background: rgba(255,59,92,0.2); }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }

  /* ── PAYMENT MODAL ── */
  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 100; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(4px); }
  .modal { background: var(--surface); border: 1px solid var(--border2); border-radius: var(--radius); padding: 28px; width: 420px; max-width: 95vw; }
  .modal-title { font-size: 18px; font-weight: 800; margin-bottom: 20px; }
  .field { margin-bottom: 16px; }
  .field label { display: block; font-size: 12px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
  .field input, .field select { width: 100%; background: var(--surface2); border: 1px solid var(--border2); border-radius: var(--radius-sm); padding: 10px 14px; color: var(--text); font-size: 13px; font-family: 'Syne', sans-serif; outline: none; transition: border-color 0.15s; }
  .field input:focus, .field select:focus { border-color: var(--accent); }
  .field select option { background: var(--surface); }
  .modal-actions { display: flex; gap: 10px; margin-top: 24px; }

  /* ── CUSTOMER CARD ── */
  .cust-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; margin-bottom: 28px; }
  .cust-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; }
  .cust-header { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
  .avatar { width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 15px; flex-shrink: 0; }
  .cust-name { font-weight: 700; font-size: 14px; }
  .cust-email { font-size: 11px; color: var(--muted); font-family: 'DM Mono', monospace; }
  .cust-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 12px; }
  .cust-stat { text-align: center; background: var(--surface2); border-radius: var(--radius-sm); padding: 10px 6px; }
  .cust-stat-val { font-size: 16px; font-weight: 800; }
  .cust-stat-label { font-size: 10px; color: var(--muted); margin-top: 2px; }
  .cust-fav { font-size: 11px; color: var(--muted); display: flex; align-items: center; gap: 6px; margin-top: 8px; }

  /* ── FILTERS ── */
  .filters { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 16px; }
  .filter-input { background: var(--surface2); border: 1px solid var(--border2); border-radius: var(--radius-sm); padding: 8px 14px; color: var(--text); font-size: 12px; font-family: 'Syne', sans-serif; outline: none; width: 200px; }
  .filter-input:focus { border-color: var(--accent); }
  .filter-select { background: var(--surface2); border: 1px solid var(--border2); border-radius: var(--radius-sm); padding: 8px 14px; color: var(--text); font-size: 12px; font-family: 'Syne', sans-serif; outline: none; }
  .filter-select option { background: var(--surface); }

  /* ── LOADING / EMPTY ── */
  .loading { display: flex; align-items: center; justify-content: center; padding: 60px; color: var(--muted); font-size: 14px; gap: 10px; }
  .spinner { width: 20px; height: 20px; border: 2px solid var(--border2); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .empty { text-align: center; padding: 40px; color: var(--muted); font-size: 13px; }

  /* ── NOTICE ── */
  .notice { background: rgba(255,214,10,0.07); border: 1px solid rgba(255,214,10,0.2); border-radius: var(--radius-sm); padding: 12px 16px; font-size: 12px; color: var(--yellow); margin-bottom: 20px; }
  .notice strong { font-weight: 700; }

  /* ── TWO COL ── */
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 28px; }
  @media (max-width: 900px) { .two-col { grid-template-columns: 1fr; } }

  .panel { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; }
  .panel-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--muted); margin-bottom: 16px; }

  /* ── TIMELINE BAR (daily) ── */
  .daily-bars { display: flex; align-items: flex-end; gap: 4px; height: 80px; }
  .daily-bar-wrap { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; height: 100%; justify-content: flex-end; }
  .daily-bar { width: 100%; border-radius: 3px 3px 0 0; min-height: 2px; transition: height 0.4s ease; cursor: pointer; position: relative; }
  .daily-bar:hover::after { content: attr(data-tip); position: absolute; bottom: calc(100% + 4px); left: 50%; transform: translateX(-50%); background: var(--surface2); border: 1px solid var(--border2); padding: 4px 8px; border-radius: 4px; font-size: 10px; white-space: nowrap; pointer-events: none; font-family: 'DM Mono', monospace; }
  .daily-label { font-size: 9px; color: var(--muted); text-align: center; }

  .success-toast { position: fixed; bottom: 24px; right: 24px; background: var(--accent); color: #000; padding: 12px 20px; border-radius: var(--radius-sm); font-size: 13px; font-weight: 700; z-index: 200; animation: slide-in 0.3s ease; }
  @keyframes slide-in { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
`;

// ─── AVATAR COLOURS ──────────────────────────────────────────────────────────
const AVATAR_COLORS = ["#00e5a0","#0097ff","#ff6b35","#ffd60a","#a78bfa","#ff3b5c"];
const avatarColor = (str) => AVATAR_COLORS[(str || "").charCodeAt(0) % AVATAR_COLORS.length];

// ─── STATUS BADGE ────────────────────────────────────────────────────────────
function StatusBadge({ v }) {
  const map = {
    confirmed: "badge-green", completed: "badge-green",
    pending: "badge-yellow", pending_payment: "badge-yellow",
    cancelled: "badge-red", failed: "badge-red",
    paid: "badge-blue", unpaid: "badge-orange",
    active: "badge-green", inactive: "badge-gray",
    mpesa: "badge-green", bank: "badge-blue",
  };
  const cls = map[(v || "").toLowerCase()] || "badge-gray";
  return <span className={`badge ${cls}`}>{v || "—"}</span>;
}

// ─── MINI BAR CHART ──────────────────────────────────────────────────────────
function BarChart({ items, valueKey, labelKey, color = "var(--accent)" }) {
  const max = Math.max(...items.map(i => i[valueKey] || 0), 1);
  return (
    <div className="bar-chart">
      {items.map((item, i) => (
        <div className="bar-row" key={i}>
          <div className="bar-label" title={item[labelKey]}>{item[labelKey]}</div>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${((item[valueKey] || 0) / max) * 100}%`, background: color }} />
          </div>
          <div className="bar-val">{typeof item[valueKey] === "number" && item[valueKey] > 100 ? fmt(item[valueKey]) : fmtNum(item[valueKey])}</div>
        </div>
      ))}
    </div>
  );
}

// ─── DAILY BARS ──────────────────────────────────────────────────────────────
function DailyBars({ data, valueKey, color }) {
  const max = Math.max(...data.map(d => d[valueKey] || 0), 1);
  return (
    <div className="daily-bars">
      {data.map((d, i) => (
        <div className="daily-bar-wrap" key={i}>
          <div
            className="daily-bar"
            style={{ height: `${((d[valueKey] || 0) / max) * 72}px`, background: color }}
            data-tip={`${d.day}: ${valueKey === "revenue" ? fmt(d[valueKey]) : fmtNum(d[valueKey])}`}
          />
          <div className="daily-label">{d.day}</div>
        </div>
      ))}
    </div>
  );
}

// ─── TOAST ───────────────────────────────────────────────────────────────────
function Toast({ msg, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 2500); return () => clearTimeout(t); }, []);
  return <div className="success-toast">{msg}</div>;
}

// ════════════════════════════════════════════════════════════════════════════
//  TAB: REVENUE
// ════════════════════════════════════════════════════════════════════════════
function RevenueTab({ bookings }) {
  const [period, setPeriod] = useState("month");

  const now = new Date();
  const filtered = bookings.filter(b => {
    const d = new Date(b.created_at);
    if (period === "day") return d.toDateString() === now.toDateString();
    if (period === "week") return (now - d) < 7 * 86400000;
    if (period === "month") return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    return true;
  });

  const paid = filtered.filter(b => b.payment_status === "paid" || b.payment_status === "completed");
  const totalRevenue = paid.reduce((s, b) => s + (b.amount || 0), 0);
  const totalOperator = paid.reduce((s, b) => s + (b.operator_amount || 0), 0);
  const splashRevenue = totalRevenue - totalOperator;
  const bookingFees = paid.length * 30;
  const commissionRevenue = splashRevenue - bookingFees;
  const totalBookings = filtered.length;
  const paidBookings = paid.length;

  // Revenue by location
  const byLocation = {};
  paid.forEach(b => {
    const loc = b.location || "Unknown";
    if (!byLocation[loc]) byLocation[loc] = { revenue: 0, count: 0, operator: 0 };
    byLocation[loc].revenue += b.amount || 0;
    byLocation[loc].count += 1;
    byLocation[loc].operator += b.operator_amount || 0;
  });
  const locationData = Object.entries(byLocation)
    .map(([name, v]) => ({ name, revenue: v.revenue - v.operator, count: v.count }))
    .sort((a, b) => b.revenue - a.revenue).slice(0, 8);

  // Revenue by car type
  const byCarType = {};
  paid.forEach(b => {
    const t = b.car_type || "Unknown";
    byCarType[t] = (byCarType[t] || 0) + (b.amount || 0);
  });
  const carTypeData = Object.entries(byCarType)
    .map(([name, revenue]) => ({ name, revenue }))
    .sort((a, b) => b.revenue - a.revenue);

  // Daily breakdown (last 14 days)
  const daily = {};
  const dayLabels = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const label = d.toLocaleDateString("en", { weekday: "short" }).slice(0, 2);
    daily[key] = { day: label, revenue: 0, bookings: 0 };
    dayLabels.push(key);
  }
  paid.forEach(b => {
    const key = (b.created_at || "").slice(0, 10);
    if (daily[key]) {
      daily[key].revenue += (b.amount || 0) - (b.operator_amount || 0);
      daily[key].bookings += 1;
    }
  });
  const dailyData = dayLabels.map(k => daily[k]);

  const splitPct = totalRevenue > 0 ? Math.round((splashRevenue / totalRevenue) * 100) : 0;

  return (
    <div>
      <div className="period-tabs">
        {["day","week","month","all"].map(p => (
          <div key={p} className={`period-tab ${period === p ? "active" : ""}`} onClick={() => setPeriod(p)}>
            {p === "day" ? "Today" : p === "week" ? "7 Days" : p === "month" ? "This Month" : "All Time"}
          </div>
        ))}
      </div>

      <div className="stats-grid">
        <div className="stat-card green">
          <div className="stat-label">SplashPass Revenue</div>
          <div className="stat-value">{fmt(splashRevenue)}</div>
          <div className="stat-sub">Booking fees + commission</div>
        </div>
        <div className="stat-card blue">
          <div className="stat-label">Total Collected</div>
          <div className="stat-value">{fmt(totalRevenue)}</div>
          <div className="stat-sub">{paidBookings} paid bookings</div>
        </div>
        <div className="stat-card orange">
          <div className="stat-label">Operator Payouts</div>
          <div className="stat-value">{fmt(totalOperator)}</div>
          <div className="stat-sub">Owed to wash points</div>
        </div>
        <div className="stat-card yellow">
          <div className="stat-label">Booking Fees</div>
          <div className="stat-value">{fmt(bookingFees)}</div>
          <div className="stat-sub">KSh 30 × {paidBookings}</div>
        </div>
        <div className="stat-card purple">
          <div className="stat-label">Commission</div>
          <div className="stat-value">{fmt(commissionRevenue)}</div>
          <div className="stat-sub">Tier 1: 20% · Tier 2: 10% of wash price</div>
        </div>
        <div className="stat-card blue">
          <div className="stat-label">Total Bookings</div>
          <div className="stat-value">{fmtNum(totalBookings)}</div>
          <div className="stat-sub">{totalBookings - paidBookings} unpaid / cancelled</div>
        </div>
      </div>

      {/* Revenue split bar */}
      <div className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-title">Revenue Split</div>
        <div className="split-track">
          <div className="split-seg" style={{ width: `${splitPct}%`, background: "var(--accent)" }} title={`SplashPass: ${fmt(splashRevenue)}`} />
          <div className="split-seg" style={{ width: `${100 - splitPct}%`, background: "var(--warn)" }} title={`Operators: ${fmt(totalOperator)}`} />
        </div>
        <div style={{ display: "flex", gap: 20, fontSize: 12 }}>
          <span><span style={{ color: "var(--accent)", fontWeight: 700 }}>■</span> SplashPass {splitPct}% — {fmt(splashRevenue)}</span>
          <span><span style={{ color: "var(--warn)", fontWeight: 700 }}>■</span> Operators {100 - splitPct}% — {fmt(totalOperator)}</span>
        </div>
      </div>

      <div className="two-col">
        <div className="panel">
          <div className="panel-title">Daily Revenue (Last 14 Days)</div>
          <DailyBars data={dailyData} valueKey="revenue" color="var(--accent)" />
        </div>
        <div className="panel">
          <div className="panel-title">Daily Bookings (Last 14 Days)</div>
          <DailyBars data={dailyData} valueKey="bookings" color="var(--accent2)" />
        </div>
      </div>

      <div className="two-col">
        <div className="panel">
          <div className="panel-title">SplashPass Revenue by Location</div>
          <BarChart items={locationData} valueKey="revenue" labelKey="name" color="var(--accent)" />
        </div>
        <div className="panel">
          <div className="panel-title">Revenue by Car Type</div>
          <BarChart items={carTypeData} valueKey="revenue" labelKey="name" color="var(--purple)" />
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  TAB: BOOKINGS
// ════════════════════════════════════════════════════════════════════════════
function BookingsTab({ bookings }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const [carFilter, setCarFilter] = useState("all");
  const [page, setPage] = useState(0);
  const PAGE = 30;

  const locations = [...new Set(bookings.map(b => b.location).filter(Boolean))].sort();
  const carTypes = [...new Set(bookings.map(b => b.car_type).filter(Boolean))].sort();
  const statuses = [...new Set(bookings.map(b => b.payment_status).filter(Boolean))].sort();

  const filtered = bookings.filter(b => {
    const q = search.toLowerCase();
    const matchSearch = !q || [b.user_name, b.user_email, b.location, b.plate, b.car_type].some(v => (v || "").toLowerCase().includes(q));
    const matchStatus = statusFilter === "all" || b.payment_status === statusFilter;
    const matchLoc = locationFilter === "all" || b.location === locationFilter;
    const matchCar = carFilter === "all" || b.car_type === carFilter;
    return matchSearch && matchStatus && matchLoc && matchCar;
  });

  const paged = filtered.slice(page * PAGE, (page + 1) * PAGE);
  const pages = Math.ceil(filtered.length / PAGE);

  const splashCut = (b) => (b.amount || 0) - (b.operator_amount || 0);

  return (
    <div>
      <div className="filters">
        <input className="filter-input" placeholder="Search name, email, plate, location…" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} />
        <select className="filter-select" value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(0); }}>
          <option value="all">All Statuses</option>
          {statuses.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="filter-select" value={locationFilter} onChange={e => { setLocationFilter(e.target.value); setPage(0); }}>
          <option value="all">All Locations</option>
          {locations.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <select className="filter-select" value={carFilter} onChange={e => { setCarFilter(e.target.value); setPage(0); }}>
          <option value="all">All Car Types</option>
          {carTypes.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <span style={{ fontSize: 12, color: "var(--muted)", alignSelf: "center" }}>{filtered.length} bookings</span>
      </div>

      <div className="table-wrap">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Date & Time</th>
                <th>Customer</th>
                <th>Location</th>
                <th>Car</th>
                <th>Plate</th>
                <th>Plan</th>
                <th>Extras</th>
                <th>Total Paid</th>
                <th>SplashPass</th>
                <th>Operator</th>
                <th>Payment</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {paged.length === 0 ? (
                <tr><td colSpan={12} className="empty">No bookings match your filters</td></tr>
              ) : paged.map((b, i) => {
                const extrasArr = Array.isArray(b.extras) ? b.extras : (b.extras ? Object.values(b.extras) : []);
                return (
                  <tr key={b.id || i}>
                    <td className="mono">{fmtDateTime(b.created_at)}</td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{b.user_name || "—"}</div>
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>{b.user_email}</div>
                    </td>
                    <td>{b.location || "—"}</td>
                    <td><span style={{ textTransform: "capitalize" }}>{b.car_type || "—"}</span></td>
                    <td className="mono">{b.plate || "—"}</td>
                    <td>{b.plan ? <span className="badge badge-purple">{b.plan}</span> : "—"}</td>
                    <td>
                      {extrasArr.length > 0
                        ? <span style={{ fontSize: 11, color: "var(--muted)" }}>{extrasArr.join(", ")}</span>
                        : <span style={{ color: "var(--muted)" }}>—</span>}
                    </td>
                    <td className="mono" style={{ fontWeight: 700 }}>{fmt(b.amount)}</td>
                    <td className="mono" style={{ color: "var(--accent)", fontWeight: 600 }}>{fmt(splashCut(b))}</td>
                    <td className="mono" style={{ color: "var(--warn)" }}>{fmt(b.operator_amount)}</td>
                    <td><StatusBadge v={b.payment_status} /></td>
                    <td><StatusBadge v={b.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {pages > 1 && (
        <div style={{ display: "flex", gap: 8, justifyContent: "center", alignItems: "center" }}>
          <button className="btn btn-secondary" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>← Prev</button>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>Page {page + 1} of {pages}</span>
          <button className="btn btn-secondary" onClick={() => setPage(p => Math.min(pages - 1, p + 1))} disabled={page === pages - 1}>Next →</button>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  TAB: OPERATOR PAYMENTS
// ════════════════════════════════════════════════════════════════════════════
function isEarnedBooking(b) {
  return (
    b.payment_status === "paid" ||
    b.payment_status === "completed" ||
    b.status === "completed"
  );
}

function bookingOperatorShare(b, operatorTier) {
  const enriched = enrichBookingCommission(b, b.commission_tier ?? operatorTier ?? 1);
  return enriched.operator_amount || 0;
}

function bookingPlatformShare(b, operatorTier) {
  const enriched = enrichBookingCommission(b, b.commission_tier ?? operatorTier ?? 1);
  return enriched.splash_commission || 0;
}

function OperatorPaymentsTab({ bookings, operators, opPayments, onPaymentRecorded }) {
  const [modal, setModal] = useState(null); // { operator, owed }
  const [payForm, setPayForm] = useState({ amount: "", method: "mpesa", reference: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [historyOp, setHistoryOp] = useState(null);

  // Build per-operator earnings from bookings
  const opEarnings = {};
  bookings.filter(isEarnedBooking).forEach(b => {
    const loc = b.location || "Unknown";
    const op = operators.find((o) => o.wash_point === loc);
    const tier = op?.commission_tier ?? b.commission_tier ?? 1;
    if (!opEarnings[loc]) opEarnings[loc] = { totalEarned: 0, bookings: 0, commission: 0 };
    opEarnings[loc].totalEarned += bookingOperatorShare(b, tier);
    opEarnings[loc].commission += bookingPlatformShare(b, tier);
    opEarnings[loc].bookings += 1;
  });

  // Total paid per operator from payment records
  const paidByOp = {};
  opPayments.forEach(p => {
    paidByOp[p.wash_point] = (paidByOp[p.wash_point] || 0) + (p.amount || 0);
  });

  const opList = operators.map(op => {
    const loc = op.wash_point || op.name;
    const earned = opEarnings[loc] || { totalEarned: 0, bookings: 0, commission: 0 };
    const paid = paidByOp[loc] || 0;
    const tier = op.commission_tier ?? 1;
    const tierCfg = COMMISSION_TIERS[tier] || COMMISSION_TIERS[1];
    return {
      ...op,
      loc,
      earned: earned.totalEarned,
      bookings: earned.bookings,
      commission: earned.commission,
      paid,
      owed: earned.totalEarned - paid,
      tierLabel: tierCfg.label,
      splitLabel: `${tierCfg.operatorLabel} / ${tierCfg.platformLabel}`,
    };
  });

  // Also include locations in bookings not mapped to operators
  Object.keys(opEarnings).forEach(loc => {
    if (!opList.find(o => o.loc === loc)) {
      const earned = opEarnings[loc];
      const paid = paidByOp[loc] || 0;
      opList.push({
        id: loc,
        name: loc,
        loc,
        earned: earned.totalEarned,
        bookings: earned.bookings,
        commission: earned.commission,
        paid,
        owed: earned.totalEarned - paid,
        tierLabel: "Tier 1",
        splitLabel: "80% / 20%",
      });
    }
  });

  const totalOwed = opList.reduce((s, o) => s + Math.max(0, o.owed), 0);
  const totalPaid = opList.reduce((s, o) => s + o.paid, 0);

  async function recordPayment() {
    setSaving(true);
    try {
      const res = await fetch("/api/operator-payments", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wash_point: modal.operator.loc,
          operator_name: modal.operator.name,
          operator_id: modal.operator.id,
          amount: Number(payForm.amount),
          method: payForm.method,
          reference: payForm.reference,
          notes: payForm.notes,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Payment failed");
      onPaymentRecorded();
      setModal(null);
      setPayForm({ amount: "", method: "mpesa", reference: "", notes: "" });
    } catch (e) {
      alert("Error: " + e.message);
    }
    setSaving(false);
  }

  const historyPayments = historyOp ? opPayments.filter(p => p.wash_point === historyOp.loc) : [];

  return (
    <div>
      <div className="notice">
        <strong>Commission:</strong> Tier 1 — operators earn <strong>80%</strong> per wash (SplashPass 20%). Tier 2 — operators earn <strong>90%</strong> (SplashPass 10%). Set tier under <strong>Operators</strong> in the admin sidebar. Record M-Pesa (or other) payouts below.
      </div>

      <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "14px 18px", marginBottom: 20, fontSize: 12, fontFamily: "DM Mono, monospace", color: "var(--muted)" }}>
        First-time setup: run <code>supabase/operator_commission.sql</code> in the Supabase SQL editor (creates <code>operator_payments</code> and tier columns).
      </div>

      <div className="stats-grid">
        <div className="stat-card orange">
          <div className="stat-label">Total Owed to Operators</div>
          <div className="stat-value">{fmt(totalOwed)}</div>
          <div className="stat-sub">Across all wash points</div>
        </div>
        <div className="stat-card blue">
          <div className="stat-label">Total Paid Out</div>
          <div className="stat-value">{fmt(totalPaid)}</div>
          <div className="stat-sub">{opPayments.length} payment records</div>
        </div>
      </div>

      <div className="op-grid">
        {opList.map((op, i) => (
          <div className="op-card" key={op.id || i}>
            <div className="op-card-header">
              <div>
                <div className="op-name">{op.name}</div>
                <div className="op-location">📍 {op.loc}</div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                  {op.tierLabel || "Tier 1"} · {op.splitLabel || "80% / 20%"}
                </div>
              </div>
              {op.owed > 0
                ? <span className="badge badge-orange">Owes {fmt(op.owed)}</span>
                : <span className="badge badge-green">Settled</span>}
            </div>
            <div className="op-stats">
              <div className="op-stat">
                <div className="op-stat-label">Earned</div>
                <div className="op-stat-val" style={{ color: "var(--warn)" }}>{fmt(op.earned)}</div>
              </div>
              <div className="op-stat">
                <div className="op-stat-label">Paid Out</div>
                <div className="op-stat-val" style={{ color: "var(--accent2)" }}>{fmt(op.paid)}</div>
              </div>
              <div className="op-stat">
                <div className="op-stat-label">Bookings</div>
                <div className="op-stat-val">{op.bookings}</div>
              </div>
              <div className="op-stat">
                <div className="op-stat-label">Balance</div>
                <div className="op-stat-val" style={{ color: op.owed > 0 ? "var(--danger)" : "var(--accent)" }}>{fmt(op.owed)}</div>
              </div>
            </div>
            <div className="op-actions">
              <button className="btn btn-primary" onClick={() => { setModal({ operator: op }); setPayForm(f => ({ ...f, amount: String(Math.max(0, op.owed)) })); }} disabled={op.owed <= 0}>
                Record Payment
              </button>
              <button className="btn btn-secondary" onClick={() => setHistoryOp(historyOp?.id === op.id ? null : op)}>
                History
              </button>
            </div>

            {historyOp?.id === op.id && (
              <div style={{ marginTop: 14, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
                {historyPayments.length === 0
                  ? <div style={{ fontSize: 12, color: "var(--muted)" }}>No payments recorded yet.</div>
                  : historyPayments.map((p, j) => (
                    <div key={j} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                      <span style={{ fontFamily: "DM Mono, monospace" }}>{fmtDate(p.paid_at)}</span>
                      <span style={{ color: "var(--accent)", fontWeight: 700 }}>{fmt(p.amount)}</span>
                      <StatusBadge v={p.method} />
                      <span style={{ color: "var(--muted)" }}>{p.reference || "—"}</span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {modal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setModal(null)}>
          <div className="modal">
            <div className="modal-title">Record Payment — {modal.operator.name}</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 16 }}>
              Outstanding balance: <strong style={{ color: "var(--warn)" }}>{fmt(modal.operator.owed)}</strong>
            </div>
            <div className="field">
              <label>Amount (KSh)</label>
              <input type="number" value={payForm.amount} onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))} />
            </div>
            <div className="field">
              <label>Payment Method</label>
              <select value={payForm.method} onChange={e => setPayForm(f => ({ ...f, method: e.target.value }))}>
                <option value="mpesa">M-Pesa</option>
                <option value="bank">Bank Transfer</option>
                <option value="cash">Cash</option>
              </select>
            </div>
            <div className="field">
              <label>Reference / Transaction ID</label>
              <input placeholder="e.g. QEX123ABC" value={payForm.reference} onChange={e => setPayForm(f => ({ ...f, reference: e.target.value }))} />
            </div>
            <div className="field">
              <label>Notes</label>
              <input placeholder="Optional" value={payForm.notes} onChange={e => setPayForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={recordPayment} disabled={saving || !payForm.amount}>
                {saving ? "Saving…" : "Confirm Payment"}
              </button>
              <button className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  TAB: CUSTOMER BEHAVIOUR
// ════════════════════════════════════════════════════════════════════════════
function CustomerBehaviourTab({ bookings, profiles }) {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("washes");

  // Build customer map
  const custMap = {};
  bookings.filter(b => b.payment_status === "paid" || b.payment_status === "completed").forEach(b => {
    const email = b.user_email;
    if (!email) return;
    if (!custMap[email]) custMap[email] = {
      email, name: b.user_name, bookings: [], locations: {}, extras: {}, carTypes: {}, totalSpent: 0
    };
    const c = custMap[email];
    c.bookings.push(b);
    c.totalSpent += b.amount || 0;
    const loc = b.location || "Unknown";
    c.locations[loc] = (c.locations[loc] || 0) + 1;
    const ct = b.car_type || "Unknown";
    c.carTypes[ct] = (c.carTypes[ct] || 0) + 1;
    const extrasArr = Array.isArray(b.extras) ? b.extras : (b.extras ? Object.values(b.extras) : []);
    extrasArr.forEach(ex => { c.extras[ex] = (c.extras[ex] || 0) + 1; });
  });

  // Enrich with profile data
  profiles.forEach(p => {
    if (custMap[p.email]) {
      custMap[p.email].plan = p.plan;
      custMap[p.email].loyaltyTier = p.loyalty_tier;
      custMap[p.email].loyaltyPoints = p.loyalty_points;
      custMap[p.email].preferredPoint = p.preferred_point;
    }
  });

  let custList = Object.values(custMap).map(c => {
    const sorted = [...c.bookings].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const intervals = [];
    for (let i = 1; i < sorted.length; i++) intervals.push(daysBetween(sorted[i - 1].created_at, sorted[i].created_at));
    const avgInterval = intervals.length ? Math.round(intervals.reduce((s, v) => s + v, 0) / intervals.length) : null;
    const favLocation = Object.entries(c.locations).sort((a, b) => b[1] - a[1])[0]?.[0];
    const topExtra = Object.entries(c.extras).sort((a, b) => b[1] - a[1])[0]?.[0];
    const lastBooking = sorted[sorted.length - 1]?.created_at;
    const daysSinceLast = lastBooking ? daysBetween(lastBooking, new Date().toISOString()) : null;
    return { ...c, washes: c.bookings.length, avgInterval, favLocation, topExtra, lastBooking, daysSinceLast };
  });

  // Filter + sort
  custList = custList.filter(c => {
    const q = search.toLowerCase();
    return !q || (c.name || "").toLowerCase().includes(q) || (c.email || "").toLowerCase().includes(q);
  });

  custList.sort((a, b) => {
    if (sortBy === "washes") return b.washes - a.washes;
    if (sortBy === "spent") return b.totalSpent - a.totalSpent;
    if (sortBy === "interval") return (a.avgInterval || 999) - (b.avgInterval || 999);
    if (sortBy === "recent") return new Date(b.lastBooking || 0) - new Date(a.lastBooking || 0);
    if (sortBy === "churn") return (b.daysSinceLast || 0) - (a.daysSinceLast || 0);
    return 0;
  });

  // Aggregate stats
  const totalCustomers = custList.length;
  const avgWashes = totalCustomers ? Math.round(custList.reduce((s, c) => s + c.washes, 0) / totalCustomers) : 0;
  const withInterval = custList.filter(c => c.avgInterval !== null);
  const avgInterval = withInterval.length ? Math.round(withInterval.reduce((s, c) => s + c.avgInterval, 0) / withInterval.length) : 0;
  const churnRisk = custList.filter(c => (c.daysSinceLast || 0) > 21).length;

  // Top extras
  const allExtras = {};
  custList.forEach(c => Object.entries(c.extras).forEach(([k, v]) => { allExtras[k] = (allExtras[k] || 0) + v; }));
  const extrasData = Object.entries(allExtras).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 6);

  // Top locations
  const allLocs = {};
  custList.forEach(c => Object.entries(c.locations).forEach(([k, v]) => { allLocs[k] = (allLocs[k] || 0) + v; }));
  const locsData = Object.entries(allLocs).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 8);

  // Loyalty tier distribution
  const tierDist = {};
  custList.forEach(c => { if (c.loyaltyTier) tierDist[c.loyaltyTier] = (tierDist[c.loyaltyTier] || 0) + 1; });

  return (
    <div>
      <div className="stats-grid">
        <div className="stat-card green">
          <div className="stat-label">Active Customers</div>
          <div className="stat-value">{fmtNum(totalCustomers)}</div>
          <div className="stat-sub">With at least 1 paid booking</div>
        </div>
        <div className="stat-card blue">
          <div className="stat-label">Avg Washes / Customer</div>
          <div className="stat-value">{avgWashes}</div>
          <div className="stat-sub">Paid bookings only</div>
        </div>
        <div className="stat-card purple">
          <div className="stat-label">Avg Wash Interval</div>
          <div className="stat-value">{avgInterval || "—"}<span style={{ fontSize: 14 }}> days</span></div>
          <div className="stat-sub">Among repeat customers</div>
        </div>
        <div className="stat-card red">
          <div className="stat-label">Churn Risk</div>
          <div className="stat-value">{churnRisk}</div>
          <div className="stat-sub">No booking in 21+ days</div>
        </div>
      </div>

      <div className="two-col">
        <div className="panel">
          <div className="panel-title">Top Extras Requested</div>
          {extrasData.length ? <BarChart items={extrasData} valueKey="count" labelKey="name" color="var(--yellow)" /> : <div className="empty">No extras data yet</div>}
        </div>
        <div className="panel">
          <div className="panel-title">Most Popular Wash Points</div>
          <BarChart items={locsData} valueKey="count" labelKey="name" color="var(--accent2)" />
        </div>
      </div>

      {Object.keys(tierDist).length > 0 && (
        <div className="panel" style={{ marginBottom: 24 }}>
          <div className="panel-title">Loyalty Tier Distribution</div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            {Object.entries(tierDist).map(([tier, count]) => (
              <div key={tier} style={{ background: "var(--surface2)", borderRadius: "var(--radius-sm)", padding: "12px 20px", textAlign: "center" }}>
                <div style={{ fontSize: 20, fontWeight: 800 }}>{count}</div>
                <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "capitalize" }}>{tier}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="section-header">
        <div className="section-title"><span className="dot" style={{ background: "var(--accent)" }} />Customer Profiles</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input className="filter-input" placeholder="Search name or email…" value={search} onChange={e => setSearch(e.target.value)} style={{ width: 220 }} />
          <select className="filter-select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
            <option value="washes">Most Washes</option>
            <option value="spent">Highest Spend</option>
            <option value="interval">Shortest Interval</option>
            <option value="recent">Recently Active</option>
            <option value="churn">Churn Risk</option>
          </select>
        </div>
      </div>

      <div className="cust-grid">
        {custList.slice(0, 24).map((c, i) => (
          <div className="cust-card" key={i}>
            <div className="cust-header">
              <div className="avatar" style={{ background: avatarColor(c.name || c.email) + "22", color: avatarColor(c.name || c.email) }}>
                {(c.name || c.email || "?")[0].toUpperCase()}
              </div>
              <div>
                <div className="cust-name">{c.name || "Unknown"}</div>
                <div className="cust-email">{c.email}</div>
              </div>
              {c.loyaltyTier && <span className="badge badge-yellow" style={{ marginLeft: "auto" }}>{c.loyaltyTier}</span>}
            </div>
            <div className="cust-stats">
              <div className="cust-stat">
                <div className="cust-stat-val" style={{ color: "var(--accent)" }}>{c.washes}</div>
                <div className="cust-stat-label">Washes</div>
              </div>
              <div className="cust-stat">
                <div className="cust-stat-val" style={{ color: "var(--purple)" }}>{c.avgInterval ? `${c.avgInterval}d` : "—"}</div>
                <div className="cust-stat-label">Interval</div>
              </div>
              <div className="cust-stat">
                <div className="cust-stat-val" style={{ color: (c.daysSinceLast || 0) > 21 ? "var(--danger)" : "var(--text)" }}>
                  {c.daysSinceLast !== null ? `${c.daysSinceLast}d` : "—"}
                </div>
                <div className="cust-stat-label">Since Last</div>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
              <span style={{ color: "var(--accent)", fontWeight: 700 }}>{fmt(c.totalSpent)}</span>
              {c.plan && <span className="badge badge-purple">{c.plan}</span>}
            </div>
            {c.favLocation && (
              <div className="cust-fav">📍 <span>{c.favLocation}</span>
                {c.topExtra && <><span style={{ margin: "0 4px" }}>·</span>⭐ {c.topExtra}</>}
              </div>
            )}
          </div>
        ))}
      </div>
      {custList.length > 24 && <div className="empty">Showing top 24 of {custList.length} customers. Use search to find others.</div>}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  ROOT APP
// ════════════════════════════════════════════════════════════════════════════
const TABS = [
  { id: "revenue", label: "Revenue", icon: "💰" },
  { id: "bookings", label: "Bookings", icon: "📋" },
  { id: "operators", label: "Operator Payments", icon: "🤝" },
  { id: "customers", label: "Customer Behaviour", icon: "👥" },
];

export default function App() {
  const [tab, setTab] = useState("revenue");
  const [bookings, setBookings] = useState([]);
  const [operators, setOperators] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [opPayments, setOpPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [b, op, pr] = await Promise.all([
        fetchTable("bookings", "?order=created_at.desc&limit=2000"),
        fetchTable("operators", "?order=name.asc"),
        fetchTable("profiles", "?order=created_at.desc&limit=1000"),
      ]);
      setBookings(b);
      setOperators(op);
      setProfiles(pr);

      // operator_payments may not exist yet
      try {
        const payRes = await fetch("/api/operator-payments", { credentials: "include" });
        const payJson = await payRes.json();
        setOpPayments(payRes.ok ? payJson.payments || [] : []);
      } catch {
        setOpPayments([]);
      }

      setLastRefresh(new Date());
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function onPaymentRecorded() {
    load();
    setToast("Payment recorded successfully!");
  }

  return (
    <>
      <style>{css}</style>
      <div className="shell">
        <nav className="sidebar">
          <div className="sidebar-logo">Splash<span>Pass</span></div>
          <div className="sidebar-label">Intelligence</div>
          {TABS.map(t => (
            <div key={t.id} className={`nav-item ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
              <span className="nav-icon">{t.icon}</span>
              {t.label}
            </div>
          ))}
        </nav>

        <div className="main">
          <div className="topbar">
            <div>
              <div className="topbar-title">{TABS.find(t => t.id === tab)?.label}</div>
              {lastRefresh && <div className="topbar-sub">Last updated {lastRefresh.toLocaleTimeString()}</div>}
            </div>
            <button className="refresh-btn" onClick={load} disabled={loading}>
              {loading ? "Loading…" : "↻ Refresh"}
            </button>
          </div>

          <div className="content">
            {loading ? (
              <div className="loading"><div className="spinner" /> Loading data…</div>
            ) : error ? (
              <div className="notice" style={{ color: "var(--danger)", borderColor: "rgba(255,59,92,0.3)", background: "rgba(255,59,92,0.07)" }}>
                <strong>Error:</strong> {error}. Check your Supabase URL and anon key at the top of the file.
              </div>
            ) : (
              <>
                {tab === "revenue" && <RevenueTab bookings={bookings} />}
                {tab === "bookings" && <BookingsTab bookings={bookings} />}
                {tab === "operators" && <OperatorPaymentsTab bookings={bookings} operators={operators} opPayments={opPayments} onPaymentRecorded={onPaymentRecorded} />}
                {tab === "customers" && <CustomerBehaviourTab bookings={bookings} profiles={profiles} />}
              </>
            )}
          </div>
        </div>
      </div>
      {toast && <Toast msg={toast} onDone={() => setToast(null)} />}
    </>
  );
}
