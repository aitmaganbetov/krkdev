import { Suspense } from 'react'
import { Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LoadingBlock, NavTabs, PageHeader, PageStack } from '../components/ui'

// Раздел «Пользователи»: учётные записи КРК, преподаватели и студенты из Platonus
export default function UsersSectionPage() {
  const { t } = useTranslation()
  return (
    <PageStack>
      <PageHeader title={t('users.title')} description={t('usersSection.description')} />
      <NavTabs
        ariaLabel={t('usersSection.tabs.label')}
        items={[
          { to: '/users/accounts', label: t('usersSection.tabs.accounts'), icon: 'lock' },
          { to: '/users/tutors', label: t('usersSection.tabs.tutors'), icon: 'user-check' },
          { to: '/users/students', label: t('usersSection.tabs.students'), icon: 'users' },
        ]}
      />
      <Suspense fallback={<LoadingBlock label={t('ui.loading')} />}>
        <Outlet />
      </Suspense>
    </PageStack>
  )
}
