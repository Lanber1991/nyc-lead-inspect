import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { supabase } from '../lib/supabaseClient'

const STATUS_COLORS = {
  pending:      { bg: '#FEF3C7', text: '#92400E', border: '#FCD34D', label: 'Pending Lab Results' },
  lab_received: { bg: '#DBEAFE', text: '#1E40AF', border: '#93C5FD', label: 'Lab Received' },
  complete:     { bg: '#D1FAE5', text: '#065F46', border: '#6EE7B7', label: 'Complete' },
}

export default function Dashboard() {
  const router = useRouter()
  const [inspections, setInspections] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [archiveOpen, setArchiveOpen] = useState({})

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push('/login'); return }
      fetchInspections()
    })
  }, [])

  async function fetchInspections() {
    setLoading(true)
    const res = await fetch('/api/inspections')
    const data = await res.json()
    setInspections(Array.isArray(data) ? data : [])
    setLoading(false)
  }

  function formatDate(d) {
    if (!d) return '—'
    try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
    catch(e) { return d }
  }

  function getNextStep(insp) {
    if (insp.status === 'complete') return { label: '✓ Complete',          bg: '#D1FAE5', color: '#065F46' }
    if (!insp.has_lab)             return { label: 'Drop Lab PDF',         bg: '#FEF3C7', color: '#92400E' }
    if (!insp.has_report)          return { label: 'Generate Report',      bg: '#DBEAFE', color: '#1E40AF' }
    if (!insp.wp_generated)        return { label: 'Generate Work Plan',   bg: '#EDE9FE', color: '#5B21B6' }
    if (!insp.wp_reviewed)         return { label: 'Review & Send',        bg: '#FEF9C3', color: '#713F12' }
    return                                { label: 'Mark Complete',        bg: '#D1FAE5', color: '#065F46' }
  }

  // Split active vs archived (complete + from a previous calendar month)
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const isArchived = (i) => {
    if (i.status !== 'complete') return false
    const m = (i.inspection_date || i.submitted_at || '').slice(0, 7)
    return m.length === 7 && m < currentMonth
  }

  const active   = inspections.filter(i => !isArchived(i))
  const archived = inspections.filter(isArchived)

  const archiveByMonth = {}
  archived.forEach(i => {
    const m = (i.inspection_date || i.submitted_at || '').slice(0, 7)
    if (!archiveByMonth[m]) archiveByMonth[m] = []
    archiveByMonth[m].push(i)
  })
  const archiveMonths = Object.keys(archiveByMonth).sort().reverse()

  function monthLabel(ym) {
    const [yr, mo] = ym.split('-')
    return new Date(parseInt(yr), parseInt(mo) - 1, 1)
      .toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  }

  // Search — spans active + archived
  const searchTerm = search.trim().toLowerCase()
  const matchesSearch = (i) => !searchTerm || [
    i.report_number, i.property_address, i.property_city,
    i.client_name, i.inspector_name,
  ].some(v => v?.toLowerCase().includes(searchTerm))

  const isSearching    = !!searchTerm
  const searchResults  = isSearching ? inspections.filter(matchesSearch) : []

  const counts = {
    all:          active.length,
    pending:      active.filter(i => i.status === 'pending').length,
    lab_received: active.filter(i => i.status === 'lab_received').length,
    complete:     active.filter(i => i.status === 'complete').length,
  }

  const filtered = filter === 'all' ? active : active.filter(i => i.status === filter)

  // Shared styles
  const thStyle = { padding: '10px 16px', fontSize: '11px', fontWeight: '600', color: '#64748B', textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid #F1F5F9' }
  const tdBase  = { padding: '14px 16px', fontSize: '13px' }

  function InspRow({ insp, i, total, showArchiveBadge }) {
    const ns = getNextStep(insp)
    const archived = isArchived(insp)
    return (
      <tr
        style={{ borderBottom: i < total - 1 ? '1px solid #F8FAFC' : 'none', transition: 'background 0.1s' }}
        onMouseEnter={e => e.currentTarget.style.background = '#F8FAFC'}
        onMouseLeave={e => e.currentTarget.style.background = 'white'}
      >
        <td style={{ ...tdBase, fontWeight: '500', color: '#0F172A' }}>
          <div>{insp.report_number}</div>
          {showArchiveBadge && archived && (
            <div style={{ fontSize: '10px', color: '#94A3B8', marginTop: '2px' }}>
              📁 {monthLabel((insp.inspection_date || insp.submitted_at || '').slice(0, 7))}
            </div>
          )}
        </td>
        <td style={{ ...tdBase, color: '#334155' }}>
          <div>{insp.property_address}</div>
          <div style={{ fontSize: '11px', color: '#94A3B8' }}>{insp.property_city}</div>
        </td>
        <td style={{ ...tdBase, color: '#334155' }}>{insp.client_name || '—'}</td>
        <td style={{ ...tdBase, color: '#334155' }}>{insp.inspector_name}</td>
        <td style={{ ...tdBase, color: '#64748B' }}>{formatDate(insp.inspection_date)}</td>
        <td style={{ ...tdBase }}>
          <span style={{ background: ns.bg, color: ns.color, borderRadius: '20px', padding: '3px 10px', fontSize: '11px', fontWeight: '600', whiteSpace: 'nowrap' }}>
            {ns.label}
          </span>
        </td>
        <td style={{ ...tdBase }}>
          <a href={`/inspection/${insp.id}`} style={{ color: '#185FA5', fontSize: '12px', fontWeight: '500', textDecoration: 'none' }}>Open →</a>
        </td>
      </tr>
    )
  }

  function InspTable({ rows, headers, showArchiveBadge }) {
    return (
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#F8FAFC' }}>
            {headers.map(h => <th key={h} style={thStyle}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((insp, i) => (
            <InspRow key={insp.id} insp={insp} i={i} total={rows.length} showArchiveBadge={showArchiveBadge} />
          ))}
        </tbody>
      </table>
    )
  }

  const fullHeaders = ['Report #', 'Property', 'Client', 'Inspector', 'Date', 'Next Step', '']

  return (
    <>
      <Head><title>NYC Lead Inspections — Inspections</title></Head>
      <div style={{ minHeight: '100vh', background: '#F8FAFC', fontFamily: 'system-ui,sans-serif' }}>

        {/* Header */}
        <div style={{ background: '#0E2A50', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ color: 'white', fontSize: '18px', fontWeight: '600' }}>NYC Lead Inspections</div>
            <div style={{ color: '#93C5FD', fontSize: '12px', marginTop: '2px' }}>IAQ Inspection Dashboard</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <a href="/form.html" style={{ background: '#185FA5', color: 'white', padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: '500', textDecoration: 'none' }}>
              + New Inspection
            </a>
            <button
              onClick={async () => { await supabase.auth.signOut(); router.push('/login') }}
              style={{ background: 'transparent', color: '#93C5FD', border: '1px solid #1E3A5F', borderRadius: '8px', padding: '8px 14px', fontSize: '13px', cursor: 'pointer' }}
            >
              Sign out
            </button>
          </div>
        </div>

        <div style={{ maxWidth: '960px', margin: '0 auto', padding: '24px 16px' }}>

          {/* Search bar */}
          <div style={{ position: 'relative', marginBottom: '20px' }}>
            <span style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: '#94A3B8', fontSize: '15px', pointerEvents: 'none' }}>🔍</span>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by address, client, inspector, or report number…"
              style={{ width: '100%', padding: '11px 40px 11px 40px', border: '1px solid #E2E8F0', borderRadius: '10px', fontSize: '14px', fontFamily: 'inherit', background: 'white', outline: 'none', boxSizing: 'border-box', color: '#0F172A' }}
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', fontSize: '16px', lineHeight: 1, padding: '2px' }}
              >✕</button>
            )}
          </div>

          {/* Search results view */}
          {isSearching ? (
            <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #E2E8F0', overflow: 'hidden' }}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontSize: '14px', fontWeight: '500', color: '#0F172A' }}>
                  {searchResults.length === 0
                    ? 'No results'
                    : `${searchResults.length} result${searchResults.length !== 1 ? 's' : ''} for "${search}"`}
                </div>
                <button onClick={() => setSearch('')} style={{ fontSize: '12px', color: '#64748B', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '4px 10px', background: 'none', cursor: 'pointer' }}>
                  Clear search
                </button>
              </div>
              {searchResults.length > 0
                ? <InspTable rows={searchResults} headers={fullHeaders} showArchiveBadge={true} />
                : <div style={{ padding: '48px', textAlign: 'center', color: '#94A3B8' }}>No inspections match "{search}"</div>
              }
            </div>
          ) : (
            <>
              {/* Stats */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '12px', marginBottom: '24px' }}>
                {[
                  { key: 'all',          label: 'Active',          color: '#185FA5' },
                  { key: 'pending',      label: 'Pending Labs',    color: '#D97706' },
                  { key: 'lab_received', label: 'Lab Received',    color: '#1D4ED8' },
                  { key: 'complete',     label: 'Done This Month', color: '#059669' },
                ].map(s => (
                  <div
                    key={s.key}
                    onClick={() => setFilter(s.key)}
                    style={{ background: 'white', borderRadius: '10px', padding: '16px', border: filter === s.key ? `2px solid ${s.color}` : '1px solid #E2E8F0', cursor: 'pointer', transition: 'all 0.15s' }}
                  >
                    <div style={{ fontSize: '28px', fontWeight: '700', color: s.color }}>{counts[s.key]}</div>
                    <div style={{ fontSize: '12px', color: '#64748B', marginTop: '4px' }}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Active table */}
              <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #E2E8F0', overflow: 'hidden', marginBottom: '32px' }}>
                <div style={{ padding: '14px 20px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontSize: '15px', fontWeight: '500' }}>
                    {filter === 'all' ? 'Active Inspections' : STATUS_COLORS[filter]?.label || filter}
                  </div>
                  <button onClick={fetchInspections} style={{ fontSize: '12px', color: '#64748B', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '5px 12px', background: 'none', cursor: 'pointer' }}>
                    Refresh
                  </button>
                </div>
                {loading ? (
                  <div style={{ padding: '48px', textAlign: 'center', color: '#94A3B8' }}>Loading…</div>
                ) : filtered.length === 0 ? (
                  <div style={{ padding: '48px', textAlign: 'center', color: '#94A3B8' }}>
                    No inspections. <a href="/form.html" style={{ color: '#185FA5' }}>Start one</a>
                  </div>
                ) : (
                  <InspTable rows={filtered} headers={fullHeaders} showArchiveBadge={false} />
                )}
              </div>

              {/* Archive */}
              {archiveMonths.length > 0 && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                    <div style={{ fontSize: '11px', fontWeight: '600', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Archive</div>
                    <div style={{ flex: 1, height: '1px', background: '#E2E8F0' }} />
                    <div style={{ fontSize: '11px', color: '#94A3B8' }}>
                      {archived.length} inspection{archived.length !== 1 ? 's' : ''} · {archiveMonths.length} month{archiveMonths.length !== 1 ? 's' : ''}
                    </div>
                  </div>
                  {archiveMonths.map(month => {
                    const items = archiveByMonth[month]
                    const open  = !!archiveOpen[month]
                    return (
                      <div key={month} style={{ background: 'white', borderRadius: '12px', border: '1px solid #E2E8F0', marginBottom: '8px', overflow: 'hidden' }}>
                        <div
                          onClick={() => setArchiveOpen(p => ({ ...p, [month]: !p[month] }))}
                          style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', userSelect: 'none', background: open ? '#F8FAFC' : 'white' }}
                        >
                          <span style={{ fontSize: '15px' }}>📁</span>
                          <span style={{ fontSize: '14px', fontWeight: '500', color: '#334155' }}>{monthLabel(month)}</span>
                          <span style={{ fontSize: '12px', color: '#94A3B8' }}>· {items.length} inspection{items.length !== 1 ? 's' : ''}</span>
                          <div style={{ marginLeft: 'auto', display: 'flex', gap: '16px', alignItems: 'center' }}>
                            <span style={{ fontSize: '11px', color: '#94A3B8' }}>
                              {items.filter(i => i.has_report).length}/{items.length} reports · {items.filter(i => i.wp_reviewed).length}/{items.length} work plans
                            </span>
                            <span style={{ color: '#94A3B8', fontSize: '11px' }}>{open ? '▲' : '▼'}</span>
                          </div>
                        </div>
                        {open && (
                          <div style={{ borderTop: '1px solid #F1F5F9' }}>
                            <InspTable
                              rows={items}
                              headers={['Report #', 'Property', 'Client', 'Inspector', 'Date', 'Next Step', '']}
                              showArchiveBadge={false}
                            />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}
