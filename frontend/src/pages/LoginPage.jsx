import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { Alert, Button, Card, Field, Input, SegmentedControl } from '../components/ui'
import { SapaLogo, SapaMark, SapaWordmark } from '../components/brand/SapaLogo'

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

  const langOptions = [
    { value: 'ru', label: 'RU', title: t('login.langRu') },
    { value: 'kz', label: 'KZ', title: t('login.langKz') },
    { value: 'en', label: 'EN', title: t('login.langEn') },
  ]
  const themeLabel = dark ? t('shell.lightTheme') : t('shell.darkTheme')

  return (
    <div className="flex min-h-screen bg-canvas text-fg">
      {/* Фирменная панель (как на макете логотипа): постоянный navy бренда в обеих темах */}
      <aside className="hidden min-w-0 max-w-xl basis-5/12 flex-col justify-between gap-10 bg-brand-navy p-10 text-on-brand lg:flex xl:p-12">
        <p className="text-sm font-medium text-on-brand/70">{t('sidebar.productOrg')}</p>
        <div className="flex min-w-0 flex-col items-center gap-6 text-center">
          <SapaMark size={152} onDark />
          <SapaWordmark height={72} className="text-on-brand" />
          <span className="h-1 w-12 rounded-full bg-brand-gold" aria-hidden="true" />
          <p className="text-base font-medium text-on-brand/80">{t('login.tagline')}</p>
        </div>
        <div className="flex min-w-0 flex-col gap-1 text-sm">
          <p className="font-semibold text-on-brand">{t('login.systemName')}</p>
          <p className="text-on-brand/70">{t('login.systemCaption')}</p>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        {/* Язык и тема */}
        <div className="flex flex-wrap items-center justify-end gap-2 p-4 sm:px-6">
          <SegmentedControl
            size="sm"
            options={langOptions}
            value={i18n.language}
            onChange={changeLang}
            ariaLabel={t('shell.language')}
          />
          <Button variant="ghost" iconOnly icon={dark ? 'sun' : 'moon'} aria-label={themeLabel} onClick={toggle} />
        </div>

        <div className="flex flex-1 items-center justify-center px-4 pb-16 pt-4 sm:px-6">
          <div className="flex w-full min-w-0 max-w-md flex-col gap-8">
            {/* Логотип для узких экранов, где нет фирменной панели */}
            <div className="flex min-w-0 flex-col items-center gap-3 text-center lg:hidden">
              <SapaLogo height={40} />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-fg">{t('login.systemName')}</p>
                <p className="text-xs text-fg-subtle">{t('login.systemCaption')}</p>
              </div>
            </div>

            <Card className="p-6 sm:p-8">
              <div className="mb-6">
                <h1 className="text-2xl font-semibold text-fg">{t('auth.title')}</h1>
                <p className="mt-1 text-sm text-fg-muted">{t('login.subtitle')}</p>
              </div>

              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <Field label={t('auth.login')} htmlFor="username">
                  <Input
                    id="username"
                    type="text"
                    placeholder={t('login.usernamePlaceholder')}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    autoFocus
                    autoComplete="username"
                  />
                </Field>

                <Field label={t('auth.password')} htmlFor="password">
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                  />
                </Field>

                {error && <Alert tone="danger">{error}</Alert>}

                <Button type="submit" block loading={loading} className="mt-2">
                  {loading ? t('auth.signingIn') : t('auth.signIn')}
                </Button>
              </form>
            </Card>
          </div>
        </div>
      </main>
    </div>
  )
}
