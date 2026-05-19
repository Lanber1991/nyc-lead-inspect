// OAuth callback — exchanges code for refresh token and saves it
export default async function handler(req, res) {
  const { code, error } = req.query

  if (error) {
    return res.status(400).send(`OAuth error: ${error}`)
  }

  if (!code) {
    return res.status(400).send('No authorization code received')
  }

  const clientId = process.env.GMAIL_CLIENT_ID
  const clientSecret = process.env.GMAIL_CLIENT_SECRET
  const redirectUri = 'https://nyc-lead-inspect.vercel.app/api/gmail-auth'

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    })

    const tokens = await tokenRes.json()

    if (!tokens.refresh_token) {
      return res.status(400).send(`No refresh token received. Tokens: ${JSON.stringify(tokens)}`)
    }

    // Show the refresh token so it can be added to Vercel env vars
    return res.status(200).send(`
      <html><body style="font-family:system-ui;padding:2rem;max-width:600px">
        <h2 style="color:#0E2A50">✓ Gmail Authorization Successful</h2>
        <p>Copy this refresh token and add it to Vercel as <strong>GMAIL_REFRESH_TOKEN</strong>:</p>
        <textarea style="width:100%;height:120px;font-family:monospace;font-size:12px;padding:8px;border:1px solid #ccc;border-radius:4px">${tokens.refresh_token}</textarea>
        <p style="margin-top:1rem">In Command Prompt run:<br>
        <code style="background:#f1f5f9;padding:4px 8px;border-radius:4px">vercel env add GMAIL_REFRESH_TOKEN</code><br>
        Then paste the token above and select Production + Preview.</p>
        <p style="color:#64748B;font-size:13px">Access token (expires in 1 hour, not needed): ${tokens.access_token?.slice(0,20)}...</p>
      </body></html>
    `)

  } catch (err) {
    return res.status(500).send(`Error: ${err.message}`)
  }
}
