import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import Spinner from '../components/Spinner'

export default function LoginPage() {
  const { login } = useAuth()
  const { dark, toggle } = useTheme()
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()

  const changeLang = (lng) => {
    i18n.changeLanguage(lng)
    localStorage.setItem('lang', lng)
  }

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(username, password)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setError(err.response?.data?.detail ?? t('auth.loginError'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="soc-shell relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-12">
      <div className="pointer-events-none absolute -left-32 top-[-12rem] h-[32rem] w-[32rem] rounded-full bg-primary-300/20 blur-3xl dark:bg-primary-700/15" />
      <div className="pointer-events-none absolute -bottom-52 -right-32 h-[34rem] w-[34rem] rounded-full bg-amber-300/20 blur-3xl dark:bg-amber-700/10" />
      {/* Theme toggle */}
      <button
        onClick={toggle}
        className="fixed right-4 top-4 z-10 grid min-h-12 min-w-12 cursor-pointer place-items-center rounded-full [background:var(--md-sys-color-surface-container-high)] [color:var(--md-sys-color-on-surface-variant)] shadow-[var(--md-sys-elevation-1)] transition-colors hover:[background:var(--md-sys-color-primary-container)]"
        aria-label={dark ? t('sidebar.lightTheme') : t('sidebar.darkTheme')}
      >
        {dark ? (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z" />
          </svg>
        ) : (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
          </svg>
        )}
      </button>

      <div className="card relative w-full max-w-md overflow-hidden p-7 sm:p-10">
        <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-primary-900 via-primary-500 to-amber-400" />
        <div className="mb-8">
          <div className="mb-6 flex items-center gap-4">
            <div className="md3-brand-mark grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-base font-extrabold">KR</div>
            <div>
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-primary-700 dark:text-primary-300">KRK • University</p>
              <p className="mt-1 text-sm font-bold leading-tight [color:var(--md-sys-color-on-surface)]">Комитет ректорского контроля</p>
            </div>
          </div>
          <h1 className="text-3xl font-bold tracking-tight [color:var(--md-sys-color-on-surface)]">{t('auth.title')}</h1>
          <p className="mt-2 text-sm [color:var(--md-sys-color-on-surface-variant)]">Корпоративная учётная запись университета</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label" htmlFor="username">{t('auth.login')}</label>
            <input
              id="username"
              type="text"
              className="input"
              placeholder="Логин и пароль от Platonus"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
              autoComplete="username"
            />
          </div>

          <div>
            <label className="label" htmlFor="password">{t('auth.password')}</label>
            <input
              id="password"
              type="password"
              className="input"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>

          {error && (
            <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300" role="alert">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full mt-2"
          >
            {loading ? <Spinner size="sm" /> : t('auth.signIn')}
          </button>
        </form>
      </div>

      <div className="fixed bottom-4 left-1/2 flex -translate-x-1/2 gap-1 rounded-full p-1 [background:var(--md-sys-color-surface-container-high)] shadow-[var(--md-sys-elevation-1)]">
        {['ru', 'kz', 'en'].map((lng) => (
          <button
            key={lng}
            onClick={() => changeLang(lng)}
            className={`min-h-9 cursor-pointer rounded-full px-4 py-1 text-xs font-semibold uppercase transition-colors ${
              i18n.language === lng
                ? 'bg-primary-700 text-white shadow-sm dark:bg-primary-300 dark:text-primary-900'
                : '[color:var(--md-sys-color-on-surface-variant)] hover:[background:var(--md-sys-color-surface-container)]'
            }`}
            aria-pressed={i18n.language === lng}
          >
            {lng}
          </button>
        ))}
      </div>
    </div>
  )
}
