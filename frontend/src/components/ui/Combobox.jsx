import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { cn } from './cn'
import Icon from './Icon'
import { useFieldProps } from './Field'
import { useMediaQuery } from './useMediaQuery'

// Поиск без учёта регистра, ё/е и казахских букв («Ғалымжан» находится по «галым»)
const FOLD = { ә: 'а', ғ: 'г', қ: 'к', ң: 'н', ө: 'о', ұ: 'у', ү: 'у', һ: 'х', і: 'и', ё: 'е' }
const fold = (value) => String(value || '').toLowerCase().replace(/[әғқңөұүһіё]/g, (ch) => FOLD[ch])

const MOBILE_QUERY = '(max-width: 639px)'

const useIsMobile = () => useMediaQuery(MOBILE_QUERY)

/** Варианты, подходящие под запрос: все слова запроса встречаются в подписи или пояснении.
 *  Сначала — подписи, начинающиеся с запроса, затем — где с запроса начинается слово. */
function filterOptions(options, query) {
  const tokens = fold(query).split(/\s+/).filter(Boolean)
  if (!tokens.length) return options
  const ranked = []
  options.forEach((option, index) => {
    const label = fold(option.label)
    const haystack = `${label} ${fold(option.description)}`
    if (!tokens.every((token) => haystack.includes(token))) return
    const rank = label.startsWith(tokens[0]) ? 0 : label.split(/\s+/).some((word) => word.startsWith(tokens[0])) ? 1 : 2
    ranked.push({ option, rank, index })
  })
  return ranked.sort((a, b) => a.rank - b.rank || a.index - b.index).map((item) => item.option)
}

// Выделение первого вхождения запроса в подписи (замена букв в fold — один к одному, позиции совпадают)
function Highlight({ text, query }) {
  const token = fold(query).trim().split(/\s+/)[0]
  const start = token ? fold(text).indexOf(token) : -1
  if (start < 0) return text
  return (
    <>
      {text.slice(0, start)}
      <mark className="rounded-sm bg-primary-subtle text-inherit">{text.slice(start, start + token.length)}</mark>
      {text.slice(start + token.length)}
    </>
  )
}

/**
 * Поле с выпадающим списком и поиском (вместо нативного datalist).
 * — ≥ 640px: список под полем (портал — не обрезается модальным окном), клавиатура ↑ ↓ Enter Esc;
 * — < 640px: полноэкранная панель с поиском сверху — клавиатура телефона не закрывает варианты.
 * value — текст поля; onChange(text, option | null): option — выбранный вариант или точное совпадение.
 * allowCustom — можно оставить текст, которого нет в списке (например, ФИО вне справочника).
 * options: [{ value, label, description? }]. Показывается не больше maxResults вариантов.
 */
export default function Combobox({
  value = '', onChange, options = [], placeholder, allowCustom = true, maxResults = 100,
  sheetTitle, disabled, className, ...rest
}) {
  const { t } = useTranslation()
  const fieldProps = useFieldProps(rest)
  const mobile = useIsMobile()
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [pos, setPos] = useState(null)
  const inputRef = useRef(null)
  const sheetInputRef = useRef(null)
  const panelRef = useRef(null)
  const listRef = useRef(null)

  // На компьютере ищем по тексту поля; на телефоне — по строке поиска в панели
  const search = mobile ? query : value
  const matches = useMemo(() => filterOptions(options, open ? search : ''), [options, search, open])
  const shown = matches.slice(0, maxResults)
  const typed = query.trim()
  const showUseTyped = allowCustom && mobile && typed && !options.some((o) => fold(o.label) === fold(typed))

  const emit = (text) => {
    const found = options.find((option) => fold(option.label) === fold(text).trim())
    onChange?.(text, found || null)
  }
  const choose = (option) => {
    onChange?.(option.label, option)
    setOpen(false)
    if (!mobile) inputRef.current?.focus()
  }
  const openSheet = () => {
    if (disabled) return
    setQuery('')
    setActive(0)
    setOpen(true)
  }

  // Положение списка под полем; при нехватке места снизу — над полем
  useLayoutEffect(() => {
    if (!open || mobile || !inputRef.current) return undefined
    const place = () => {
      const rect = inputRef.current.getBoundingClientRect()
      const below = window.innerHeight - rect.bottom - 8
      const above = rect.top - 8
      const maxHeight = Math.min(320, Math.max(below, above))
      const height = Math.min(maxHeight, panelRef.current?.offsetHeight || maxHeight)
      const top = below >= height || below >= above ? rect.bottom + 4 : rect.top - 4 - height
      setPos({ top, left: rect.left, width: rect.width, maxHeight })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, mobile, shown.length])

  // Клик вне поля и списка закрывает список (на компьютере)
  useEffect(() => {
    if (!open || mobile) return undefined
    const onDown = (e) => {
      if (!panelRef.current?.contains(e.target) && !inputRef.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, mobile])

  // Панель на телефоне: фокус в поиск, прокрутка страницы заблокирована, Esc закрывает
  useEffect(() => {
    if (!open || !mobile) return undefined
    const field = inputRef.current
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const timer = setTimeout(() => sheetInputRef.current?.focus(), 0)
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.body.style.overflow = prevOverflow
      clearTimeout(timer)
      document.removeEventListener('keydown', onKey, true)
      field?.focus({ preventScroll: true })
    }
  }, [open, mobile])

  // Активный вариант всегда в зоне видимости
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) { setOpen(true); return }
      const count = shown.length
      if (!count) return
      setActive((i) => (e.key === 'ArrowDown' ? (i + 1) % count : (i - 1 + count) % count))
    } else if (e.key === 'Enter' && open && shown[active]) {
      e.preventDefault()
      choose(shown[active])
    } else if (e.key === 'Escape' && open) {
      e.stopPropagation()
      setOpen(false)
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  const activeId = open && shown[active] ? `${listId}-${active}` : undefined

  const list = (
    <ul ref={listRef} id={listId} role="listbox" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1">
      {shown.map((option, index) => (
        <li
          key={`${option.value}-${index}`}
          id={`${listId}-${index}`}
          data-index={index}
          role="option"
          aria-selected={index === active}
          // mousedown, а не click: иначе поле теряет фокус и список закрывается раньше выбора
          onMouseDown={(e) => { e.preventDefault(); choose(option) }}
          onMouseEnter={() => setActive(index)}
          className={cn(
            'flex min-h-11 cursor-pointer flex-col justify-center rounded-md px-3 py-2 text-sm sm:min-h-0',
            index === active && 'bg-surface-hover',
            option.label === value && 'font-semibold',
          )}
        >
          <span className="min-w-0 break-words text-fg"><Highlight text={option.label} query={search} /></span>
          {option.description && <span className="mt-0.5 min-w-0 break-words text-xs text-fg-subtle">{option.description}</span>}
        </li>
      ))}
      {showUseTyped && (
        <li role="option" aria-selected={false}
          onMouseDown={(e) => { e.preventDefault(); emit(typed); setOpen(false) }}
          className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-primary hover:bg-surface-hover">
          <Icon name="plus" size={16} />
          <span className="min-w-0 break-words">{t('ui.combobox.useTyped', { value: typed })}</span>
        </li>
      )}
      {!shown.length && !showUseTyped && <li className="px-3 py-4 text-center text-sm text-fg-subtle">{t('ui.combobox.noResults')}</li>}
      {matches.length > shown.length && (
        <li className="px-3 py-2 text-xs text-fg-subtle">{t('ui.combobox.more', { shown: shown.length, total: matches.length })}</li>
      )}
    </ul>
  )

  return (
    <div className={cn('relative min-w-0', className)}>
      <input
        ref={inputRef}
        {...fieldProps}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={mobile ? undefined : activeId}
        aria-autocomplete="list"
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        title={value || placeholder}
        // На телефоне поле только открывает панель поиска (свой список на весь экран)
        readOnly={mobile}
        onClick={() => (mobile ? openSheet() : setOpen(true))}
        onFocus={() => { if (!mobile) setOpen(true) }}
        onChange={(e) => { emit(e.target.value); setActive(0); setOpen(true) }}
        onKeyDown={mobile ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSheet() } } : onKeyDown}
        className={cn(
          'block min-h-10 w-full min-w-0 rounded-md border border-line-strong bg-surface py-2 pl-3 pr-16 text-sm text-fg transition-colors duration-150',
          'placeholder:text-fg-subtle hover:border-fg-subtle focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-focus/25',
          'disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-fg-subtle',
          'aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger/20',
          mobile ? 'cursor-pointer truncate' : 'cursor-text',
        )}
      />
      <div className="absolute inset-y-0 right-1 flex items-center gap-0.5">
        {value && !disabled && (
          <button type="button" aria-label={t('ui.combobox.clear')} title={t('ui.combobox.clear')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { onChange?.('', null); if (!mobile) inputRef.current?.focus() }}
            className="grid h-8 w-8 cursor-pointer place-items-center rounded-md text-fg-subtle hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
            <Icon name="x" size={16} />
          </button>
        )}
        <span className="pointer-events-none grid h-8 w-6 place-items-center text-fg-subtle" aria-hidden="true">
          <Icon name="chevron-down" size={16} className={cn('transition-transform', open && !mobile && 'rotate-180')} />
        </span>
      </div>

      {open && !mobile && createPortal(
        <div ref={panelRef}
          style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: pos?.width, maxHeight: pos?.maxHeight }}
          className="fixed z-popover flex min-w-[14rem] flex-col overflow-hidden rounded-lg border border-line bg-surface-raised shadow-3">
          {list}
        </div>,
        document.body,
      )}

      {open && mobile && createPortal(
        <div ref={panelRef} role="dialog" aria-modal="true" aria-label={sheetTitle || placeholder}
          className="fixed inset-0 z-popover flex flex-col bg-surface-raised">
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
            <button type="button" onClick={() => setOpen(false)} aria-label={t('ui.close')}
              className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-md text-fg-muted hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
              <Icon name="arrow-left" size={20} />
            </button>
            <p className="min-w-0 flex-1 truncate text-base font-semibold text-fg">{sheetTitle || placeholder}</p>
          </div>
          <div className="shrink-0 border-b border-line p-3">
            <div className="relative">
              <Icon name="search" size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
              <input
                ref={sheetInputRef}
                type="search"
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-activedescendant={activeId}
                aria-label={t('ui.combobox.search')}
                autoComplete="off"
                enterKeyHint="done"
                value={query}
                placeholder={t('ui.combobox.search')}
                onChange={(e) => { setQuery(e.target.value); setActive(0) }}
                onKeyDown={onKeyDown}
                className="block min-h-11 w-full min-w-0 rounded-md border border-line-strong bg-surface py-2 pl-10 pr-3 text-base text-fg placeholder:text-fg-subtle focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-focus/25"
              />
            </div>
          </div>
          {list}
        </div>,
        document.body,
      )}
    </div>
  )
}
