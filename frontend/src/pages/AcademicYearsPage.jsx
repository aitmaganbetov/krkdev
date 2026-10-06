import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { createAcademicYear, deleteAcademicYear, getAcademicYears, setDefaultAcademicYear } from '../services/api'
import {
  Alert, Badge, Button, Card, CardHeader, DataTable, EmptyState, Field, Input, useUI,
} from '../components/ui'

function errorText(err, fallback) {
  const detail = err.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail.map((item) => String(item.msg || '').replace(/^Value error, /, '')).filter(Boolean).join('; ') || fallback
  }
  return fallback
}

function nextYearAfter(items) {
  const starts = items.map((item) => Number(String(item.name).slice(0, 4))).filter(Number.isFinite)
  const start = starts.length ? Math.max(...starts) + 1 : new Date().getFullYear()
  return `${start}-${start + 1}`
}

export default function AcademicYearsPage() {
  const { t } = useTranslation()
  const { toast, confirm } = useUI()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const data = await getAcademicYears()
      setItems(data)
      setName(nextYearAfter(data))
      setError('')
    } catch (err) {
      setError(errorText(err, t('years.loadError')))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleCreate = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const created = await createAcademicYear(name.trim())
      await load()
      toast.success(t('years.added', { name: created.name }))
    } catch (err) {
      setError(errorText(err, t('years.addError')))
    } finally {
      setSaving(false)
    }
  }

  const handleDefault = async (yearName) => {
    setSaving(true)
    setError('')
    try {
      const data = await setDefaultAcademicYear(yearName)
      setItems(data)
      const current = data.find((item) => item.is_default)
      toast.success(yearName
        ? t('years.defaultSet', { name: yearName })
        : current ? t('years.defaultAutoWith', { name: current.name }) : t('years.defaultAuto'))
    } catch (err) {
      setError(errorText(err, t('years.defaultError')))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (item) => {
    const ok = await confirm({
      title: t('years.deleteConfirmTitle'),
      message: t('years.deleteConfirm', { name: item.name }),
      confirmLabel: t('ui.delete'),
      tone: 'danger',
    })
    if (!ok) return
    setSaving(true)
    setError('')
    try {
      await deleteAcademicYear(item.name)
      await load()
      toast.success(t('years.deleted', { name: item.name }))
    } catch (err) {
      setError(errorText(err, t('years.deleteError')))
    } finally {
      setSaving(false)
    }
  }

  const manualDefault = items.some((item) => item.default_is_manual)

  const columns = [
    {
      key: 'name',
      header: t('years.colYear'),
      mobile: 'title',
      nowrap: true,
      cell: (item) => <span className="font-semibold tabular">{item.name}</span>,
    },
    {
      key: 'questions',
      header: t('years.colQuestions'),
      cell: (item) => (
        <Link to="/catalogs/questions" state={{ year: item.name }}
          className="inline-flex min-h-8 max-w-full items-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
          {item.has_template
            ? <span className="min-w-0 text-sm text-accent hover:underline [overflow-wrap:anywhere]">{t('years.questionsReady')}</span>
            : <Badge tone="warning" className="hover:underline">{t('years.questionsMissing')}</Badge>}
        </Link>
      ),
    },
    { key: 'records_count', header: t('years.colRecords'), align: 'right', cell: (item) => <span className="tabular">{item.records_count}</span> },
    {
      key: 'default',
      header: t('years.colDefault'),
      cell: (item) => (item.is_default ? (
        <Badge tone="primary" dot title={item.default_is_manual ? t('years.isDefaultManualHint') : t('years.isDefaultAutoHint')}>
          {item.default_is_manual ? t('years.isDefault') : t('years.isDefaultAuto')}
        </Badge>
      ) : (
        <Button variant="link" size="sm" disabled={saving} onClick={() => handleDefault(item.name)}>
          {t('years.makeDefault')}
        </Button>
      )),
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t('ui.actions')}</span>,
      mobileLabel: '',
      align: 'right',
      cell: (item) => {
        const canDelete = !item.records_count && !item.has_template
        return (
          <Button variant="danger-ghost" size="sm" icon="trash" disabled={saving || !canDelete}
            title={canDelete ? t('ui.delete') : t('years.cannotDelete')} onClick={() => handleDelete(item)}>
            {t('ui.delete')}
          </Button>
        )
      },
    },
  ]

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {error && <Alert tone="danger" onClose={() => setError('')}>{error}</Alert>}

      <Card>
        <CardHeader title={t('years.addTitle')} description={t('years.addHint')} />
        <form onSubmit={handleCreate} className="flex min-w-0 flex-wrap items-end gap-3 p-4 sm:p-5">
          <Field label={t('years.addLabel')} className="w-full sm:w-64">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="2027-2028" inputMode="numeric" />
          </Field>
          <Button type="submit" icon="plus" loading={saving} disabled={!name.trim()}>{t('years.add')}</Button>
        </form>
      </Card>

      <Card>
        <CardHeader
          title={t('years.listTitle')}
          description={t('years.defaultHint')}
          actions={manualDefault && (
            <Button variant="secondary" size="sm" icon="rotate-ccw" disabled={saving} onClick={() => handleDefault(null)}>
              {t('years.resetDefault')}
            </Button>
          )}
        />
        <DataTable
          columns={columns}
          rows={items}
          rowKey="name"
          loading={loading}
          skeletonRows={3}
          caption={t('years.listTitle')}
          empty={<EmptyState icon="calendar" title={t('years.empty')} compact />}
        />
      </Card>
    </div>
  )
}
