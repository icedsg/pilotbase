import { useCallback } from 'react'
import Cookies from 'js-cookie'
import { apiGetOrCreateSession } from '../api/client'
import { useStore } from '../store'

const COOKIE_KEY = 'pilotbase_uid'
const COOKIE_EMAIL_KEY = 'pilotbase_email'
const COOKIE_DAYS = 365

function getOrCreateUserId(): string {
  let id = Cookies.get(COOKIE_KEY)
  if (!id) {
    // crypto.randomUUID is available in all modern browsers
    id = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36)
    Cookies.set(COOKIE_KEY, id, { expires: COOKIE_DAYS, sameSite: 'Lax' })
  }
  return id
}

export function useUserSession() {
  const { session, setSession } = useStore()

  const initSession = useCallback(async (email?: string) => {
    const userId = getOrCreateUserId()
    const savedEmail = email || Cookies.get(COOKIE_EMAIL_KEY) || undefined

    try {
      const data = await apiGetOrCreateSession(userId, savedEmail)
      setSession(data)
      if (data.email) {
        Cookies.set(COOKIE_EMAIL_KEY, data.email, { expires: COOKIE_DAYS, sameSite: 'Lax' })
      }
    } catch (err) {
      console.error('Failed to init session:', err)
      // Fallback: set minimal session so the app is usable offline-ish
      setSession({ userId, email: savedEmail || null, role: 'user', isActive: true })
    }
  }, [setSession])

  const userId = session?.userId ?? (Cookies.get(COOKIE_KEY) || '')

  return { session, userId, initSession }
}
