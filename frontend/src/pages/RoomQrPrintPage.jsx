import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import RoomQr from '../components/RoomQr'
import { apiErrorText, getRooms } from '../services/api'
import { Alert, Button, LoadingBlock, PageHeader, PageStack } from '../components/ui'

/** Листы с QR-кодами аудиторий для печати (по 6 на A4): кабинеты из ?ids=…, без параметра — все. */
export default function RoomQrPrintPage() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const [rooms, setRooms] = useState(null)
  const [error, setError] = useState('')
  const ids = useMemo(() => new Set((params.get('ids') || '').split(',').map(Number).filter(Boolean)), [params])

  useEffect(() => {
    getRooms()
      .then((data) => setRooms((data || []).filter((room) => room.qr_code && (ids.size === 0 || ids.has(room.id)))))
      .catch((err) => setError(apiErrorText(err, t('roomsPage.loadError'))))
  }, [ids])

  return (
    <PageStack>
      <div className="print:hidden">
        <PageHeader
          title={t('roomsPage.qr.printTitle')}
          description={rooms ? t('roomsPage.qr.printCount', { count: rooms.length }) : null}
          back={{ to: '/rooms-settings', label: t('nav.rooms') }}
          actions={<Button icon="printer" disabled={!rooms?.length} onClick={() => window.print()}>{t('roomsPage.qr.print')}</Button>}
        />
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {!rooms && !error && <LoadingBlock label={t('scan.loading')} />}
      {rooms && (
        // На печати: 2 колонки × 3 ряда на A4, карточка не разрывается между страницами
        <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 print:grid-cols-2 print:gap-6">
          {rooms.map((room) => (
            <div key={room.id}
              className="flex min-w-0 break-inside-avoid flex-col items-center gap-3 rounded-lg border border-line bg-white p-5 text-center text-black print:border-black">
              <p className="text-3xl font-bold">{room.name}</p>
              <p className="text-sm">{[room.building, room.room_type].filter(Boolean).join(' · ')}</p>
              <RoomQr code={room.qr_code} size={200} alt={t('roomsPage.qr.alt', { name: room.name })} />
              <p className="text-xs">{t('roomsPage.qr.caption')}</p>
            </div>
          ))}
        </div>
      )}
    </PageStack>
  )
}
