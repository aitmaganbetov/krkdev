import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  createRatingTemplate,
  deleteRatingTemplate,
  getAcademicYears,
  updateRatingTemplate,
} from '../services/api'
import {
  Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, FormSection, Input,
  LoadingBlock, SegmentedControl, Select, Textarea, cn, useUI,
} from '../components/ui'
import {
  CALC_METHOD_LABELS,
  LESSON_TYPES,
  invalidateRatingTemplates,
  loadRatingTemplates,
} from '../utils/ratingTemplate'

// Языки формулировок (ключи данных в шаблоне: ru / kk / en)
const LANGS = ['ru', 'kk', 'en']

// Исходный набор вопросов на бэкенде (создаётся, если copy_from пустой)
const BASE_SET_YEAR = '2025-2026'

// Подписи видов занятия: значение в данных остаётся русским, на экран — перевод
const LESSON_TYPE_KEYS = {
  'Лекция': 'lecture',
  'Практика': 'practice',
  'Семинар': 'seminar',
  'Лабораторная': 'lab',
  'Физическая культура': 'pe',
  'Творческое': 'creative',
}

const CONTENT_FIELDS = ['scale_min', 'scale_max', 'calc_method', 'problem_score_below', 'problem_attendance_below', 'note', 'sections']

function toDraft(template) {
  const draft = JSON.parse(JSON.stringify(Object.fromEntries(CONTENT_FIELDS.map((field) => [field, template[field]]))))
  draft.note = { ru: '', kk: '', en: '', ...(draft.note || {}) }
  draft.sections = draft.sections.map((section) => ({
    lesson_types: [],
    ...section,
    questions: section.questions.map((question) => ({
      ...question,
      hint: { ru: '', kk: '', en: '', ...(question.hint || {}) },
    })),
  }))
  return draft
}

// Коды вопросов в незаблокированном году идут от кода раздела: A → A1, A2…; 1 → 1.1, 1.2…
function questionCode(sectionCode, index) {
  const code = String(sectionCode || '').trim()
  return /\d$/.test(code) ? `${code}.${index + 1}` : `${code}${index + 1}`
}

function renumber(sections) {
  return sections.map((section) => {
    const code = String(section.code || '').trim()
    return {
      ...section,
      code,
      questions: section.questions.map((question, qi) => ({ ...question, code: questionCode(code, qi) })),
    }
  })
}

function nextSectionCode(sections) {
  const codes = sections.map((section) => String(section.code || '').trim())
  if (codes.length && codes.every((code) => /^\d+$/.test(code))) return String(Math.max(...codes.map(Number)) + 1)
  const letters = codes.filter((code) => /^[A-Z]$/.test(code)).map((code) => code.charCodeAt(0))
  return letters.length ? String.fromCharCode(Math.min(Math.max(...letters) + 1, 90)) : String(sections.length + 1)
}

function errorText(err, fallback) {
  const detail = err.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail.map((item) => String(item.msg || '').replace(/^Value error, /, '')).filter(Boolean).join('; ') || fallback
  }
  return fallback
}

function emptyQuestion() {
  return { code: '', text: { ru: '', kk: '', en: '' }, hint: { ru: '', kk: '', en: '' }, report_title: '', weight: 1 }
}

function emptySection(code) {
  return { code, title: { ru: '', kk: '', en: '' }, weight: 1, lesson_types: [], questions: [emptyQuestion()] }
}

// Чип-переключатель вида занятия: зона нажатия не меньше 32px, переносится вместе с соседями
function ToggleChip({ active, disabled, onClick, children }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full border px-3 py-1 text-left text-sm font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
        'disabled:cursor-not-allowed disabled:opacity-50',
        active
          ? 'border-primary bg-primary text-primary-on'
          : 'border-line-strong bg-surface text-fg-muted hover:bg-surface-hover hover:text-fg',
      )}
    >
      <span className="min-w-0">{children}</span>
    </button>
  )
}

// Подпись поля с пометкой текущего языка формулировок
function LangLabel({ children, lang }) {
  return (
    <>
      {children} <span className="font-normal text-fg-subtle">· {lang}</span>
    </>
  )
}

export default function RatingTemplatesPage() {
  const { t } = useTranslation()
  const { toast, confirm } = useUI()
  const [templates, setTemplates] = useState([])
  const location = useLocation()
  const [catalogYears, setCatalogYears] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedYear, setSelectedYear] = useState('')
  const [draft, setDraft] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [lang, setLang] = useState('ru')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [copyFrom, setCopyFrom] = useState('')

  const load = async (preferredYear) => {
    setLoading(true)
    try {
      const [items, academicYears] = await Promise.all([
        loadRatingTemplates({ force: true }),
        getAcademicYears().catch(() => []),
      ])
      setTemplates(items)
      setCatalogYears(academicYears.map((item) => item.name))
      // Переход из вкладки «Учебный год» открывает выбранный там год
      setSelectedYear((current) => preferredYear || current || location.state?.year || items[0]?.academic_year || '')
      setError('')
    } catch (err) {
      setError(errorText(err, t('templates.loadError')))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const template = useMemo(
    () => templates.find((item) => item.academic_year === selectedYear) || null,
    [templates, selectedYear],
  )

  useEffect(() => {
    setDraft(template ? toDraft(template) : null)
    setDirty(false)
  }, [template])

  const years = useMemo(() => {
    const all = new Set([...templates.map((item) => item.academic_year), ...catalogYears])
    return Array.from(all).sort().reverse()
  }, [templates, catalogYears])

  useEffect(() => {
    setCopyFrom(templates[0]?.academic_year || '')
  }, [templates])

  const locked = Boolean(template?.locked)
  const langLabel = t(`templates.content.langs.${lang}`)

  const selectYear = async (year) => {
    if (dirty) {
      const ok = await confirm({
        title: t('templates.unsavedTitle'),
        message: t('templates.unsavedConfirm'),
        confirmLabel: t('templates.leave'),
        tone: 'danger',
      })
      if (!ok) return
    }
    setError('')
    setSelectedYear(year)
  }

  const change = (updater) => {
    setDraft((current) => {
      const next = updater(JSON.parse(JSON.stringify(current)))
      return locked ? next : { ...next, sections: renumber(next.sections) }
    })
    setDirty(true)
  }

  const setField = (field, value) => change((d) => ({ ...d, [field]: value }))
  const setSection = (si, patch) => change((d) => {
    d.sections[si] = { ...d.sections[si], ...patch }
    return d
  })
  const setQuestion = (si, qi, patch) => change((d) => {
    d.sections[si].questions[qi] = { ...d.sections[si].questions[qi], ...patch }
    return d
  })
  const move = (list, index, delta) => {
    const target = index + delta
    if (target < 0 || target >= list.length) return list
    const copy = [...list]
    ;[copy[index], copy[target]] = [copy[target], copy[index]]
    return copy
  }

  const removeSection = async (si) => {
    const ok = await confirm({
      title: t('templates.section.removeTitle'),
      message: t('templates.section.removeConfirm'),
      confirmLabel: t('ui.delete'),
      tone: 'danger',
    })
    if (ok) change((d) => ({ ...d, sections: d.sections.filter((_, i) => i !== si) }))
  }

  const handleSave = async () => {
    if (!draft || !template) return
    setSaving(true)
    setError('')
    try {
      const payload = { ...draft, sections: locked ? draft.sections : renumber(draft.sections) }
      const saved = await updateRatingTemplate(template.academic_year, payload)
      invalidateRatingTemplates()
      setTemplates((items) => items.map((item) => (item.academic_year === saved.academic_year ? saved : item)))
      toast.success(t('templates.saved', { year: saved.academic_year }))
    } catch (err) {
      const message = errorText(err, t('templates.saveError'))
      setError(message)
      // Кнопка «Сохранить» внизу страницы — ошибку дублируем уведомлением, чтобы её было видно
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  const handleCreate = async (year, source) => {
    setSaving(true)
    setError('')
    try {
      const created = await createRatingTemplate({ academic_year: year.trim(), copy_from: source || null })
      invalidateRatingTemplates()
      await load(created.academic_year)
      toast.success(source
        ? t('templates.createdCopy', { year: created.academic_year, source })
        : t('templates.created', { year: created.academic_year }))
    } catch (err) {
      setError(errorText(err, t('templates.createError')))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!template || locked) return
    const ok = await confirm({
      title: t('templates.deleteTitle'),
      message: t('templates.deleteConfirm', { year: template.academic_year }),
      confirmLabel: t('ui.delete'),
      tone: 'danger',
    })
    if (!ok) return
    setSaving(true)
    setError('')
    try {
      await deleteRatingTemplate(template.academic_year)
      invalidateRatingTemplates()
      await load(template.academic_year)
      toast.success(t('templates.deleted', { year: template.academic_year }))
    } catch (err) {
      const message = errorText(err, t('templates.deleteError'))
      setError(message)
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  // В анкету попадают общие разделы и один модуль по виду занятия
  const commonCount = draft ? draft.sections.filter((s) => !s.lesson_types?.length).reduce((sum, s) => sum + s.questions.length, 0) : 0
  const moduleCount = draft ? Math.max(0, ...draft.sections.filter((s) => s.lesson_types?.length).map((s) => s.questions.length)) : 0
  const questionCount = commonCount + moduleCount
  const maxScore = draft
    ? (draft.calc_method === 'sum' ? Number(draft.scale_max) * questionCount : Number(draft.scale_max))
    : 0

  const methodOptions = Object.keys(CALC_METHOD_LABELS).map((value) => ({ value, label: t(`templates.calc.methods.${value}`) }))
  const lessonTypeLabel = (type) => (LESSON_TYPE_KEYS[type] ? t(`templates.lessonTypes.${LESSON_TYPE_KEYS[type]}`) : type)

  // Список учебных годов (слева на широком экране, сверху на узком)
  const yearList = (
    <aside className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-20 lg:self-start">
      <h2 className="text-base font-semibold text-fg">{t('templates.years.title')}</h2>
      {years.length ? (
        <ul className="grid min-w-0 grid-cols-1 gap-2 p-0.5 sm:grid-cols-2 lg:max-h-[calc(100vh-14rem)] lg:grid-cols-1 lg:overflow-y-auto">
          {years.map((year) => {
            const item = templates.find((tpl) => tpl.academic_year === year)
            const active = year === selectedYear
            return (
              <li key={year} className="min-w-0">
                <button
                  type="button"
                  aria-current={active ? 'true' : undefined}
                  onClick={() => selectYear(year)}
                  className={cn(
                    'flex min-h-14 w-full min-w-0 items-start justify-between gap-3 rounded-lg border px-4 py-3 text-left transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                    active ? 'border-primary bg-primary-subtle' : 'border-line bg-surface hover:bg-surface-hover',
                  )}
                >
                  <span className="min-w-0">
                    <span className={cn('block text-sm font-semibold tabular', active ? 'text-primary-subtle-fg' : 'text-fg')}>{year}</span>
                    <span className="mt-0.5 block text-xs text-fg-muted">
                      {item
                        ? t('templates.years.meta', { questions: item.question_count, records: item.records_count })
                        : t('templates.years.notConfigured')}
                    </span>
                  </span>
                  {item?.locked && (
                    <Badge tone="neutral" icon="lock" title={t('templates.years.lockedHint')} className="shrink-0">
                      {t('templates.years.locked')}
                    </Badge>
                  )}
                  {!item && <Badge tone="warning" className="shrink-0">{t('templates.years.missing')}</Badge>}
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <Card>
          <EmptyState icon="calendar" title={t('templates.years.empty')} compact />
        </Card>
      )}
      <div className="flex min-w-0 flex-col items-start gap-1">
        <p className="text-xs text-fg-subtle">{t('templates.years.addHint')}</p>
        <Button as={Link} to="/catalogs/academic-years" variant="link" size="sm" iconRight="chevron-right">
          {t('templates.years.addLink')}
        </Button>
      </div>
    </aside>
  )

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <p className="max-w-3xl text-sm text-fg-muted">{t('templates.intro')}</p>

      {error && <Alert tone="danger" closeLabel={t('ui.close')} onClose={() => setError('')}>{error}</Alert>}

      {loading ? (
        <Card><LoadingBlock label={t('templates.loading')} /></Card>
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[17.5rem_minmax(0,1fr)]">
          {yearList}

          {/* Редактор */}
          <div className="flex min-w-0 flex-col gap-6">
            {!selectedYear && (
              <Card>
                <EmptyState icon="calendar" title={t('templates.select.title')} description={t('templates.select.hint')} />
              </Card>
            )}

            {selectedYear && !template && (
              <Card>
                <CardHeader
                  title={t('templates.missing.title', { year: selectedYear })}
                  description={t('templates.missing.text', { year: selectedYear })}
                />
                <CardBody>
                  <div className="flex min-w-0 flex-wrap items-end gap-3">
                    <Field label={t('templates.missing.copyFrom')} className="min-w-0 flex-1 basis-60 sm:max-w-sm">
                      <Select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
                        {templates.map((item) => <option key={item.academic_year} value={item.academic_year}>{item.academic_year}</option>)}
                        {!templates.some((item) => item.academic_year === BASE_SET_YEAR) && (
                          <option value="">{t('templates.missing.baseSet', { year: BASE_SET_YEAR })}</option>
                        )}
                      </Select>
                    </Field>
                    <Button icon="plus" loading={saving} onClick={() => handleCreate(selectedYear, copyFrom)}>
                      {t('templates.missing.create')}
                    </Button>
                  </div>
                </CardBody>
              </Card>
            )}

            {template && draft && (
              <>
                {locked && (
                  <Alert tone="warning" title={t('templates.locked.title')}>
                    {t('templates.locked.text', { year: template.academic_year, records: template.records_count })}
                  </Alert>
                )}

                {/* Расчёт балла */}
                <Card>
                  <CardHeader
                    title={t('templates.calc.title', { year: template.academic_year })}
                    description={moduleCount
                      ? t('templates.calc.summaryModules', { n: questionCount, common: commonCount, module: moduleCount, max: maxScore })
                      : t('templates.calc.summary', { n: questionCount, max: maxScore })}
                  />
                  <CardBody className="flex flex-col gap-6">
                    <FormSection title={t('templates.calc.scale')}>
                      <Field label={t('templates.calc.scaleMin')}>
                        <Input type="number" inputMode="numeric" disabled={locked} value={draft.scale_min}
                          onChange={(e) => setField('scale_min', Number(e.target.value))} />
                      </Field>
                      <Field label={t('templates.calc.scaleMax')}>
                        <Input type="number" inputMode="numeric" disabled={locked} value={draft.scale_max}
                          onChange={(e) => setField('scale_max', Number(e.target.value))} />
                      </Field>
                      <Field label={t('templates.calc.method')} hint={t(`templates.calc.methodHints.${draft.calc_method}`, { defaultValue: '' })}
                        className="sm:col-span-2">
                        <Select disabled={locked} value={draft.calc_method} options={methodOptions}
                          onChange={(e) => setField('calc_method', e.target.value)} />
                      </Field>
                    </FormSection>
                    <FormSection title={t('templates.calc.thresholds')}>
                      <Field label={t('templates.calc.problemScore')}>
                        <Input type="number" step="0.1" inputMode="decimal" disabled={locked} value={draft.problem_score_below}
                          onChange={(e) => setField('problem_score_below', Number(e.target.value))} />
                      </Field>
                      <Field label={t('templates.calc.problemAttendance')}>
                        <Input type="number" step="1" inputMode="numeric" disabled={locked} value={draft.problem_attendance_below}
                          onChange={(e) => setField('problem_attendance_below', Number(e.target.value))} />
                      </Field>
                    </FormSection>
                  </CardBody>
                </Card>

                {/* Язык формулировок и пояснение к шкале */}
                <Card>
                  <CardHeader title={t('templates.content.title')} description={t('templates.content.description')} />
                  <CardBody className="flex flex-col gap-4">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                      <span className="text-sm font-medium text-fg">{t('templates.content.language')}</span>
                      <SegmentedControl
                        ariaLabel={t('templates.content.language')}
                        value={lang}
                        onChange={setLang}
                        options={LANGS.map((id) => ({
                          value: id,
                          label: t(`templates.content.langs.${id}`),
                          title: t(`templates.content.langNames.${id}`),
                        }))}
                      />
                      {lang !== 'ru' && <span className="text-xs text-fg-subtle">{t('templates.content.fallbackHint')}</span>}
                    </div>
                    <Field label={<LangLabel lang={langLabel}>{t('templates.content.note')}</LangLabel>} hint={t('templates.content.noteHint')}>
                      <Textarea rows={2} value={draft.note[lang] || ''}
                        onChange={(e) => change((d) => ({ ...d, note: { ...d.note, [lang]: e.target.value } }))} />
                    </Field>
                  </CardBody>
                </Card>

                {/* Разделы и вопросы */}
                {draft.sections.map((section, si) => (
                  <Card key={si}>
                    <div className="flex min-w-0 flex-col gap-4 border-b border-line px-4 py-4 sm:px-5">
                      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
                        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                          <h3 className="text-base font-semibold text-fg">{t('templates.section.heading', { n: si + 1 })}</h3>
                          <span className="text-sm text-fg-muted">{t('templates.section.questions', { n: section.questions.length })}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1">
                          <Button variant="ghost" size="sm" iconOnly icon="arrow-up" aria-label={t('templates.section.moveUp')}
                            disabled={locked || si === 0}
                            onClick={() => change((d) => ({ ...d, sections: move(d.sections, si, -1) }))} />
                          <Button variant="ghost" size="sm" iconOnly icon="arrow-down" aria-label={t('templates.section.moveDown')}
                            disabled={locked || si === draft.sections.length - 1}
                            onClick={() => change((d) => ({ ...d, sections: move(d.sections, si, 1) }))} />
                          <Button variant="danger-ghost" size="sm" iconOnly icon="trash" aria-label={t('templates.section.remove')}
                            disabled={locked || draft.sections.length === 1}
                            onClick={() => removeSection(si)} />
                        </div>
                      </div>

                      <div className={cn(
                        'grid min-w-0 grid-cols-[5rem_minmax(0,1fr)] items-start gap-3',
                        draft.calc_method === 'sections' && 'sm:grid-cols-[5rem_minmax(0,1fr)_8rem]',
                      )}>
                        <Field label={t('templates.section.code')}>
                          <Input className="text-center font-medium tabular" title={t('templates.section.codeHint')} maxLength={20}
                            disabled={locked} value={section.code}
                            onChange={(e) => setSection(si, { code: e.target.value.replace(/\s/g, '') })} />
                        </Field>
                        <Field label={<LangLabel lang={langLabel}>{t('templates.section.title')}</LangLabel>}>
                          <Textarea rows={1} className="font-semibold"
                            placeholder={lang === 'ru' ? t('templates.section.title') : (section.title.ru || t('templates.section.title'))}
                            value={section.title[lang] || ''}
                            onChange={(e) => setSection(si, { title: { ...section.title, [lang]: e.target.value } })} />
                        </Field>
                        {draft.calc_method === 'sections' && (
                          <Field label={t('templates.section.weight')} className="col-span-2 sm:col-span-1">
                            <Input type="number" step="0.1" min="0.1" inputMode="decimal" disabled={locked}
                              value={section.weight} onChange={(e) => setSection(si, { weight: Number(e.target.value) })} />
                          </Field>
                        )}
                      </div>

                      <div className="flex min-w-0 flex-col gap-2">
                        <span id={`section-applies-${si}`} className="text-sm font-medium text-fg">{t('templates.section.appliesTo')}</span>
                        <div role="group" aria-labelledby={`section-applies-${si}`} className="flex min-w-0 flex-wrap gap-2">
                          <ToggleChip active={!section.lesson_types.length} disabled={locked}
                            onClick={() => setSection(si, { lesson_types: [] })}>
                            {t('templates.section.allLessons')}
                          </ToggleChip>
                          {LESSON_TYPES.map((type) => {
                            const active = section.lesson_types.includes(type)
                            return (
                              <ToggleChip key={type} active={active} disabled={locked}
                                onClick={() => setSection(si, {
                                  lesson_types: active ? section.lesson_types.filter((x) => x !== type) : [...section.lesson_types, type],
                                })}>
                                {lessonTypeLabel(type)}
                              </ToggleChip>
                            )
                          })}
                        </div>
                      </div>
                    </div>

                    <CardBody className="flex flex-col gap-4">
                      <ol aria-label={t('templates.question.list')} className="flex min-w-0 flex-col divide-y divide-line">
                        {section.questions.map((question, qi) => (
                          <li key={qi} className="flex min-w-0 flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:gap-4">
                            {/* На узком экране номер и действия — одной строкой над полями, на широком — колонками по бокам */}
                            <div className="flex min-w-0 items-center justify-between gap-2 sm:contents">
                              <span className="inline-flex min-h-8 min-w-12 items-center justify-center rounded-md bg-surface-muted px-2 text-sm font-semibold tabular text-fg-muted sm:order-1 sm:mt-1">
                                {question.code || questionCode(section.code, qi)}
                              </span>
                              <div className="flex items-center gap-1 sm:order-3 sm:flex-col">
                                <Button variant="ghost" size="sm" iconOnly icon="arrow-up" aria-label={t('templates.question.moveUp')}
                                  disabled={locked || qi === 0}
                                  onClick={() => change((d) => { d.sections[si].questions = move(d.sections[si].questions, qi, -1); return d })} />
                                <Button variant="ghost" size="sm" iconOnly icon="arrow-down" aria-label={t('templates.question.moveDown')}
                                  disabled={locked || qi === section.questions.length - 1}
                                  onClick={() => change((d) => { d.sections[si].questions = move(d.sections[si].questions, qi, 1); return d })} />
                                <Button variant="danger-ghost" size="sm" iconOnly icon="trash" aria-label={t('templates.question.remove')}
                                  disabled={locked || section.questions.length === 1}
                                  onClick={() => change((d) => { d.sections[si].questions = d.sections[si].questions.filter((_, i) => i !== qi); return d })} />
                              </div>
                            </div>

                            <div className="flex min-w-0 flex-1 flex-col gap-3 sm:order-2">
                              <Textarea rows={2} aria-label={t('templates.question.text')}
                                placeholder={lang === 'ru' ? t('templates.question.text') : (question.text.ru || t('templates.question.text'))}
                                value={question.text[lang] || ''}
                                onChange={(e) => setQuestion(si, qi, { text: { ...question.text, [lang]: e.target.value } })} />
                              <Field label={<LangLabel lang={langLabel}>{t('templates.question.hint')}</LangLabel>}>
                                <Textarea rows={1}
                                  placeholder={lang === 'ru'
                                    ? t('templates.question.hintPlaceholder')
                                    : (question.hint?.ru || t('templates.question.hintPlaceholderShort'))}
                                  value={question.hint?.[lang] || ''}
                                  onChange={(e) => setQuestion(si, qi, { hint: { ...(question.hint || {}), [lang]: e.target.value } })} />
                              </Field>
                              {(lang === 'ru' || draft.calc_method === 'weighted') && (
                                <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
                                  {lang === 'ru' && (
                                    <Field label={t('templates.question.reportTitle')} className={draft.calc_method !== 'weighted' ? 'sm:col-span-2' : undefined}>
                                      <Input placeholder={t('templates.question.reportTitlePlaceholder')}
                                        value={question.report_title || ''}
                                        onChange={(e) => setQuestion(si, qi, { report_title: e.target.value })} />
                                    </Field>
                                  )}
                                  {draft.calc_method === 'weighted' && (
                                    <Field label={t('templates.question.weight')} className={lang !== 'ru' ? 'sm:col-start-2' : undefined}>
                                      <Input type="number" step="0.1" min="0.1" inputMode="decimal" disabled={locked}
                                        value={question.weight} onChange={(e) => setQuestion(si, qi, { weight: Number(e.target.value) })} />
                                    </Field>
                                  )}
                                </div>
                              )}
                            </div>
                          </li>
                        ))}
                      </ol>
                      {!locked && (
                        <div className="flex flex-wrap gap-2">
                          <Button variant="secondary" size="sm" icon="plus"
                            onClick={() => change((d) => { d.sections[si].questions.push(emptyQuestion()); return d })}>
                            {t('templates.question.add')}
                          </Button>
                        </div>
                      )}
                    </CardBody>
                  </Card>
                ))}

                {!locked && (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" icon="plus"
                      onClick={() => change((d) => ({ ...d, sections: [...d.sections, emptySection(nextSectionCode(d.sections))] }))}>
                      {t('templates.section.add')}
                    </Button>
                  </div>
                )}

                {/* Панель сохранения: всегда видна внизу экрана */}
                <div role="region" aria-label={t('templates.bar.label')}
                  className="sticky bottom-0 z-sticky flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-3 shadow-3 sm:px-5"
                  style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' }}>
                  <div className="min-w-0" aria-live="polite">
                    {dirty
                      ? <Badge tone="warning" dot>{t('templates.bar.dirty')}</Badge>
                      : <span className="text-sm text-fg-muted">
                          {template.updated_by ? t('templates.bar.updatedBy', { user: template.updated_by }) : t('templates.bar.clean')}
                        </span>}
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    {!locked && (
                      <Button variant="danger-ghost" icon="trash" disabled={saving} onClick={handleDelete}>{t('ui.delete')}</Button>
                    )}
                    <Button variant="secondary" disabled={saving || !dirty}
                      onClick={() => { setDraft(toDraft(template)); setDirty(false) }}>
                      {t('templates.bar.cancel')}
                    </Button>
                    <Button icon="check" loading={saving} disabled={!dirty} onClick={handleSave}>{t('ui.save')}</Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
