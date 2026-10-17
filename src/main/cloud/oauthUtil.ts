// Pure helpers for the Google desktop sign-in flow (no Electron imports, so they are testable).
import { createHash, randomBytes } from 'crypto'
import type { CloudErrKey } from '@shared/types'

export class CloudError extends Error {
  constructor(
    public key: CloudErrKey,
    public detail?: string
  ) {
    super(detail ? `${key}: ${detail}` : key)
  }
}

const b64url = (buf: Buffer) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32))
  return { verifier, challenge: pkceChallenge(verifier) }
}

export function pkceChallenge(verifier: string): string {
  return b64url(createHash('sha256').update(verifier).digest())
}

export const randomState = () => b64url(randomBytes(16))

export function googleAuthUrl(clientId: string, redirectUri: string, challenge: string, state: string): string {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    prompt: 'select_account'
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`
}

/** Reads the loopback redirect; rejects errors and any request not carrying our `state`. */
export function parseCallback(path: string, expectedState: string): { code: string } {
  const url = new URL(path, 'http://127.0.0.1')
  const err = url.searchParams.get('error')
  if (err) throw new CloudError('cancelled', err)
  if (url.searchParams.get('state') !== expectedState) throw new CloudError('stateMismatch')
  const code = url.searchParams.get('code')
  if (!code) throw new CloudError('noCode')
  return { code }
}
