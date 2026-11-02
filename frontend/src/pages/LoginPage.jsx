import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { apiErrorText, getDevLoginOptions, getEcpChallenge, getEcpStatus } from '../services/api'
import { NcaLayerError, signText } from '../services/ncalayer'
import { useTheme } from '../context/ThemeContext'
import { Alert, Button, Card, Field, Input, SegmentedControl } from '../components/ui'
import { SapaLogo, SapaMark, SapaWordmark } from '../components/brand/SapaLogo'

export default function LoginPage() {
  const { login, ecpLogin, devLogin } = useAuth()
  const { dark, toggle } = useTheme()
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  // Куда вернуть после входа (Layout передаёт запрошенный адрес); только внутренние пути
  const from = useLocation().state?.from
  const returnTo = typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') ? from : null

  const changeLang = (lng) => {
    i18n.changeLanguage(lng)
    localStorage.setItem('lang', lng)
  }

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  // Быстрый вход под ролями: бэкенд отдаёт варианты только в dev, на проде — 404 и панели нет
  const [devOptions, setDevOptions] = useState([])
  const [devLoading, setDevLoading] = useState('')

  // Вход по ЭЦП: кнопка видна, только если на сервере подключён KalkanCrypt
  const [ecpEnabled, setEcpEnabled] = useState(false)
  const [ecpLoading, setEcpLoading] = useState(false)

  useEffect(() => {
    getDevLoginOptions()
      .then((data) => setDevOptions(Array.isArray(data?.options) ? data.options : []))
      .catch(() => setDevOptions([]))
    getEcpStatus()
      .then((data) => setEcpEnabled(Boolean(data?.enabled)))
      .catch(() => setEcpEnabled(false))
  }, [])

  const handleEcpLogin = async () => {
    setError('')
    setEcpLoading(true)
    try {
      const { nonce } = await getEcpChallenge()
      const cms = await signText(nonce, { locale: i18n.language })
      await ecpLogin(cms)
      navigate(returnTo || '/', { replace: true })
    } catch (err) {
      if (!(err instanceof NcaLayerError)) {
        setError(apiErrorText(err, t('login.ecp.errors.failed')))
      } else if (err.code !== 'cancelled') {
        setError(t(`login.ecp.errors.${err.code}`))
      }
    } finally {
      setEcpLoading(false)
    }
  }

  const devKey = (option) => `${option.role}:${option.faculty_id ?? ''}`
  // Служебные роли — по две в ряд; персонажи и деканаты — во всю ширину. Нечётная последняя служебная — тоже
  const singles = devOptions.filter((option) => !option.faculty_id && !option.person_name)
  const lastSingle = singles.length % 2 ? singles[singles.length - 1] : null
  const handleDevLogin = async (option) => {
    setError('')
    setDevLoading(devKey(option))
    try {
      await devLogin(option.role, option.faculty_id)
      // Запрошенная страница или стартовая страница роли (HomeRedirect в App.jsx)
      navigate(returnTo || '/', { replace: true })
    } catch (err) {
      setError(apiErrorText(err, t('login.dev.error')))
    } finally {
      setDevLoading('')
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(username, password)
      navigate(returnTo || '/', { replace: true })
    } catch (err) {
      setError(apiErrorText(err, t('auth.loginError')))
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

                <Button type="submit" block loading={loading} disabled={ecpLoading} className="mt-2">
                  {loading ? t('auth.signingIn') : t('auth.signIn')}
                </Button>
              </form>

              {ecpEnabled && (
                <div className="mt-5 flex flex-col gap-2">
                  <div className="flex items-center gap-3 text-xs text-fg-subtle">
                    <span className="h-px flex-1 bg-line" aria-hidden="true" />
                    {t('login.ecp.or')}
                    <span className="h-px flex-1 bg-line" aria-hidden="true" />
                  </div>
                  <Button variant="secondary" block icon="key" loading={ecpLoading} disabled={loading} onClick={handleEcpLogin}>
                    {ecpLoading ? t('login.ecp.signing') : t('login.ecp.button')}
                  </Button>
                  <p className="text-center text-xs text-fg-subtle">{t('login.ecp.hint')}</p>
                </div>
              )}
            </Card>

            {devOptions.length > 0 && (
              <Card className="border-dashed p-4 sm:p-5">
                <p className="text-sm font-semibold text-fg">{t('login.dev.title')}</p>
                <p className="mt-0.5 text-xs text-fg-muted">{t('login.dev.hint')}</p>
                <div className="mt-3 grid min-w-0 grid-cols-2 gap-2">
                  {devOptions.map((option) => (
                    <Button
                      key={devKey(option)}
                      size="sm"
                      variant="secondary"
                      className={option.faculty_id || option.person_name || option === lastSingle ? 'col-span-2' : undefined}
                      loading={devLoading === devKey(option)}
                      disabled={Boolean(devLoading)}
                      onClick={() => handleDevLogin(option)}
                    >
                      {option.faculty_id
                        ? t('login.dev.dean', { faculty: option.faculty_name })
                        : option.person_name
                          // Вход как настоящий человек из Platonus с демо-данными (services/dev_seed.py)
                          ? t('login.dev.person', { role: t(`shell.roles.${option.role}`), name: option.person_name })
                          : t(`shell.roles.${option.role}`)}
                    </Button>
                  ))}
                </div>
              </Card>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
