import { useEffect, useState } from 'react'
import type { CloudState, StatusInfo } from '@shared/types'
import type { PublicConfig } from '../../preload/index.d'
import { useT } from '../i18n'

interface Props {
  status: StatusInfo
  cloud: CloudState
  instantSwitch: boolean
  onInstantSwitch(v: boolean): void
  onClose(): void
}

function AccountSection({ cloud }: { cloud: CloudState }) {
  const tr = useT()
  const { t } = tr
  if (cloud.status === 'unconfigured') return null
  const err = tr.cloudError(cloud.error)
  return (
    <section className="account">
      <h3>{t('accountTitle')}</h3>
      <p className="hint">{t('accountHint')}</p>
      {cloud.status === 'signedIn' ? (
        <div className="account-row">
          <span className="avatar">{(cloud.email ?? '?')[0].toUpperCase()}</span>
          <div className="account-who">
            <div>{cloud.email}</div>
            <div className="account-sync">
              {cloud.syncing ? t('syncing') : cloud.lastSync ? t('syncedAt', { time: tr.time(cloud.lastSync) }) : ''}
            </div>
          </div>
          <button className="secondary" onClick={() => void window.api.cloudSignOut()}>
            {t('signOutCloud')}
          </button>
        </div>
      ) : (
        <button className="google" disabled={cloud.status === 'signingIn'} onClick={() => void window.api.cloudSignIn()}>
          <span className="g">G</span>
          {cloud.status === 'signingIn' ? t('signingIn') : t('signInGoogle')}
        </button>
      )}
      {err && <div className="error">{err}</div>}
    </section>
  )
}

export function Settings({ status, cloud, instantSwitch, onInstantSwitch, onClose }: Props) {
  const { t } = useT()
  const [cfg, setCfg] = useState<PublicConfig>()
  const [appKey, setAppKey] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [callbackUrl, setCallbackUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void window.api.getConfig().then((c) => {
      setCfg(c)
      setAppKey(c.appKey)
      setCallbackUrl(c.callbackUrl)
    })
  }, [])

  const save = async () => {
    const patch = {
      appKey: appKey.trim(),
      callbackUrl: callbackUrl.trim(),
      ...(appSecret ? { appSecret: appSecret.trim() } : {})
    }
    setCfg(await window.api.setConfig(patch))
    setAppSecret('')

  }

  const login = async () => {
    setBusy(true)
    setError('')
    try {
      await save()
      await window.api.login()
      onClose()
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setBusy(false)
    }
  }

  const auth = status.auth
  const daysLeft = auth.status === 'loggedIn' ? Math.max(0, (auth.refreshExpiresAt - Date.now()) / 86_400_000) : 0

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2>{t('settingsTitle')}</h2>
        <AccountSection cloud={cloud} />
        <h3>{t('displayTitle')}</h3>
        <div className="hint">{t('switchLabel')}</div>
        <div className="opt-row">
          <button className={`opt${!instantSwitch ? ' on' : ''}`} onClick={() => onInstantSwitch(false)}>
            {t('switchWait')}
            <small>{t('switchWaitHint')}</small>
          </button>
          <button className={`opt${instantSwitch ? ' on' : ''}`} onClick={() => onInstantSwitch(true)}>
            {t('switchInstant')}
            <small>{t('switchInstantHint')}</small>
          </button>
        </div>
        <h3>Schwab API</h3>
        <p className="hint">{t('settingsHint')}</p>
        <label>
          App Key
          <input value={appKey} onChange={(e) => setAppKey(e.target.value)} spellCheck={false} />
        </label>
        <label>
          App Secret
          <input
            type="password"
            value={appSecret}
            placeholder={cfg?.hasSecret ? t('secretSaved') : ''}
            onChange={(e) => setAppSecret(e.target.value)}
          />
        </label>
        <label>
          Callback URL
          <input value={callbackUrl} onChange={(e) => setCallbackUrl(e.target.value)} spellCheck={false} />
        </label>
        <div className="auth-line">
          {auth.status === 'loggedIn' ? (
            <span className={daysLeft < 1 ? 'warn' : ''}>{t('loggedIn', { days: daysLeft.toFixed(1) })}</span>
          ) : (
            <span className="warn">{t('loggedOut')}</span>
          )}
        </div>
        {error && <div className="error">{error}</div>}
        <div className="modal-actions">
          {auth.status === 'loggedIn' && (
            <button className="secondary" onClick={() => void window.api.logout()}>
              {t('logout')}
            </button>
          )}
          <button className="secondary" onClick={() => void save().then(onClose)}>
            {t('save')}
          </button>
          <button className="primary" disabled={busy || !appKey || !(appSecret || cfg?.hasSecret)} onClick={login}>
            {busy ? t('waitingLogin') : auth.status === 'loggedIn' ? t('relogin') : t('loginSchwab')}
          </button>
        </div>
      </div>
    </div>
  )
}
