import { net } from 'electron'
import type { CloudConfig } from './config'
import { fromFsFields, toFsFields, type FsValue, type Json } from './firestoreCodec'
import { CloudError } from './oauthUtil'

// Electron's net.fetch goes through Chromium's network stack, which honours the system proxy;
// Node's own fetch doesn't, and Google is unreachable without one in some regions.
async function call<T>(url: string, init: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await net.fetch(url, init)
  } catch (e) {
    throw new CloudError('network', (e as Error).message)
  }
  if (res.status === 404) return undefined as T
  const text = await res.text()
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const j = JSON.parse(text) as { error?: { message?: string } | string; error_description?: string }
      detail = (typeof j.error === 'string' ? j.error_description ?? j.error : j.error?.message) ?? detail
    } catch {
      /* keep status text */
    }
    throw new CloudError('firebase', detail)
  }
  return (text ? JSON.parse(text) : undefined) as T
}

export interface FirebaseSession {
  uid: string
  email?: string
  photoUrl?: string
  idToken: string
  refreshToken: string
  expiresAt: number
}

export async function signInWithGoogleIdToken(cfg: CloudConfig, googleIdToken: string): Promise<FirebaseSession> {
  const r = await call<{ localId: string; email?: string; photoUrl?: string; idToken: string; refreshToken: string; expiresIn: string }>(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${cfg.firebase.apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        postBody: `id_token=${googleIdToken}&providerId=google.com`,
        requestUri: 'http://localhost',
        returnSecureToken: true,
        returnIdpCredential: true
      })
    }
  )
  return {
    uid: r.localId,
    email: r.email,
    photoUrl: r.photoUrl,
    idToken: r.idToken,
    refreshToken: r.refreshToken,
    expiresAt: Date.now() + Number(r.expiresIn) * 1000
  }
}

export async function refreshSession(cfg: CloudConfig, s: FirebaseSession): Promise<FirebaseSession> {
  const r = await call<{ id_token: string; refresh_token: string; expires_in: string }>(
    `https://securetoken.googleapis.com/v1/token?key=${cfg.firebase.apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: s.refreshToken }).toString()
    }
  )
  return { ...s, idToken: r.id_token, refreshToken: r.refresh_token, expiresAt: Date.now() + Number(r.expires_in) * 1000 }
}

const docUrl = (cfg: CloudConfig, uid: string) =>
  `https://firestore.googleapis.com/v1/projects/${cfg.firebase.projectId}/databases/(default)/documents/users/${uid}`

/** Reads the user's document; undefined when it doesn't exist yet. */
export async function getUserDoc(cfg: CloudConfig, s: FirebaseSession): Promise<{ [k: string]: Json } | undefined> {
  const r = await call<{ fields?: Record<string, FsValue> } | undefined>(docUrl(cfg, s.uid), {
    headers: { Authorization: `Bearer ${s.idToken}` }
  })
  return r ? fromFsFields(r.fields ?? {}) : undefined
}

/** Creates or overwrites the user's document. */
export async function putUserDoc(cfg: CloudConfig, s: FirebaseSession, data: { [k: string]: Json }): Promise<void> {
  await call(docUrl(cfg, s.uid), {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${s.idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toFsFields(data) })
  })
}
