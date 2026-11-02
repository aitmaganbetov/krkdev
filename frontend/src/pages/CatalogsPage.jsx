import { Suspense } from 'react'
import { Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LoadingBlock, NavTabs, PageHeader, PageStack } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { isAdmin } from '../utils/roles'

export default function CatalogsPage() {
  const { t } = useTranslation()
  // Инспектор КРК ведёт только вопросы и учебные годы; справочники Platonus — администратор
  const { role } = useAuth()
  const platonus = isAdmin(role)
  return (
    <PageStack>
      <PageHeader title={t('catalogs.title')} description={t('catalogs.description')} />
      <NavTabs
        ariaLabel={t('catalogs.tabs.label')}
        items={[
          { to: '/catalogs/questions', label: t('catalogs.tabs.questions'), icon: 'file-text' },
          { to: '/catalogs/academic-years', label: t('catalogs.tabs.years'), icon: 'calendar' },
          ...(platonus ? [
            { to: '/catalogs/faculties', label: t('catalogs.tabs.faculties'), icon: 'building' },
            { to: '/catalogs/cafedras', label: t('catalogs.tabs.cafedras'), icon: 'directory' },
            { to: '/catalogs/specializations', label: t('catalogs.tabs.specializations'), icon: 'book' },
            { to: '/catalogs/groups', label: t('catalogs.tabs.groups'), icon: 'users' },
          ] : []),
        ]}
      />
      <Suspense fallback={<LoadingBlock label={t('ui.loading')} />}>
        <Outlet />
      </Suspense>
    </PageStack>
  )
}
