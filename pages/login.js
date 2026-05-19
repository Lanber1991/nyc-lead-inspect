import { useState } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { supabase } from '../lib/supabaseClient'

export default function Login() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError('Invalid email or password.')
      setLoading(false)
    } else {
      router.push('/')
    }
  }

  return (
    <>
      <Head><title>Sign In — NYC Lead Inspections</title></Head>
      <div style={{ minHeight:'100vh', background:'#F8FAFC', fontFamily:'system-ui,sans-serif', display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div style={{ width:'100%', maxWidth:'380px', padding:'0 16px' }}>

          <div style={{ textAlign:'center', marginBottom:'32px' }}>
            <div style={{ fontSize:'20px', fontWeight:'700', color:'#0E2A50' }}>NYC Lead Inspections</div>
            <div style={{ fontSize:'13px', color:'#64748B', marginTop:'4px' }}>IAQ Inspection Dashboard</div>
          </div>

          <div style={{ background:'white', borderRadius:'12px', border:'1px solid #E2E8F0', padding:'32px' }}>
            <div style={{ fontSize:'16px', fontWeight:'600', color:'#0F172A', marginBottom:'24px' }}>Sign in</div>

            {error && (
              <div style={{ background:'#FEE2E2', color:'#991B1B', border:'1px solid #FCA5A5', borderRadius:'8px', padding:'10px 14px', fontSize:'13px', marginBottom:'16px' }}>
                {error}
              </div>
            )}

            <form onSubmit={handleLogin}>
              <div style={{ marginBottom:'16px' }}>
                <label style={{ fontSize:'12px', fontWeight:'600', color:'#374151', display:'block', marginBottom:'6px' }}>Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoFocus
                  style={{ width:'100%', boxSizing:'border-box', padding:'10px 12px', border:'1px solid #D1D5DB', borderRadius:'8px', fontSize:'14px', color:'#0F172A', outline:'none' }}
                />
              </div>
              <div style={{ marginBottom:'24px' }}>
                <label style={{ fontSize:'12px', fontWeight:'600', color:'#374151', display:'block', marginBottom:'6px' }}>Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  style={{ width:'100%', boxSizing:'border-box', padding:'10px 12px', border:'1px solid #D1D5DB', borderRadius:'8px', fontSize:'14px', color:'#0F172A', outline:'none' }}
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                style={{ width:'100%', background:'#0E2A50', color:'white', border:'none', borderRadius:'8px', padding:'12px', fontSize:'14px', fontWeight:'600', cursor:loading?'not-allowed':'pointer', opacity:loading?0.7:1 }}
              >
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </>
  )
}
