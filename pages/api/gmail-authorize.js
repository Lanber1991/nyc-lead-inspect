// Visit this URL once to authorize reports@mindfulsolutionsny.com
export default function handler(req, res) {
  const clientId = process.env.GMAIL_CLIENT_ID
  const redirectUri = 'https://nyc-lead-inspect.vercel.app/api/gmail-auth'
  
  const scopes = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.modify'
  ].join(' ')

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${clientId}&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `response_type=code&` +
    `scope=${encodeURIComponent(scopes)}&` +
    `access_type=offline&` +
    `prompt=consent&` +
    `login_hint=reports@mindfulsolutionsny.com`

  res.redirect(authUrl)
}
