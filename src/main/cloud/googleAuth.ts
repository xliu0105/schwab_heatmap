import { net, shell } from 'electron'
import { createServer } from 'http'
import type { AddressInfo } from 'net'
import { CloudError, googleAuthUrl, parseCallback, pkcePair, randomState } from './oauthUtil'

const TIMEOUT_MS = 3 * 60 * 1000

const page = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font:15px -apple-system,sans-serif;background:#0f0f0f;color:#d1d4dc;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><h2 style="margin:0 0 8px">${title}</h2><p style="color:#868993">${body}</p></div></body>`

/**
 * Google sign-in the way desktop apps must do it: Google refuses embedded webviews, so we open the
 * system browser and receive the redirect on a one-off loopback server (RFC 8252, with PKCE).
 * Resolves with Google's ID token.
 */
export async function googleSignIn(clientId: string, clientSecret: string): Promise<string> {
  const { verifier, challenge } = pkcePair()
  const state = randomState()
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  try {
    const code = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new CloudError('timeout')), TIMEOUT_MS)
      server.on('request', (req, res) => {
        // Browsers also ask for /favicon.ico; only the root path is the redirect.
        if (!req.url || !req.url.startsWith('/?')) {
          res.writeHead(404).end()
          return
        }
        try {
          const { code } = parseCallback(req.url, state)
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(page('登录成功 · Signed in', '可以关闭此页，回到 Schwab Heatmap。You can close this tab.'))
          clearTimeout(timer)
          resolve(code)
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(page('登录失败 · Sign-in failed', (e as Error).message))
          clearTimeout(timer)
          reject(e)
        }
      })
      void shell.openExternal(googleAuthUrl(clientId, redirectUri, challenge, state))
    })

    const res = await net.fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: verifier
      }).toString()
    })
    const json = (await res.json()) as { id_token?: string; error_description?: string; error?: string }
    if (!res.ok || !json.id_token) throw new CloudError('google', json.error_description ?? json.error ?? `HTTP ${res.status}`)
    return json.id_token
  } finally {
    server.close()
  }
}
