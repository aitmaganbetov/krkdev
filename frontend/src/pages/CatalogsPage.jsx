import { Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { NavTabs, PageHeader, PageStack } from '../components/ui'

export default function CatalogsPage() {
  const { t } = useTranslation()
  return (
    <PageStack>
      <PageHeader title={t('catalogs.title')} description={t('catalogs.description')} />
      <NavTabs
        ariaLabel={t('catalogs.tabs.label')}
        items={[
          { to: '/catalogs/questions', label: t('catalogs.tabs.questions'), icon: 'file-text' },
          { to: '/catalogs/academic-years', label: t('catalogs.tabs.years'), icon: 'calendar' },
        ]}
      />
      <Outlet />
    </PageStack>
  )
}
