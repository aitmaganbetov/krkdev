import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  addRoomInventoryItem, apiErrorText, deleteRoomInventoryItem, getRoomInventory, updateRoomInventoryItem,
} from '../services/api'
import {
  Alert, Badge, Button, DataTable, DescriptionList, EmptyState, Field, FormSection, Input, LoadingBlock, Modal, Select, Textarea, useUI,
} from './ui'
import { formatMoney } from '../utils/locale'

const CONDITIONS = ['good', 'repair', 'written_off']
const CONDITION_TONE = { good: 'success', repair: 'warning', written_off: 'neutral' }
const EMPTY_ITEM = {
  name: '', category: '', inventory_number: '', quantity: 1, unit_price: 0, condition: 'good', acquired_year: '', notes: '',
}
const FORM_ID = 'room-inventory-form'

/** Оснащение и инвентаризация кабинета: позиции, количество × цена, итоговая стоимость. */
export default function RoomInventoryModal({ room, onClose, onChanged }) {
  const { t, i18n } = useTranslation()
  const { toast, confirm } = useUI()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState(EMPTY_ITEM)
  const [editingId, setEditingId] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const money = (value) => formatMoney(value, i18n.language)

  const apply = (result) => {
    setData(result)
    onChanged?.(result.room_id, result.items.length, result.total)
  }

  const load = () => {
    if (!room) return
    setLoading(true)
    setError('')
    getRoomInventory(room.id)
      .then(setData)
      .catch((err) => setError(apiErrorText(err, t('roomsPage.inventory.loadError'))))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    setData(null)
    setShowForm(false)
    setEditingId(null)
    load()
  }, [room?.id])

  const startCreate = () => {
    setForm(EMPTY_ITEM)
    setEditingId(null)
    setShowForm(true)
  }

  const startEdit = (item) => {
    setForm({ ...item, acquired_year: item.acquired_year ?? '' })
    setEditingId(item.id)
    setShowForm(true)
  }

  const patch = (values) => setForm((current) => ({ ...current, ...values }))

  const save = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    const payload = {
      name: form.name,
      category: form.category,
      inventory_number: form.inventory_number,
      quantity: Number(form.quantity) || 0,
      unit_price: Number(form.unit_price) || 0,
      condition: form.condition,
      acquired_year: form.acquired_year === '' ? null : Number(form.acquired_year),
      notes: form.notes,
    }
    try {
      if (editingId) await updateRoomInventoryItem(editingId, payload)
      else await addRoomInventoryItem(room.id, payload)
      toast.success(editingId ? t('roomsPage.inventory.updated') : t('roomsPage.inventory.added'))
      setShowForm(false)
      setEditingId(null)
      apply(await getRoomInventory(room.id))
    } catch (err) {
      setError(apiErrorText(err, t('roomsPage.inventory.saveError')))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (item) => {
    const ok = await confirm({
      title: t('roomsPage.inventory.deleteTitle'),
      message: t('roomsPage.inventory.deleteConfirm', { name: item.name }),
      confirmLabel: t('roomsPage.actions.delete'),
      tone: 'danger',
    })
    if (!ok) return
    try {
      await deleteRoomInventoryItem(item.id)
      toast.success(t('roomsPage.inventory.deleted'))
      apply(await getRoomInventory(room.id))
    } catch (err) {
      setError(apiErrorText(err, t('roomsPage.inventory.saveError')))
    }
  }

  const columns = [
    {
      key: 'name',
      header: t('roomsPage.inventory.fields.name'),
      mobile: 'title',
      minWidth: '14rem',
      cell: (item) => (
        <div className="min-w-0">
          <p className="break-words font-medium text-fg">{item.name}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
            {item.category && <span>{item.category}</span>}
            {item.inventory_number && <span className="font-mono">№ {item.inventory_number}</span>}
            {item.from_platonus && <Badge tone="neutral">Platonus</Badge>}
          </p>
        </div>
      ),
    },
    { key: 'quantity', header: t('roomsPage.inventory.fields.quantity'), align: 'right', nowrap: true, cell: (item) => <span className="tabular">{item.quantity}</span> },
    { key: 'unit_price', header: t('roomsPage.inventory.fields.unitPrice'), align: 'right', nowrap: true, cell: (item) => <span className="tabular">{money(item.unit_price)}</span> },
    {
      key: 'total',
      header: t('roomsPage.inventory.fields.total'),
      align: 'right',
      nowrap: true,
      cell: (item) => (
        <span className={item.condition === 'written_off' ? 'tabular text-fg-subtle line-through' : 'tabular font-medium'}>{money(item.total)}</span>
      ),
    },
    {
      key: 'condition',
      header: t('roomsPage.inventory.fields.condition'),
      nowrap: true,
      cell: (item) => <Badge tone={CONDITION_TONE[item.condition] || 'neutral'} dot>{t(`roomsPage.inventory.conditions.${item.condition}`)}</Badge>,
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t('ui.actions')}</span>,
      mobile: 'full',
      nowrap: true,
      cell: (item) => (
        <div className="flex flex-wrap justify-end gap-1">
          <Button size="sm" variant="ghost" icon="edit" iconOnly aria-label={t('roomsPage.inventory.editAria', { name: item.name })} onClick={() => startEdit(item)} />
          <Button size="sm" variant="danger-ghost" icon="trash" iconOnly aria-label={t('roomsPage.inventory.deleteAria', { name: item.name })} onClick={() => remove(item)} />
        </div>
      ),
    },
  ]

  return (
    <Modal
      open={!!room}
      onClose={onClose}
      size="xl"
      title={room ? t('roomsPage.inventory.title', { name: room.name }) : ''}
      description={room ? [room.building, room.room_type].filter(Boolean).join(' · ') : undefined}
      footer={showForm ? (
        <>
          <Button variant="secondary" onClick={() => setShowForm(false)}>{t('roomsPage.form.cancel')}</Button>
          <Button type="submit" form={FORM_ID} icon="check" loading={saving}>
            {saving ? t('roomsPage.form.saving') : t('roomsPage.form.save')}
          </Button>
        </>
      ) : (
        <>
          <Button variant="secondary" onClick={onClose}>{t('roomsPage.live.close')}</Button>
          <Button icon="plus" onClick={startCreate}>{t('roomsPage.inventory.add')}</Button>
        </>
      )}
    >
      <div className="flex min-w-0 flex-col gap-5">
        {error && <Alert tone="danger" closeLabel={t('ui.close')} onClose={() => setError('')}>{error}</Alert>}

        {loading && !data ? <LoadingBlock label={t('roomsPage.inventory.loading')} /> : data && (
          <>
            <div className="rounded-lg border border-line bg-surface-muted p-4">
              <DescriptionList columns={3} items={[
                { label: t('roomsPage.inventory.total'), value: <span className="text-lg font-semibold tabular text-fg">{money(data.total)}</span> },
                { label: t('roomsPage.inventory.count'), value: <span className="tabular">{data.items.length}</span> },
                { label: t('roomsPage.inventory.writtenOff'), value: <span className="tabular">{money(data.written_off_total)}</span> },
              ]} />
              {data.items.some((item) => !Number(item.unit_price)) && (
                <p className="mt-3 text-xs text-fg-subtle">{t('roomsPage.inventory.noPriceHint')}</p>
              )}
            </div>

            {showForm && (
              <form id={FORM_ID} onSubmit={save} className="min-w-0 rounded-lg border border-line p-4">
                <FormSection title={editingId ? t('roomsPage.inventory.editTitle') : t('roomsPage.inventory.addTitle')}>
                  <Field label={t('roomsPage.inventory.fields.name')} required className="sm:col-span-2">
                    <Input value={form.name} onChange={(e) => patch({ name: e.target.value })} placeholder={t('roomsPage.inventory.namePlaceholder')} required data-autofocus />
                  </Field>
                  <Field label={t('roomsPage.inventory.fields.category')}>
                    <Input value={form.category} onChange={(e) => patch({ category: e.target.value })} placeholder={t('roomsPage.inventory.categoryPlaceholder')} />
                  </Field>
                  <Field label={t('roomsPage.inventory.fields.inventoryNumber')}>
                    <Input value={form.inventory_number} onChange={(e) => patch({ inventory_number: e.target.value })} autoComplete="off" />
                  </Field>
                  <Field label={t('roomsPage.inventory.fields.quantity')}>
                    <Input type="number" min="0" inputMode="numeric" value={form.quantity} onChange={(e) => patch({ quantity: e.target.value })} />
                  </Field>
                  <Field label={t('roomsPage.inventory.fields.unitPrice')} hint={t('roomsPage.inventory.priceHint')}>
                    <Input type="number" min="0" step="0.01" inputMode="decimal" value={form.unit_price} onChange={(e) => patch({ unit_price: e.target.value })} />
                  </Field>
                  <Field label={t('roomsPage.inventory.fields.condition')}>
                    <Select
                      value={form.condition}
                      onChange={(e) => patch({ condition: e.target.value })}
                      options={CONDITIONS.map((value) => ({ value, label: t(`roomsPage.inventory.conditions.${value}`) }))}
                    />
                  </Field>
                  <Field label={t('roomsPage.inventory.fields.acquiredYear')}>
                    <Input type="number" min="1950" max="2100" inputMode="numeric" value={form.acquired_year} onChange={(e) => patch({ acquired_year: e.target.value })} />
                  </Field>
                  <Field label={t('roomsPage.inventory.fields.notes')} className="sm:col-span-2">
                    <Textarea rows={2} value={form.notes} onChange={(e) => patch({ notes: e.target.value })} />
                  </Field>
                  <p className="text-sm text-fg-muted sm:col-span-2">
                    {t('roomsPage.inventory.lineTotal')}: <span className="font-semibold tabular text-fg">{money((Number(form.quantity) || 0) * (Number(form.unit_price) || 0))}</span>
                  </p>
                </FormSection>
              </form>
            )}

            <DataTable
              columns={columns}
              rows={data.items}
              caption={t('roomsPage.inventory.title', { name: room?.name || '' })}
              empty={<EmptyState icon="inbox" title={t('roomsPage.inventory.empty')} description={t('roomsPage.inventory.emptyHint')} compact />}
            />
          </>
        )}
      </div>
    </Modal>
  )
}
