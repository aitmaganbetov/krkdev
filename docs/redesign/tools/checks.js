// Layout defect detector. Runs inside the page via page.evaluate(). Returns a list of issues.
() => {
  const TOL = 1
  const vw = window.innerWidth
  const vh = window.innerHeight
  const issues = []

  const sel = (el) => {
    if (!el || el.nodeType !== 1) return ''
    const parts = []
    let n = el
    for (let i = 0; n && n.nodeType === 1 && i < 4; i++, n = n.parentElement) {
      let s = n.tagName.toLowerCase()
      if (n.id) { s += '#' + n.id; parts.unshift(s); break }
      const cls = [...n.classList].filter((c) => !c.includes(':') && !c.includes('[') && !c.includes('/')).slice(0, 3)
      if (cls.length) s += '.' + cls.join('.')
      const p = n.parentElement
      if (p) {
        const sib = [...p.children].filter((c) => c.tagName === n.tagName)
        if (sib.length > 1) s += `:nth-of-type(${sib.indexOf(n) + 1})`
      }
      parts.unshift(s)
    }
    return parts.join(' > ')
  }
  const txt = (el) => (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60)

  const isVisible = (el) => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n)
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false
      if (cs.clipPath && cs.clipPath !== 'none' && n === el) return false
    }
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) return false
    // sr-only
    const cs = getComputedStyle(el)
    if (cs.position === 'absolute' && r.width <= 1 && r.height <= 1) return false
    return true
  }

  // Nearest ancestor that clips/scrolls content (for "inside scroll container" logic).
  const scrollParent = (el) => {
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n)
      if (/(auto|scroll)/.test(cs.overflowX + cs.overflowY)) return n
    }
    return null
  }
  const inFixedLayer = (el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      if (getComputedStyle(n).position === 'fixed') return n
    }
    return null
  }

  // ---- 1. Text boxes (precise rect of own text nodes) ----
  const textBoxes = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (t) => (t.nodeValue.trim().length ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  })
  const seen = new Map()
  while (walker.nextNode()) {
    const t = walker.currentNode
    const el = t.parentElement
    if (!el || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'OPTION'].includes(el.tagName)) continue
    if (!isVisible(el)) continue
    const range = document.createRange()
    range.selectNodeContents(t)
    for (const r of range.getClientRects()) {
      if (r.width < 1 || r.height < 1) continue
      if (!seen.has(el)) seen.set(el, [])
      seen.get(el).push(r)
    }
  }
  for (const [el, rects] of seen) {
    for (const r of rects) textBoxes.push({ el, r })
  }

  // Effective clip rect of an element (intersection with overflow-clipping ancestors).
  const clipRect = (el) => {
    let L = -Infinity, T = -Infinity, R = Infinity, B = Infinity
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n)
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        const r = n.getBoundingClientRect()
        L = Math.max(L, r.left); T = Math.max(T, r.top); R = Math.min(R, r.right); B = Math.min(B, r.bottom)
      }
      if (cs.position === 'fixed') break
    }
    return { L, T, R, B }
  }
  const visiblePart = (el, r) => {
    const c = clipRect(el)
    const L = Math.max(r.left, c.L), T = Math.max(r.top, c.T), R = Math.min(r.right, c.R), B = Math.min(r.bottom, c.B)
    return R - L > TOL && B - T > TOL ? { left: L, top: T, right: R, bottom: B } : null
  }
  // Which element is actually painted on top at a point (to skip text hidden under an opaque layer, e.g. modal backdrop).
  const topmostIs = (el, x, y) => {
    const h = document.elementFromPoint(x, y)
    return h && (h === el || el.contains(h) || h.contains(el))
  }

  const layerCache = new Map()
  const layerOf = (el) => {
    if (!layerCache.has(el)) layerCache.set(el, inFixedLayer(el))
    return layerCache.get(el)
  }
  const vis = textBoxes.map((b) => ({ ...b, v: visiblePart(b.el, b.r) })).filter((b) => b.v)
  for (let i = 0; i < vis.length; i++) {
    for (let j = i + 1; j < vis.length; j++) {
      const a = vis[i], b = vis[j]
      if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue
      if (layerOf(a.el) !== layerOf(b.el)) continue // text under a modal backdrop is not a collision
      const ox = Math.min(a.v.right, b.v.right) - Math.max(a.v.left, b.v.left)
      const oy = Math.min(a.v.bottom, b.v.bottom) - Math.max(a.v.top, b.v.top)
      if (ox > TOL && oy > TOL) {
        const cx = Math.max(a.v.left, b.v.left) + ox / 2, cy = Math.max(a.v.top, b.v.top) + oy / 2
        // only real collisions: both visible at intersection center is impossible, but if the top element is
        // one of the two, the other is painted under it -> visible overlap of glyphs.
        const top = document.elementFromPoint(cx, cy)
        if (!top) continue
        const aTop = a.el === top || a.el.contains(top), bTop = b.el === top || b.el.contains(top)
        if (!aTop && !bTop) continue // both hidden under a third layer (modal backdrop etc.)
        issues.push({
          type: 'text-overlap',
          selector: sel(a.el), other: sel(b.el),
          text: txt(a.el), otherText: txt(b.el),
          overlap: `${Math.round(ox)}x${Math.round(oy)}px`,
          rect: [Math.round(cx), Math.round(cy)],
        })
      }
    }
  }

  // ---- 2. Clipped / truncated content ----
  // 2a. Text glyphs cut by an overflow:hidden/clip ancestor (not a scroll container).
  const hiddenClip = (el) => {
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n)
      if (/(auto|scroll)/.test(cs.overflowX + cs.overflowY)) return null // intentional scroll area
      if (/(hidden|clip)/.test(cs.overflowX + cs.overflowY)) return n
      if (cs.position === 'fixed') return null
    }
    return null
  }
  const clippedEls = new Map()
  for (const { el, r } of textBoxes) {
    const c = hiddenClip(el)
    if (!c) continue
    const cr = c.getBoundingClientRect()
    const cut = Math.max(cr.left - r.left, r.right - cr.right, cr.top - r.top, r.bottom - cr.bottom)
    if (cut > 2) {
      const prev = clippedEls.get(el)
      if (!prev || prev.cut < cut) clippedEls.set(el, { cut, c })
    }
  }
  for (const [el, { cut, c }] of clippedEls) {
    const cs = getComputedStyle(el)
    const ellipsis = cs.textOverflow === 'ellipsis' || parseInt(cs.webkitLineClamp) > 0
    if (ellipsis) continue // reported below
    issues.push({ type: 'text-clipped', selector: sel(el), text: txt(el), size: `${Math.round(cut)}px cut by ${sel(c)}` })
  }
  // 2b. Ellipsis / line-clamp actually truncating
  for (const el of document.body.querySelectorAll('*')) {
    const cs = getComputedStyle(el)
    const clamp = parseInt(cs.webkitLineClamp) > 0
    if (cs.textOverflow !== 'ellipsis' && !clamp) continue
    if (!isVisible(el)) continue
    const cut = clamp ? el.scrollHeight > el.clientHeight + 3 : el.scrollWidth > el.clientWidth + TOL
    if (!cut) continue
    const hasTitle = !!(el.title || el.closest('[title]'))
    issues.push({ type: hasTitle ? 'ellipsis-with-title' : 'ellipsis-no-title', selector: sel(el), text: txt(el), size: `scroll ${el.scrollWidth} / client ${el.clientWidth}` })
  }
  // Form controls whose value/placeholder doesn't fit
  for (const el of document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=hidden]), select')) {
    if (!isVisible(el)) continue
    let label = ''
    if (el.tagName === 'SELECT') label = el.options[el.selectedIndex]?.text || ''
    else label = el.value || el.placeholder || ''
    if (!label) continue
    const cs = getComputedStyle(el)
    const c = document.createElement('canvas').getContext('2d')
    c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
    const need = c.measureText(label).width
    const avail = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
    if (need > avail + 2) {
      issues.push({ type: 'control-text-clipped', selector: sel(el), text: label.slice(0, 60), size: `need ${Math.round(need)}px / avail ${Math.round(avail)}px` })
    }
  }

  // 2d. Textareas whose text is cut mid-line (fixed rows, no auto-grow)
  for (const el of document.querySelectorAll('textarea')) {
    if (!isVisible(el) || !el.value) continue
    if (el.scrollHeight > el.clientHeight + 3) {
      issues.push({ type: 'textarea-content-hidden', selector: sel(el), text: el.value.slice(0, 60), size: `content ${el.scrollHeight}px / visible ${el.clientHeight}px` })
    }
  }

  // ---- 3. Out of viewport / out of parent ----
  for (const el of document.body.querySelectorAll('*')) {
    if (!isVisible(el)) continue
    const r = el.getBoundingClientRect()
    if (!scrollParent(el)) {
      const v = visiblePart(el, r)
      const offCanvas = v && (v.right <= TOL || v.left >= vw - TOL)
      if (v && !offCanvas && (v.right > vw + TOL || v.left < -TOL)) {
        const p = el.parentElement
        const pv = p && p !== document.body && visiblePart(p, p.getBoundingClientRect())
        if (!pv || !(pv.right > vw + TOL || pv.left < -TOL)) {
          issues.push({ type: 'out-of-viewport-x', selector: sel(el), text: txt(el), size: `left ${Math.round(v.left)} right ${Math.round(v.right)} vw ${vw}` })
        }
      }
    }
    // Overflow of the direct parent box when parent doesn't clip/scroll (visual spill)
    const p = el.parentElement
    if (p && p !== document.body && isVisible(p)) {
      const pcs = getComputedStyle(p), cs = getComputedStyle(el)
      if (pcs.overflowX === 'visible' && cs.position !== 'absolute' && cs.position !== 'fixed' && pcs.display !== 'contents') {
        const pr = p.getBoundingClientRect()
        const spill = r.right - pr.right
        if (spill > 2 && (el.innerText || '').trim()) {
          // Is the spilled part painted under another element (e.g. the neighbouring card)?
          let covered = null
          const x = Math.min(pr.right + Math.min(spill, 40) / 2, vw - 2)
          for (const y of [r.top + r.height / 2, r.top + 4, r.bottom - 4]) {
            if (x <= pr.right || y < 0 || y > vh) continue
            const top = document.elementFromPoint(x, y)
            if (top && !el.contains(top) && !top.contains(el) && top !== document.documentElement && layerOf(top) === layerOf(el)) { covered = top; break }
          }
          issues.push({
            type: covered && spill > 8 ? 'covered-by-neighbour' : 'spills-parent',
            selector: sel(el), text: txt(el),
            size: `+${Math.round(spill)}px past parent ${sel(p)}` + (covered ? ` · under ${sel(covered)}` : ''),
          })
        }
      }
    }
  }

  // ---- 4. Fixed layers (modals, drawers, popovers) ----
  for (const el of document.body.querySelectorAll('*')) {
    const cs = getComputedStyle(el)
    if (cs.position !== 'fixed' || !isVisible(el)) continue
    const r = el.getBoundingClientRect()
    if (r.width < 40 || r.height < 40) continue
    // dialog panel = first child with substantial size
    const panel = [...el.querySelectorAll(':scope > *')].find((c) => c.getBoundingClientRect().width > 100)
    if (panel) {
      const pr = panel.getBoundingClientRect()
      if (pr.right <= TOL || pr.left >= vw - TOL) continue // closed off-canvas drawer
      if (pr.bottom > vh + TOL || pr.top < -TOL || pr.right > vw + TOL || pr.left < -TOL) {
        const scrollable = /(auto|scroll)/.test(cs.overflowY)
        issues.push({
          type: scrollable ? 'modal-taller-than-viewport (outer scroll)' : 'modal-out-of-viewport',
          selector: sel(panel), text: txt(panel),
          size: `panel ${Math.round(pr.width)}x${Math.round(pr.height)} at top ${Math.round(pr.top)} / vp ${vw}x${vh}`,
        })
      }
    }
  }

  // ---- 5. Page-level horizontal scroll ----
  const docW = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)
  if (docW > vw + TOL) issues.push({ type: 'body-horizontal-scroll', selector: 'html', size: `scrollWidth ${docW} > ${vw}` })
  // Main content area horizontal scroll (layout uses main with overflow-auto)
  const main = document.querySelector('main')
  if (main && main.scrollWidth > main.clientWidth + TOL) {
    issues.push({ type: 'main-horizontal-scroll', selector: 'main', size: `scrollWidth ${main.scrollWidth} > ${main.clientWidth}` })
  }

  // ---- 6. Small tap targets on mobile (informational) ----
  if (vw < 768) {
    for (const el of document.querySelectorAll('button, a[href], [role=button], input, select')) {
      if (!isVisible(el)) continue
      const r = el.getBoundingClientRect()
      if (r.height < 32 || r.width < 32) issues.push({ type: 'small-tap-target', selector: sel(el), text: txt(el) || el.getAttribute('aria-label') || '', size: `${Math.round(r.width)}x${Math.round(r.height)}` })
    }
  }

  // dedupe
  const key = (i) => i.type + '|' + i.selector + '|' + (i.other || '')
  const out = new Map()
  for (const i of issues) if (!out.has(key(i))) out.set(key(i), i)
  return [...out.values()]
}
