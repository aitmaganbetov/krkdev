import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { apiErrorText, getStudentCard, getTutorCard, updateStudentCard, updateTutorCard } from '../services/api'
import {
  Alert, Badge, Button, Card, CardBody, CardHeader, DescriptionList, EmptyState, Field, FormSection, Input,
  LoadingBlock, Modal, Tooltip, useUI,
} from '../components/ui'
import { formatDateTimeUtcPlus5, formatDateUtcPlus5 } from '../utils/datetime'

// Карточка преподавателя или студента (вкладки раздела «Пользователи»): данные Platonus и правки КРК поверх них.
// Логин, кафедра и группа не редактируются — на них завязаны учётная запись, вход по ЭЦП и фильтры.
const KINDS = {
  tutors: { load: getTutorCard, save: updateTutorCard, sections: ['names', 'work', 'contacts'] },
  students: { load: getStudentCard, save: updateStudentCard, sections: ['names', 'study', 'contacts'] },
}
const EDIT_FORM_ID = 'person-card-form'
const INPUT_TYPES = { date: 'date', email: 'email' }

// Значение из справочника Platonus приходит на трёх языках, правка КРК и остальные поля — строкой или числом
const localized = (value, lang) => (value && typeof value === 'object' ? value[lang] || value.ru : value)
const asText = (value, lang) => {
  const text = localized(value, lang)
  return text === null || text === undefined ? '' : String(text)
}

export default function PersonCardPage({ kind }) {
  const config = KINDS[kind]
  const { id } = useParams()
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const { toast } = useUI()
  const [card, setCard] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    config.load(id)
      .then((data) => { if (active) setCard(data) })
      .catch((err) => { if (active) setError(apiErrorText(err, t('usersSection.card.loadError'))) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [kind, id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <LoadingBlock label={t('ui.loading')} />
  if (error || !card) {
    return (
      <EmptyState
        icon="alert-circle"
        title={error || t('usersSection.card.loadError')}
        action={<Button as={Link} to={`/users/${kind}`} variant="secondary" size="sm" icon="arrow-left">{t('usersSection.card.back')}</Button>}
      />
    )
  }

  const fields = Object.fromEntries(card.fields.map((field) => [field.key, field]))
  const label = (key) => t(`usersSection.fields.${key}`)
  const display = (field) => {
    const text = asText(field.value, lang)
    if (!text) return '—'
    return field.type === 'date' ? formatDateUtcPlus5(text) : text
  }
  // ФИО в заголовке — на языке интерфейса, если в Platonus оно есть
  const title = asText(fields[`full_name_${lang}`]?.value, lang) || asText(fields.full_name.value, lang) || '—'
  const name = (prefix) => card[`${prefix}_${lang}`] || card[`${prefix}_ru`] || '—'

  const fieldValue = (field) => (
    <span className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="min-w-0 break-words">{display(field)}</span>
      {field.overridden && (
        <Tooltip content={t('usersSection.card.overriddenHint', {
          user: field.updated_by,
          date: formatDateTimeUtcPlus5(field.updated_at),
          platonus: asText(field.platonus, lang) || '—',
        })}
        >
          {/* Tooltip передаёт ref дочернему элементу — Badge его не принимает */}
          <span tabIndex={0} className="inline-flex rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
            <Badge tone="warning">{t('usersSection.card.overridden')}</Badge>
          </span>
        </Tooltip>
      )}
    </span>
  )

  const account = card.account
  const mainItems = [
    ...(kind === 'tutors'
      ? [
          { label: t('platonusCatalog.columns.cafedra'), value: name('cafedra_name') },
          { label: t('platonusCatalog.columns.faculty'), value: name('faculty_name') },
        ]
      : [
          { label: t('platonusCatalog.columns.group'), value: card.group_name || '—' },
          {
            label: t('usersSection.columns.programme'),
            value: [card.specialization_code, card[`specialization_name_${lang}`] || card.specialization_name_ru].filter(Boolean).join(' — ') || '—',
          },
          { label: t('platonusCatalog.columns.faculty'), value: name('faculty_name') },
        ]),
    { label: t('usersSection.columns.login'), value: card.login || '—' },
    {
      label: t('usersSection.columns.ecp'),
      value: card.has_iin && card.login
        ? <Badge tone="success" icon="key">{t('usersSection.ecp.ready')}</Badge>
        : <Badge tone="neutral">{t(card.has_iin ? 'usersSection.ecp.noLogin' : 'usersSection.ecp.noIin')}</Badge>,
    },
    {
      label: t('usersSection.columns.account'),
      value: account ? (
        <span className="flex flex-wrap items-center gap-2">
          <Badge tone="primary">{t(`shell.roles.${account.role || 'user'}`)}</Badge>
          {account.blocked && <Badge tone="danger">{t('usersSection.blocked')}</Badge>}
          <span className="text-xs text-fg-muted tabular">
            {account.last_login_at ? t('usersSection.card.lastLogin', { date: formatDateTimeUtcPlus5(account.last_login_at) }) : ''}
          </span>
        </span>
      ) : <span className="text-fg-subtle">{t('usersSection.noAccount')}</span>,
    },
  ]

  const openEditor = () => {
    setForm(Object.fromEntries(card.fields.map((field) => [field.key, asText(field.value, lang)])))
    setSaveError('')
    setEditing(true)
  }

  const handleSave = async (event) => {
    event.preventDefault()
    // Уходят только изменённые поля; null — вернуть значение Platonus
    const changes = {}
    card.fields.forEach((field) => {
      const next = form[field.key]
      if (next === null) {
        if (field.overridden) changes[field.key] = null
      } else if (next !== asText(field.value, lang)) {
        changes[field.key] = next
      }
    })
    if (!Object.keys(changes).length) {
      setEditing(false)
      return
    }
    setSaving(true)
    setSaveError('')
    try {
      setCard(await config.save(card.id, changes))
      setEditing(false)
      toast.success(t('usersSection.card.saved'))
    } catch (err) {
      setSaveError(apiErrorText(err, t('usersSection.card.saveError')))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Button as={Link} to={`/users/${kind}`} variant="ghost" size="sm" icon="arrow-left" className="-ml-2 mb-1">
            {t('usersSection.card.back')}
          </Button>
          <h2 className="break-words text-xl font-semibold text-fg">{title}</h2>
          <p className="mt-1 text-sm text-fg-muted">
            {card.synced_at
              ? t('usersSection.card.synced', { date: formatDateTimeUtcPlus5(card.synced_at) })
              : t('usersSection.card.notSynced')}
          </p>
        </div>
        <Button icon="edit" onClick={openEditor}>{t('usersSection.card.edit')}</Button>
      </div>

      {!card.synced_at && <Alert tone="warning">{t('usersSection.card.notSyncedHint')}</Alert>}

      <Card>
        <CardHeader title={t('usersSection.card.sections.main')} description={t('usersSection.card.mainHint')} />
        <CardBody>
          <DescriptionList items={mainItems} />
        </CardBody>
      </Card>

      {config.sections.map((section) => (
        <Card key={section}>
          <CardHeader title={t(`usersSection.card.sections.${section}`)} />
          <CardBody>
            <DescriptionList
              items={card.fields
                .filter((field) => field.section === section)
                .map((field) => ({ label: label(field.key), value: fieldValue(field) }))}
            />
          </CardBody>
        </Card>
      ))}

      <Modal
        open={editing}
        onClose={() => !saving && setEditing(false)}
        size="lg"
        title={t('usersSection.card.editTitle')}
        description={t('usersSection.card.editHint')}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setEditing(false)} disabled={saving}>{t('usersSection.card.cancel')}</Button>
            <Button type="submit" form={EDIT_FORM_ID} icon="check" loading={saving}>{t('usersSection.card.save')}</Button>
          </>
        )}
      >
        <form id={EDIT_FORM_ID} onSubmit={handleSave} className="flex min-w-0 flex-col gap-6">
          {saveError && <Alert tone="danger" onClose={() => setSaveError('')} closeLabel={t('ui.close')}>{saveError}</Alert>}
          {config.sections.map((section) => (
            <FormSection key={section} title={t(`usersSection.card.sections.${section}`)}>
              {card.fields.filter((field) => field.section === section).map((field) => {
                const reset = form[field.key] === null
                return (
                  <Field
                    key={field.key}
                    label={label(field.key)}
                    hint={field.overridden
                      ? t('usersSection.card.platonusValue', { value: asText(field.platonus, lang) || '—' })
                      : undefined}
                  >
                    <div className="flex min-w-0 flex-col gap-1">
                      <Input
                        type={INPUT_TYPES[field.type] || 'text'}
                        inputMode={field.type === 'number' ? 'decimal' : undefined}
                        value={reset ? asText(field.platonus, lang) : form[field.key] ?? ''}
                        disabled={reset}
                        maxLength={500}
                        onChange={(e) => setForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
                      />
                      {field.overridden && (
                        <Button
                          variant="ghost"
                          size="sm"
                          icon="rotate-ccw"
                          className="self-start"
                          onClick={() => setForm((prev) => ({ ...prev, [field.key]: reset ? asText(field.value, lang) : null }))}
                        >
                          {reset ? t('usersSection.card.keepOverride') : t('usersSection.card.reset')}
                        </Button>
                      )}
                    </div>
                  </Field>
                )
              })}
            </FormSection>
          ))}
        </form>
      </Modal>
    </div>
  )
}
