import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getLdapUsers } from '../services/api'
import {
  Alert, Card, CardHeader, DataTable, EmptyState, Field, FilterBar, PageHeader, PageStack, Pagination,
  SearchInput, TruncatedText,
} from '../components/ui'

const PAGE_SIZE = 50

export default function LdapUsersPage() {
  const { t } = useTranslation()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)

  useEffect(() => {
    getLdapUsers()
      .then((data) => {
        setItems(data || [])
        setError('')
      })
      .catch(() => setError(t('ldap.loadError')))
      .finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((row) => {
      const username = (row.username || '').toLowerCase()
      const displayName = (row.display_name || '').toLowerCase()
      const dn = (row.dn || '').toLowerCase()
      return username.includes(q) || displayName.includes(q) || dn.includes(q)
    })
  }, [items, query])

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)

  const currentPage = Math.min(page, totalPages || 1)

  const paginated = useMemo(
    () => filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filtered, currentPage]
  )

  const handleQuery = (value) => {
    setQuery(value)
    setPage(1)
  }

  const columns = [
    {
      key: 'username',
      header: t('ldap.loginCol'),
      mobile: 'title',
      nowrap: true,
      cell: (row) => <span className="font-medium text-fg">{row.username || '—'}</span>,
    },
    {
      key: 'display_name',
      header: t('ldap.nameCol'),
      minWidth: '14rem',
      cell: (row) => row.display_name || '—',
    },
    {
      key: 'dn',
      header: t('ldap.dnCol'),
      // DN — вторичная информация: в таблице обрезается (полный текст в title) и не забирает
      // всю ширину; на мобильной карточке переносится целиком.
      cell: (row) => (row.dn ? (
        <TruncatedText className="text-fg-muted md:max-w-[22rem] max-md:whitespace-normal max-md:break-all">
          {row.dn}
        </TruncatedText>
      ) : <span className="text-fg-muted">—</span>),
    },
  ]

  return (
    <PageStack>
      <PageHeader title={t('ldap.title')} description={t('ldap.subtitle')} />

      {error && <Alert tone="danger" onClose={() => setError('')} closeLabel={t('ui.close')}>{error}</Alert>}

      <FilterBar>
        <Field label={t('ldap.searchLabel')}>
          <SearchInput
            placeholder={t('ldap.searchPlaceholder')}
            value={query}
            onChange={(e) => handleQuery(e.target.value)}
          />
        </Field>
      </FilterBar>

      {!(error && !loading && items.length === 0) && (
        <Card>
          <CardHeader
            title={t('ldapPage.listTitle')}
            description={loading ? null : t('ldap.total', { count: filtered.length })}
          />
          <DataTable
            columns={columns}
            rows={paginated}
            rowKey={(row) => `${row.username}-${row.dn}`}
            loading={loading}
            caption={t('ldap.title')}
            empty={(
              <EmptyState
                icon="directory"
                title={t('ldap.notFound')}
                description={query.trim() ? t('ui.nothingFoundHint') : t('ldap.checkSettings')}
                compact
              />
            )}
          />
          {totalPages > 1 && (
            <div className="border-t border-line px-4 py-3 sm:px-5">
              {/* page и Pagination оба считают страницы с 1 */}
              <Pagination
                page={currentPage}
                pageCount={totalPages}
                onPageChange={setPage}
                total={filtered.length}
                pageSize={PAGE_SIZE}
              />
            </div>
          )}
        </Card>
      )}
    </PageStack>
  )
}
