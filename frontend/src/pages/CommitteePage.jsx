import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  activateCommitteeOrder, addCommitteeMember, deactivateCommitteeOrder, apiErrorText, committeeOrderFileUrl, createCommitteeOrder,
  deleteCommitteeMember, deleteCommitteeOrder, getAcademicYears, getCommittee, getCommitteeOrder, getCommitteeTutors,
  recallCommitteeOrder, refreshCommitteeMembers, sendCommitteeOrder, updateCommitteeMember, updateCommitteeOrder, uploadCommitteeOrderFile,
} from '../services/api'
import { useAuth } from '../context/AuthContext'
import {
  Alert, Badge, Button, Card, CardBody, CardHeader, Checkbox, Combobox, DataTable, DescriptionList, EmptyState, Field,
  Input, LoadingBlock, Modal, PageHeader, PageStack, Select, StatCard, Textarea, useUI,
} from '../components/ui'
import { isAdmin, isSuperadmin } from '../utils/roles'
import { SIGNER_POSITIONS, findSignerOption, formatSignedAt, signerName, splitSigner, tutorOptions, verifyUrl } from '../utils/committee'

// Комитет ректорского контроля: на каждый учебный год — свой состав (routers/committee.py).
// Состав формируется как проект приказа и печатается на утверждение; после подписания вносятся номер и дата,
// и приказ делается действующим — члены его состава получают роль «Член комитета КРК».
const ORDER_FORM_ID = 'committee-order-form'
const MEMBER_FORM_ID = 'committee-member-form'
const ORDER_TEXT_FIELDS = ['number', 'title_kz', 'purpose_ru', 'purpose_kz', 'basis_ru', 'basis_kz']

// Дата приказа — без времени: «2026-10-22» → «22.10.2026»
export const formatOrderDate = (iso) => (iso ? iso.split('-').reverse().join('.') : '')
// Тексты приказа на казахском есть не всегда; английских нет
const localized = (item, field, lang) => (lang === 'kz' && item[`${field}_kz`]) || item[`${field}_ru`] || ''

// Тексты по умолчанию для нового состава — как в приказе № 151-26-НК
const DEFAULT_ORDER = {
  title_ru: 'О создании комитета Ректорского контроля',
  title_kz: 'Ректорлық бақылау комитетін құру туралы',
}
// Статус документа (committee_service.order_status): проект → на подписи → подписан ЭЦП; registered — подписан на бумаге
const STATUS_TONE = { draft: 'warning', on_signing: 'info', signed: 'success', registered: 'primary' }

const emptyOrder = { number: '', order_date: '', academic_year: '', title_ru: '', title_kz: '', purpose_ru: '', purpose_kz: '', basis_ru: '', basis_kz: '', signed_by: '' }

function OrderForm({ open, order, academicYear, years, copySource, tutors, rectorId, onClose, onSaved }) {
  const { t } = useTranslation()
  const [data, setData] = useState(emptyOrder)
  // Подписывает: должность из списка и сотрудник Platonus (по умолчанию — ректор из Platonus)
  const [signerPosition, setSignerPosition] = useState('')
  const [signerText, setSignerText] = useState('')
  const signerOptions = useMemo(() => tutorOptions(tutors), [tutors])
  const signerByLabel = useMemo(() => new Map(signerOptions.map((option) => [option.label, option])), [signerOptions])
  const [copyMembers, setCopyMembers] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setError('')
    setCopyMembers(true)
    if (order) {
      setData(Object.fromEntries(Object.keys(emptyOrder).map((key) => [key, order[key] || ''])))
    } else {
      // Вводная часть и основание — из прошлого состава: обычно меняются только год и номер документа
      const base = copySource ? Object.fromEntries(['title_ru', 'title_kz', 'purpose_ru', 'purpose_kz', 'basis_ru', 'basis_kz', 'signed_by'].map((key) => [key, copySource[key] || ''])) : {}
      setData({ ...emptyOrder, ...DEFAULT_ORDER, ...base, academic_year: academicYear || '' })
    }
    // Подписант приказа: из сохранённого текста («Ректор Л. Байболова»), у нового без образца — ректор
    const saved = splitSigner(order ? order.signed_by : copySource?.signed_by)
    const option = saved.name
      ? findSignerOption(signerOptions, saved.name)
      : (order ? null : signerOptions.find((item) => item.value === rectorId))
    setSignerPosition(saved.position || (order ? '' : SIGNER_POSITIONS[0].ru))
    setSignerText(option?.label || saved.name || '')
  }, [open, order, academicYear, copySource]) // eslint-disable-line react-hooks/exhaustive-deps

  const signer = signerByLabel.get(signerText.trim())?.tutor
  const signerMissing = Boolean(signerText.trim()) && !signer

  // Год приказа мог быть удалён из справочника — он остаётся в списке, чтобы не потеряться при правке
  const yearOptions = [...new Set([...years, ...(data.academic_year ? [data.academic_year] : [])])].map((year) => ({ value: year, label: year }))
  const update = (patch) => setData((d) => ({ ...d, ...patch }))
  // Должность из прежнего текста, которой нет в списке, остаётся выбранной
  const positionOptions = [...new Set([...SIGNER_POSITIONS.map((item) => item.ru), ...(signerPosition ? [signerPosition] : [])])]
    .map((value) => ({ value, label: value }))
  const submit = async (event) => {
    event.preventDefault()
    if (signerMissing) return
    setSaving(true)
    setError('')
    // Пустые необязательные тексты, номер и дата сохраняются как null
    const payload = {
      ...data,
      title_ru: data.title_ru.trim(),
      order_date: data.order_date || null,
      ...Object.fromEntries(ORDER_TEXT_FIELDS.map((key) => [key, data[key].trim() || null])),
      // Подпись в приказе («Ректор Л. Байболова») сервер собирает из должности и ФИО выбранного сотрудника
      signer_tutor_id: signer?.id ?? null,
      signer_position: signerPosition || null,
    }
    try {
      onSaved(order
        ? await updateCommitteeOrder(order.id, payload)
        : await createCommitteeOrder({ ...payload, copy_members_from: copyMembers && copySource ? copySource.id : null }))
    } catch (err) {
      setError(apiErrorText(err, t('committee.order.saveError')))
    } finally {
      setSaving(false)
    }
  }

  const textField = (key, label, { required = false, multiline = false, maxLength = 500 } = {}) => (
    <Field label={label} required={required}>
      {multiline
        ? <Textarea value={data[key]} rows={4} maxLength={4000} onChange={(e) => update({ [key]: e.target.value })} />
        : <Input value={data[key]} required={required} maxLength={maxLength} onChange={(e) => update({ [key]: e.target.value })} />}
    </Field>
  )

  return (
    <Modal
      open={open}
      onClose={saving ? undefined : onClose}
      size="lg"
      title={order ? t('committee.form.editTitle') : t('committee.form.createTitle', { year: data.academic_year })}
      description={t('committee.form.hint')}
      closeLabel={t('ui.close')}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>{t('committee.form.cancel')}</Button>
          <Button type="submit" form={ORDER_FORM_ID} icon="check" loading={saving}>{t('committee.form.save')}</Button>
        </>
      )}
    >
      <form id={ORDER_FORM_ID} onSubmit={submit} className="flex min-w-0 flex-col gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="grid min-w-0 gap-4 sm:grid-cols-3">
          <Field label={t('committee.form.academicYear')} required>
            <Select value={data.academic_year} required placeholder={t('committee.form.selectYear')} options={yearOptions}
              onChange={(e) => update({ academic_year: e.target.value })} />
          </Field>
          <Field label={t('committee.form.number')} hint={t('committee.form.afterSigning')}>
            <Input value={data.number} maxLength={50} onChange={(e) => update({ number: e.target.value })} />
          </Field>
          <Field label={t('committee.form.date')} hint={t('committee.form.afterSigning')}>
            <Input type="date" value={data.order_date} onChange={(e) => update({ order_date: e.target.value })} />
          </Field>
        </div>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          {textField('title_ru', t('committee.form.titleRu'), { required: true })}
          {textField('title_kz', t('committee.form.titleKz'))}
          {textField('purpose_ru', t('committee.form.purposeRu'), { multiline: true })}
          {textField('purpose_kz', t('committee.form.purposeKz'), { multiline: true })}
          {textField('basis_ru', t('committee.form.basisRu'), { multiline: true })}
          {textField('basis_kz', t('committee.form.basisKz'), { multiline: true })}
        </div>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <Field label={t('committee.form.signerPosition')}>
            <Select value={signerPosition} placeholder={t('committee.form.selectSignerPosition')} options={positionOptions}
              onChange={(e) => setSignerPosition(e.target.value)} />
          </Field>
          <Field label={t('committee.form.signer')} error={signerMissing ? t('committee.memberForm.tutorNotFound') : undefined}
            hint={signer ? t('committee.form.signerPreview', { signer: `${signerPosition} ${signerName(signer.full_name)}`.trim() }) : undefined}>
            <Combobox value={signerText} options={signerOptions} sheetTitle={t('committee.form.signer')}
              placeholder={t('committee.memberForm.tutorPlaceholder')} onChange={setSignerText} />
          </Field>
        </div>
        {!order && copySource && (
          <Checkbox
            label={t('committee.form.copyMembers', { year: copySource.academic_year, count: copySource.members_count })}
            description={t('committee.form.copyMembersHint')}
            checked={copyMembers}
            onChange={(e) => setCopyMembers(e.target.checked)}
          />
        )}
      </form>
    </Modal>
  )
}

function MemberForm({ open, member, orderId, tutors, takenTutorIds, onClose, onSaved }) {
  const { t, i18n } = useTranslation()
  const [tutorText, setTutorText] = useState('')
  const [position, setPosition] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Подпись варианта уникальна: однофамильцы различаются логином; уже включённые в состав не предлагаются
  const options = useMemo(
    () => tutorOptions(tutors).filter((option) => option.value === member?.tutor_id || !takenTutorIds.has(option.value)),
    [tutors, takenTutorIds, member],
  )
  const optionByLabel = useMemo(() => new Map(options.map((option) => [option.label, option])), [options])

  useEffect(() => {
    if (!open) return
    setError('')
    setTutorText(member?.tutor_id ? options.find((option) => option.value === member.tutor_id)?.label || '' : '')
    setPosition(member ? String(member.position || '') : '')
  }, [open, member]) // eslint-disable-line react-hooks/exhaustive-deps

  const selected = optionByLabel.get(tutorText.trim())?.tutor
  const notFound = Boolean(tutorText.trim()) && !selected
  // У члена из скана приказа ФИО и должность — как в приказе, пока не выбран другой преподаватель
  const keepsOrderText = member && selected?.id === member.tutor_id
  const preview = keepsOrderText ? member : selected

  const submit = async (event) => {
    event.preventDefault()
    if (!selected) return
    setSaving(true)
    setError('')
    const payload = { tutor_id: selected.id, ...(position ? { position: Number(position) } : {}) }
    try {
      onSaved(member ? await updateCommitteeMember(member.id, payload) : await addCommitteeMember(orderId, payload))
    } catch (err) {
      setError(apiErrorText(err, t('committee.members.saveError')))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={saving ? undefined : onClose}
      size="lg"
      title={member ? t('committee.memberForm.editTitle') : t('committee.memberForm.addTitle')}
      description={t('committee.memberForm.hint')}
      closeLabel={t('ui.close')}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>{t('committee.form.cancel')}</Button>
          <Button type="submit" form={MEMBER_FORM_ID} icon="check" loading={saving} disabled={!selected}>{t('committee.form.save')}</Button>
        </>
      )}
    >
      <form id={MEMBER_FORM_ID} onSubmit={submit} className="flex min-w-0 flex-col gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="grid min-w-0 gap-4 sm:grid-cols-[1fr_9rem]">
          <Field label={t('committee.memberForm.tutor')} required error={notFound ? t('committee.memberForm.tutorNotFound') : undefined}>
            <Combobox value={tutorText} required options={options} sheetTitle={t('committee.memberForm.tutor')}
              placeholder={t('committee.memberForm.tutorPlaceholder')} onChange={setTutorText} />
          </Field>
          <Field label={t('committee.memberForm.number')} hint={member ? undefined : t('committee.memberForm.numberHint')}>
            <Input type="number" min={1} max={1000} value={position} onChange={(e) => setPosition(e.target.value)} />
          </Field>
        </div>
        {preview && (
          <div className="rounded-md border border-line bg-surface-muted p-4">
            <p className="text-xs font-medium text-fg-subtle">{t('committee.memberForm.inOrder')}</p>
            <p className="mt-1 font-medium text-fg">{preview.name}</p>
            <p className="mt-1 text-sm text-fg-muted">{localized(preview, 'position', i18n.language) || '—'}</p>
            <p className="mt-3 text-xs text-fg-subtle">
              {keepsOrderText ? t('committee.memberForm.fromScan') : t('committee.memberForm.fromPlatonus')}
              {' '}
              <Link to={`/users/tutors/${selected.id}`} target="_blank" className="font-medium text-primary underline-offset-2 hover:underline">
                {t('committee.memberForm.openCard')}
              </Link>
            </p>
          </div>
        )}
      </form>
    </Modal>
  )
}

export default function CommitteePage() {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const { toast, confirm } = useUI()
  const { role } = useAuth()
  const canEdit = isAdmin(role)
  // Распределение проверок по преподавателям — администратор и инспектор КРК (ASSIGN_ROLES в routers/committee.py)
  const canAssign = canEdit || role === 'inspector'

  const [years, setYears] = useState([])
  const [rectorId, setRectorId] = useState(null)
  const [year, setYear] = useState('')
  const [orders, setOrders] = useState([])
  const [order, setOrder] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tutors, setTutors] = useState([])
  // undefined — форма закрыта, null — новая запись, объект — правка
  const [orderForm, setOrderForm] = useState(undefined)
  const [memberForm, setMemberForm] = useState(undefined)
  const [uploading, setUploading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const fileInput = useRef(null)

  // Год по умолчанию — год действующего состава, иначе — год по умолчанию из справочника
  useEffect(() => {
    let active = true
    Promise.all([getCommittee(), getAcademicYears().catch(() => [])])
      .then(([overview, list]) => {
        if (!active) return
        setOrders(overview.orders)
        setRectorId(overview.rector_tutor_id)
        setYears(list.map((y) => y.name))
        setYear(overview.active?.academic_year || list.find((y) => y.is_default)?.name || overview.orders[0]?.academic_year || list[0]?.name || '')
      })
      .catch((err) => { if (active) { setError(apiErrorText(err, t('committee.loadError'))); setLoading(false) } })
    return () => { active = false }
  }, [t])

  useEffect(() => {
    if (canEdit) getCommitteeTutors().then(setTutors).catch(() => {})
  }, [canEdit])

  const yearOrder = orders.find((o) => o.academic_year === year) || null
  const loadOrder = useCallback(async (id) => {
    setLoading(true)
    setError('')
    try {
      setOrder(id ? await getCommitteeOrder(id) : null)
    } catch (err) {
      setError(apiErrorText(err, t('committee.loadError')))
    } finally {
      setLoading(false)
    }
  }, [t])
  useEffect(() => { if (year) loadOrder(yearOrder?.id) }, [year, yearOrder?.id, loadOrder])

  // Состав для копирования в новый год — ближайший более ранний, иначе любой последний
  const copySource = useMemo(() => {
    const others = orders.filter((o) => o.academic_year !== year)
    return others.find((o) => o.academic_year < year) || others[0] || null
  }, [orders, year])
  const [copySourceDetail, setCopySourceDetail] = useState(null)
  useEffect(() => {
    if (orderForm === null && copySource) getCommitteeOrder(copySource.id).then(setCopySourceDetail).catch(() => setCopySourceDetail(null))
  }, [orderForm, copySource])

  const yearOptions = [...new Set([...years, ...orders.map((o) => o.academic_year)])].sort().reverse()
    .map((y) => {
      const o = orders.find((item) => item.academic_year === y)
      const state = o ? (o.is_active ? t('committee.order.active') : t(`committee.order.statuses.${o.status}`)) : t('committee.order.none')
      return { value: y, label: `${y} · ${state}` }
    })

  // Ответ на правку — приказ целиком; список составов обновляется по нему (статус, число членов)
  const applyOrder = (saved, message) => {
    setOrder(saved)
    setOrders((list) => {
      const summary = {
        id: saved.id, number: saved.number, order_date: saved.order_date, academic_year: saved.academic_year,
        title_ru: saved.title_ru, title_kz: saved.title_kz, is_active: saved.is_active, is_signed: saved.is_signed, status: saved.status,
        members_count: saved.members_count,
      }
      return [summary, ...list.filter((o) => o.id !== saved.id).map((o) => (saved.is_active ? { ...o, is_active: false } : o))]
    })
    if (saved.academic_year !== year) setYear(saved.academic_year)
    if (message) toast.success(message)
  }

  const runAction = async (action, message) => {
    try {
      applyOrder(await action(), message)
    } catch (err) {
      toast.error(apiErrorText(err, t('committee.order.actionError')))
    }
  }

  const handleActivate = async () => {
    const ok = await confirm({ message: t('committee.order.activateConfirm', { number: order.number }), confirmLabel: t('committee.order.activate') })
    if (ok) runAction(() => activateCommitteeOrder(order.id), t('committee.order.activated'))
  }

  const handleDeactivate = async () => {
    const ok = await confirm({ message: t('committee.order.deactivateConfirm', { number: order.number }), confirmLabel: t('committee.order.deactivate'), tone: 'danger' })
    if (!ok) return
    try {
      const saved = await deactivateCommitteeOrder(order.id)
      setOrders((list) => list.map((o) => (o.id === saved.id ? { ...o, is_active: false } : o)))
      setOrder(saved)
      toast.success(t('committee.order.deactivated'))
    } catch (err) {
      toast.error(apiErrorText(err, t('committee.order.actionError')))
    }
  }

  const handleSend = async () => {
    const ok = await confirm({ message: t('committee.order.sendConfirm', { number: order.number, signer: order.signed_by }), confirmLabel: t('committee.order.send') })
    if (ok) runAction(() => sendCommitteeOrder(order.id), t('committee.order.sent'))
  }

  const handleRecall = async () => {
    const ok = await confirm({ message: t('committee.order.recallConfirm'), confirmLabel: t('committee.order.recall') })
    if (ok) runAction(() => recallCommitteeOrder(order.id), t('committee.order.recalled'))
  }

  const handleDeleteOrder = async () => {
    const ok = await confirm({ message: t('committee.order.deleteConfirm', { year: order.academic_year }), confirmLabel: t('ui.delete'), tone: 'danger' })
    if (!ok) return
    try {
      await deleteCommitteeOrder(order.id)
      setOrders((list) => list.filter((o) => o.id !== order.id))
      setOrder(null)
      toast.success(t('committee.order.deleted'))
    } catch (err) {
      toast.error(apiErrorText(err, t('committee.order.actionError')))
    }
  }

  const handleRefresh = async () => {
    const ok = await confirm({ message: t('committee.members.refreshConfirm'), confirmLabel: t('committee.members.refresh') })
    if (!ok) return
    setRefreshing(true)
    try {
      const saved = await refreshCommitteeMembers(order.id)
      applyOrder(saved, t('committee.members.refreshed', { count: saved.refreshed }))
    } catch (err) {
      toast.error(apiErrorText(err, t('committee.order.actionError')))
    } finally {
      setRefreshing(false)
    }
  }

  const handleDeleteMember = async (member) => {
    // Из подписанного приказа удаляет только суперадмин: подписанный состав сохраняется, проверки передаются остальным
    const signed = order.status === 'signed'
    const ok = await confirm({
      message: t(signed ? 'committee.members.deleteSignedConfirm' : 'committee.members.deleteConfirm', { name: member.name }),
      confirmLabel: t('committee.members.delete'),
      tone: 'danger',
    })
    if (!ok) return
    try {
      const saved = await deleteCommitteeMember(member.id)
      applyOrder(saved, saved.moved || signed
        ? t('committee.members.deletedSigned', { name: member.name, moved: saved.moved })
        : t('committee.members.deleted'))
    } catch (err) {
      toast.error(apiErrorText(err, t('committee.order.actionError')))
    }
  }

  const handleFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUploading(true)
    try {
      applyOrder(await uploadCommitteeOrderFile(order.id, file), t('committee.order.scanUploaded'))
    } catch (err) {
      toast.error(apiErrorText(err, t('committee.order.scanError')))
    } finally {
      setUploading(false)
    }
  }

  const members = order?.members || []
  const linked = members.filter((m) => m.linked).length
  const withAccount = members.filter((m) => m.account).length
  const takenTutorIds = useMemo(() => new Set(members.map((m) => m.tutor_id).filter(Boolean)), [members])

  const columns = [
    { key: 'position', header: t('committee.members.number'), nowrap: true, mobile: 'hidden', cell: (m) => <span className="tabular text-fg-muted">{m.position}</span> },
    {
      key: 'member',
      header: t('committee.members.member'),
      mobile: 'title',
      minWidth: '16rem',
      cell: (m) => (
        <div className="min-w-0">
          <p className="font-medium text-fg">{m.name}</p>
          <p className="text-xs text-fg-subtle">{localized(m, 'position', lang)}</p>
        </div>
      ),
    },
    {
      key: 'tutor',
      header: t('committee.members.tutor'),
      minWidth: '14rem',
      cell: (m) => (m.linked ? (
        <div className="min-w-0">
          {canEdit
            ? <Link to={`/users/tutors/${m.tutor_id}`} className="font-medium text-primary underline-offset-2 hover:underline">{m.tutor_name}</Link>
            : <p className="text-fg">{m.tutor_name}</p>}
          <p className="text-xs text-fg-subtle">{m[`cafedra_name_${lang}`] || m.cafedra_name_ru || ''}</p>
        </div>
      ) : <Badge tone="warning" icon="alert">{t('committee.members.unlinked')}</Badge>),
    },
    {
      key: 'account',
      header: t('committee.members.account'),
      nowrap: true,
      cell: (m) => (m.account
        ? <Badge tone={m.account.role === 'committee' ? 'success' : 'primary'}>{t(`shell.roles.${m.account.role || 'user'}`)}</Badge>
        : <span className="text-sm text-fg-subtle">{t('committee.members.noAccount')}</span>),
    },
  ]
  // Отправленный на подпись и подписанный ЭЦП приказ не меняется (подпись относится к содержимому);
  // из подписанного суперадмин может удалить члена — подписанный состав сохраняется на бэкенде
  const editable = canEdit && order && ['draft', 'registered'].includes(order.status)
  const canRemoveSigned = isSuperadmin(role) && order?.status === 'signed'
  if (editable || canRemoveSigned) {
    columns.push({
      key: 'actions',
      header: <span className="sr-only">{t('ui.actions')}</span>,
      mobileLabel: t('ui.actions'),
      align: 'right',
      nowrap: true,
      cell: (m) => (
        <div className="inline-flex items-center gap-1">
          {editable && <Button variant="ghost" size="sm" icon="edit" iconOnly aria-label={t('committee.members.edit')} onClick={() => setMemberForm(m)} />}
          <Button variant="danger-ghost" size="sm" icon="trash" iconOnly aria-label={t('committee.members.delete')} onClick={() => handleDeleteMember(m)} />
        </div>
      ),
    })
  }

  const scanActions = order && (
    <div className="flex flex-wrap items-center gap-2">
      {order.has_file
        ? <Button as="a" href={committeeOrderFileUrl(order.id)} target="_blank" rel="noopener" variant="secondary" size="sm" icon="file-text">{t('committee.order.openScan')}</Button>
        : <span className="text-sm text-fg-subtle">{t('committee.order.noScan')}</span>}
      {canEdit && (
        <>
          <input ref={fileInput} type="file" accept="application/pdf,.pdf" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={handleFile} />
          <Button variant="ghost" size="sm" icon="upload" loading={uploading} onClick={() => fileInput.current?.click()}>
            {order.has_file ? t('committee.order.replaceScan') : t('committee.order.uploadScan')}
          </Button>
        </>
      )}
    </div>
  )

  const status = order && (
    <>
      <Badge tone={STATUS_TONE[order.status]} dot>{t(`committee.order.statuses.${order.status}`)}</Badge>
      {order.is_active && <Badge tone="success">{t('committee.order.active')}</Badge>}
    </>
  )
  const canSend = Boolean(order?.number && order?.signer_tutor_id && order?.members_count)
  let stateAlert = null
  if (order?.status === 'draft' && canEdit) stateAlert = <Alert tone="info">{t('committee.order.draftHint')}</Alert>
  if (order?.status === 'on_signing') {
    stateAlert = <Alert tone="info">{t('committee.order.onSigningHint', { signer: order.signed_by, date: formatSignedAt(order.sent_at) })}</Alert>
  }
  if (order?.status === 'signed') {
    stateAlert = (
      <Alert tone="success">
        {t('committee.order.signedHint', { signer: order.signed_by, date: formatSignedAt(order.signed_at), serial: order.signature?.certificate_serial || '' })}
        {' '}
        <a href={verifyUrl(order.verify_token)} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-2">{t('committee.order.verifyLink')}</a>
      </Alert>
    )
  }

  let content
  if (loading && !order) {
    content = <LoadingBlock label={t('ui.loading')} />
  } else if (!order) {
    content = !error && (
      <Card>
        <EmptyState
          icon="shield"
          title={t('committee.emptyTitle', { year })}
          description={canEdit ? t('committee.emptyHint') : undefined}
          action={canEdit && year ? <Button icon="plus" onClick={() => setOrderForm(null)}>{t('committee.order.create', { year })}</Button> : undefined}
        />
      </Card>
    )
  } else {
    content = (
      <>
        {stateAlert}
        <Card>
          <CardHeader
            title={localized(order, 'title', lang)}
            description={order.number && order.order_date
              ? `${t('committee.order.heading', { number: order.number, date: formatOrderDate(order.order_date) })} · ${order.academic_year}`
              : t('committee.order.draftHeading', { year: order.academic_year })}
            actions={(
              <div className="flex flex-wrap items-center gap-2">
                {status}
                {editable && <Button variant="ghost" size="sm" icon="edit" onClick={() => setOrderForm(order)}>{t('committee.order.edit')}</Button>}
                {/* Подписанный на бумаге (registered) тоже можно подписать ЭЦП — он станет электронным документом */}
                {canEdit && ['draft', 'registered'].includes(order.status) && (
                  <Button size="sm" icon="send" disabled={!canSend} title={canSend ? undefined : t('committee.order.sendNeeds')} onClick={handleSend}>
                    {t('committee.order.send')}
                  </Button>
                )}
                {canEdit && order.status === 'on_signing' && (
                  <Button variant="secondary" size="sm" icon="rotate-ccw" onClick={handleRecall}>{t('committee.order.recall')}</Button>
                )}
                {canEdit && order.is_active && (
                  <Button variant="danger-ghost" size="sm" icon="x" onClick={handleDeactivate}>{t('committee.order.deactivate')}</Button>
                )}
                {canEdit && order.status === 'registered' && !order.is_active && (
                  <Button size="sm" icon="check" onClick={handleActivate}>{t('committee.order.activate')}</Button>
                )}
                {canEdit && !order.is_active && order.status !== 'signed' && (
                  <Button variant="danger-ghost" size="sm" icon="trash" iconOnly aria-label={t('committee.order.delete')} onClick={handleDeleteOrder} />
                )}
              </div>
            )}
          />
          <CardBody>
            <DescriptionList items={[
              { label: t('committee.order.purpose'), value: localized(order, 'purpose', lang) || '—', full: true },
              { label: t('committee.order.basis'), value: localized(order, 'basis', lang) || '—' },
              { label: t('committee.order.signedBy'), value: order.signed_by || '—' },
              order.status !== 'signed' && { label: t('committee.order.scan'), value: scanActions, full: true },
            ]}
            />
          </CardBody>
        </Card>

        <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label={t('committee.stats.members')} value={members.length} icon="users" />
          <StatCard label={t('committee.stats.linked')} value={`${linked} / ${members.length}`} tone={linked < members.length ? 'warning' : 'success'} />
          <StatCard label={t('committee.stats.withAccount')} value={withAccount} tone="primary" hint={t('committee.stats.withAccountHint')} />
        </div>

        {linked < members.length && <Alert tone="warning">{t('committee.unlinkedAlert', { count: members.length - linked })}</Alert>}
        {order.removed_after_signing?.length > 0 && (
          <Alert tone="info">{t('committee.members.removedAfterSigning', { names: order.removed_after_signing.map((m) => m.name).join(', ') })}</Alert>
        )}

        <Card className="overflow-hidden">
          <CardHeader
            title={t('committee.members.title')}
            description={t('committee.members.count', { count: members.length })}
            actions={editable || canAssign ? (
              <div className="flex flex-wrap items-center gap-2">
                {canAssign && (
                  <Button as={Link} to={`/committee/${order.id}/assignments`} size="sm" icon="user-check" disabled={!linked}>
                    {t('assignments.open')}
                  </Button>
                )}
                {editable && (
                  <>
                    <Button variant="ghost" size="sm" icon="refresh" loading={refreshing} disabled={!linked} onClick={handleRefresh}>{t('committee.members.refresh')}</Button>
                    <Button variant="secondary" size="sm" icon="plus" onClick={() => setMemberForm(null)}>{t('committee.members.add')}</Button>
                  </>
                )}
              </div>
            ) : undefined}
          />
          <DataTable
            columns={columns}
            rows={members}
            loading={loading}
            skeletonRows={8}
            caption={t('committee.members.title')}
            empty={<EmptyState icon="users" title={t('committee.members.emptyTitle')} description={editable ? t('committee.members.emptyHint') : undefined} />}
          />
        </Card>
      </>
    )
  }

  return (
    <PageStack>
      <PageHeader
        title={t('committee.title')}
        description={t('committee.description')}
        actions={order && canEdit ? (
          <Button as={Link} to={`/committee/print/${order.id}`} variant="secondary" icon={order.status === 'signed' ? 'file-text' : 'printer'} disabled={!members.length}>
            {order.status === 'signed' ? t('committee.print.openSigned') : t('committee.print.open')}
          </Button>
        ) : undefined}
      />

      {yearOptions.length > 0 && (
        <Field label={t('committee.year')} className="max-w-sm">
          <Select value={year} options={yearOptions} onChange={(e) => setYear(e.target.value)} />
        </Field>
      )}

      {error && <Alert tone="danger" onClose={() => setError('')} closeLabel={t('ui.close')}>{error}</Alert>}

      {content}

      <OrderForm
        open={orderForm !== undefined}
        order={orderForm || null}
        academicYear={year}
        years={years}
        copySource={orderForm === null && copySourceDetail?.id === copySource?.id ? copySourceDetail : null}
        tutors={tutors}
        rectorId={rectorId}
        onClose={() => setOrderForm(undefined)}
        onSaved={(saved) => { setOrderForm(undefined); applyOrder(saved, t('committee.order.saved')) }}
      />
      <MemberForm
        open={memberForm !== undefined}
        member={memberForm || null}
        orderId={order?.id}
        tutors={tutors}
        takenTutorIds={takenTutorIds}
        onClose={() => setMemberForm(undefined)}
        onSaved={(saved) => { setMemberForm(undefined); applyOrder(saved, t('committee.members.saved')) }}
      />
    </PageStack>
  )
}
