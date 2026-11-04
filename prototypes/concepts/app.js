/* Four ways to show the work. Vanilla JS + CSS transforms only (no WebGL),
   so it stays smooth on phones; every shoot in window.LOSPIKIR is shown
   automatically — a new gallery needs nothing extra. */
;(() => {
  const G = window.LOSPIKIR || []
  const root = document.getElementById('app')
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  const el = (tag, cls, html) => {
    const n = document.createElement(tag)
    if (cls) n.className = cls
    if (html != null) n.innerHTML = html
    return n
  }
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  const meta = (g) => [g.kind, g.city, g.year].filter(Boolean).join(' · ')
  const pad2 = (n) => String(n).padStart(2, '0')
  const CHEV = (d) => `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="${d > 0 ? 'M9 5l7 7-7 7' : 'M15 5l-7 7 7 7'}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  const noCopy = (img) => {
    img.draggable = false
    img.addEventListener('contextmenu', (e) => e.preventDefault())
    return img
  }
  const loadImg = (src, cls) => {
    const i = noCopy(new Image())
    if (cls) i.className = cls
    i.decoding = 'async'
    i.src = src
    return i
  }
  /** One step per wheel flick (trackpads keep sending momentum). */
  function wheelSteps(target, onStep, { axis = 'y', threshold = 40, quiet = 520 } = {}) {
    let acc = 0
    let last = 0
    let until = 0
    const h = (e) => {
      e.preventDefault()
      const now = performance.now()
      if (now - last > 220) acc = 0
      last = now
      if (now < until) {
        until = now + 160
        return
      }
      const d = axis === 'any' ? (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) : e.deltaY
      acc += d
      if (Math.abs(acc) > threshold) {
        onStep(acc > 0 ? 1 : -1)
        acc = 0
        until = now + quiet
      }
    }
    target.addEventListener('wheel', h, { passive: false })
    return () => target.removeEventListener('wheel', h)
  }
  function swipe(target, onX, onY) {
    let x0 = null
    let y0 = null
    const s = (e) => {
      x0 = e.touches[0].clientX
      y0 = e.touches[0].clientY
    }
    const t = (e) => {
      if (x0 == null) return
      const dx = e.changedTouches[0].clientX - x0
      const dy = e.changedTouches[0].clientY - y0
      x0 = null
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) onX?.(dx < 0 ? 1 : -1)
      else if (Math.abs(dy) > 50) onY?.(dy < 0 ? 1 : -1)
    }
    target.addEventListener('touchstart', s, { passive: true })
    target.addEventListener('touchend', t, { passive: true })
    return () => {
      target.removeEventListener('touchstart', s)
      target.removeEventListener('touchend', t)
    }
  }
  function keys(map) {
    const h = (e) => {
      const f = map[e.key]
      if (!f) return
      e.preventDefault()
      f()
    }
    addEventListener('keydown', h)
    return () => removeEventListener('keydown', h)
  }
  function lightbox() {
    const lb = el('div', 'lightbox')
    const img = loadImg('', '')
    const close = el('button', 'pill', 'Close ✕')
    close.type = 'button'
    lb.append(img, close)
    document.body.append(lb)
    const hide = () => lb.classList.remove('open')
    close.onclick = hide
    lb.onclick = (e) => e.target === lb && hide()
    return {
      show(src, alt) {
        img.src = src
        img.alt = alt || ''
        lb.classList.add('open')
      },
      hide,
      remove: () => lb.remove(),
    }
  }

  /* =======================================================================
     1 · FILM
     ======================================================================= */
  function film() {
    const v = el('div', 'view film')
    const screen = el('div', 'film__screen film__bars')
    const card = el('div', 'film__card')
    const hud = el('div', 'film__hud')
    const prog = el('div', 'film__progress', '<i></i>')
    const now = el('p', 'film__now label')
    const play = el('button', 'pill', 'Pause')
    const epsBtn = el('button', 'pill', 'Episodes')
    play.type = epsBtn.type = 'button'
    hud.append(prog, now, play, epsBtn)
    const prev = el('button', 'film__nav film__nav--prev', CHEV(-1))
    const next = el('button', 'film__nav film__nav--next', CHEV(1))
    prev.type = next.type = 'button'
    prev.setAttribute('aria-label', 'Previous shot')
    next.setAttribute('aria-label', 'Next shot')
    const eps = el('div', 'episodes')
    G.forEach((g, i) => {
      const b = el('button', 'ep', `<img alt="" loading="lazy" src="${g.photos[0]?.thumb}"><span>${pad2(i + 1)} · ${esc(g.title)}</span>`)
      b.type = 'button'
      b.onclick = () => {
        eps.classList.remove('open')
        goShoot(i)
      }
      eps.append(b)
    })
    v.append(screen, card, prev, next, eps, hud)
    root.append(v)

    // a shoot's shots: landscapes alone, upright photos in pairs
    const shotsOf = (g) => {
      const out = []
      const ph = g.photos
      for (let i = 0; i < ph.length; i++) {
        const p = ph[i]
        if (p.r >= 1.15) out.push({ kind: 'wide', photos: [p] })
        else if (ph[i + 1] && ph[i + 1].r < 1.15 && innerWidth > 560) {
          out.push({ kind: 'pair', photos: [p, ph[i + 1]] })
          i++
        } else out.push({ kind: 'single', photos: [p] })
      }
      return out
    }
    let gi = 0
    let si = -1 // -1 = the title card
    let shots = shotsOf(G[0])
    let layer = null
    let playing = !reduced
    let t0 = performance.now()
    const DUR = 5.2
    const CARD = 2.6

    function showCard() {
      const g = G[gi]
      card.innerHTML = `<p class="label film__chapter">Chapter ${pad2(gi + 1)} / ${pad2(G.length)}</p>
        <h2 class="display">${esc(g.title)
          .split(' ')
          .map((w, k) => `<span style="transition-delay:${0.08 * k}s">${w}</span>`)
          .join(' ')}</h2>
        <p class="film__meta">${esc(meta(g))} · ${g.photos.length} photos</p>`
      requestAnimationFrame(() => card.classList.add('on'))
      if (layer) {
        const old = layer
        old.classList.remove('on')
        setTimeout(() => old.remove(), 1200)
        layer = null
      }
      // the first shot loads behind the card
      shots[0]?.photos.forEach((p) => loadImg(p.src))
    }
    function showShot() {
      card.classList.remove('on')
      const s = shots[si]
      const n = el('div', `shot shot--${s.kind}${s.kind === 'wide' ? (si % 3 === 1 ? ' pan-l' : si % 3 === 2 ? ' pan-r' : '') : ''}`)
      s.photos.forEach((p) => n.append(loadImg(p.src)))
      screen.append(n)
      const old = layer
      layer = n
      requestAnimationFrame(() => requestAnimationFrame(() => n.classList.add('on')))
      if (old) {
        old.classList.remove('on')
        setTimeout(() => old.remove(), 1200)
      }
      shots[si + 1]?.photos.forEach((p) => loadImg(p.src))
    }
    function render() {
      const g = G[gi]
      now.innerHTML = `<b>${esc(g.title)}</b> &nbsp;·&nbsp; ${esc(meta(g))}${si >= 0 ? ` &nbsp;·&nbsp; ${pad2(si + 1)} / ${pad2(shots.length)}` : ''}`
      ;[...eps.children].forEach((b, k) => b.classList.toggle('is-on', k === gi))
      if (si < 0) showCard()
      else showShot()
      t0 = performance.now()
    }
    function step(d) {
      if (d > 0) {
        if (si < shots.length - 1) si++
        else {
          gi = (gi + 1) % G.length
          shots = shotsOf(G[gi])
          si = -1
        }
      } else if (si > -1) si--
      else {
        gi = (gi - 1 + G.length) % G.length
        shots = shotsOf(G[gi])
        si = shots.length - 1
      }
      render()
    }
    function goShoot(i) {
      gi = i
      shots = shotsOf(G[gi])
      si = -1
      render()
    }
    render()
    play.onclick = () => {
      playing = !playing
      play.textContent = playing ? 'Pause' : 'Play'
      t0 = performance.now()
    }
    epsBtn.onclick = () => eps.classList.toggle('open')
    prev.onclick = () => step(-1)
    next.onclick = () => step(1)
    const bar = prog.firstChild
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const dur = si < 0 ? CARD : DUR
      const k = playing ? Math.min(1, (performance.now() - t0) / 1000 / dur) : (performance.now() - t0) * 0
      bar.style.width = `${(playing ? k : 0) * 100}%`
      if (playing && k >= 1) step(1)
    }
    raf = requestAnimationFrame(tick)
    const off = [
      wheelSteps(v, (d) => step(d), { axis: 'any' }),
      swipe(v, step, step),
      keys({ ArrowRight: () => step(1), ArrowDown: () => step(1), ArrowLeft: () => step(-1), ArrowUp: () => step(-1), ' ': () => play.onclick() }),
    ]
    return () => {
      cancelAnimationFrame(raf)
      off.forEach((f) => f())
      v.remove()
    }
  }

  /* =======================================================================
     2 · CANVAS
     ======================================================================= */
  function canvas() {
    const v = el('div', 'view canvas')
    const world = el('div', 'canvas__world')
    const vig = el('div', 'canvas__vignette')
    const hint = el('p', 'canvas__hint hint', 'Drag or scroll to wander · click a photo')
    v.append(world, vig, hint)
    root.append(v)

    // one block of every photo in balanced columns; the block repeats forever
    const phone = innerWidth < 760
    const COLW = phone ? 150 : 250
    const GAP = phone ? 10 : 18
    const COLS = phone ? 7 : 9
    const all = []
    G.forEach((g, gi) => g.photos.forEach((p, pi) => all.push({ g, gi, p, pi })))
    // interleave shoots so neighbours differ
    all.sort((a, b) => a.pi - b.pi || a.gi - b.gi)
    const colH = new Array(COLS).fill(0)
    const items = all.map((it) => {
      let c = 0
      for (let k = 1; k < COLS; k++) if (colH[k] < colH[c]) c = k
      const w = COLW
      const h = Math.round(Math.min(COLW * 1.6, Math.max(COLW * 0.6, COLW / it.p.r)))
      const x = c * (COLW + GAP)
      const y = colH[c] + (c % 2 ? COLW * 0.35 : 0) * (colH[c] === 0 ? 1 : 0)
      colH[c] = y + h + GAP
      return { ...it, x, y, w, h, depth: 0.9 + ((it.pi * 37 + it.gi * 11) % 7) * 0.035 }
    })
    const BW = COLS * (COLW + GAP)
    const BH = Math.max(...colH)

    let cx = -BW / 2 + innerWidth / 2
    let cy = -BH / 3
    let vx = 0
    let vy = 0
    const nodes = new Map()
    const pool = []
    function nodeFor(key, it) {
      let n = nodes.get(key)
      if (n) return n
      n = pool.pop()
      if (!n) {
        n = el('button', 'tile')
        n.type = 'button'
        const img = loadImg('', '')
        img.onload = () => img.classList.add('ok')
        n.append(img, el('span', 'tile__tag'))
        n.addEventListener('click', () => {
          if (moved > 6) return
          openFocus(n._it, n)
        })
      }
      n._it = it
      const img = n.firstChild
      if (img.dataset.src !== it.p.thumb) {
        img.classList.remove('ok')
        img.dataset.src = it.p.thumb
        img.src = it.p.thumb
        img.alt = `${it.g.title} — photo ${it.pi + 1}`
      }
      n.lastChild.textContent = it.g.title
      n.style.width = it.w + 'px'
      n.style.height = it.h + 'px'
      world.append(n)
      nodes.set(key, n)
      return n
    }
    function draw() {
      const W = innerWidth
      const H = innerHeight
      const seen = new Set()
      const bx0 = Math.floor((-cx - BW) / BW)
      const bx1 = Math.floor((-cx + W) / BW)
      const by0 = Math.floor((-cy - BH) / BH)
      const by1 = Math.floor((-cy + H) / BH)
      for (let bx = bx0; bx <= bx1; bx++)
        for (let by = by0; by <= by1; by++)
          items.forEach((it, i) => {
            // a little depth: far tiles drift slower than near ones
            const x = bx * BW + it.x + cx + (it.depth - 1) * cx * 0.12
            const y = by * BH + it.y + cy + (it.depth - 1) * cy * 0.12
            if (x + it.w < -80 || x > W + 80 || y + it.h < -80 || y > H + 80) return
            const key = `${bx},${by},${i}`
            seen.add(key)
            const n = nodeFor(key, it)
            n.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`
          })
      for (const [k, n] of nodes)
        if (!seen.has(k)) {
          n.remove()
          nodes.delete(k)
          pool.push(n)
        }
    }
    let raf = 0
    let dragging = false
    let moved = 0
    let lx = 0
    let ly = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      if (!dragging) {
        vx *= 0.93
        vy *= 0.93
        if (Math.abs(vx) < 0.02 && Math.abs(vy) < 0.02) {
          vx = vy = 0
          return
        }
        cx += vx
        cy += vy
      }
      draw()
    }
    draw()
    raf = requestAnimationFrame(loop)
    const down = (e) => {
      if (focusOpen) return
      dragging = true
      moved = 0
      lx = e.clientX
      ly = e.clientY
      vx = vy = 0
      v.classList.add('dragging')
    }
    const move = (e) => {
      if (!dragging) return
      const dx = e.clientX - lx
      const dy = e.clientY - ly
      moved += Math.abs(dx) + Math.abs(dy)
      cx += dx
      cy += dy
      vx = dx
      vy = dy
      lx = e.clientX
      ly = e.clientY
      draw()
    }
    const up = () => {
      dragging = false
      v.classList.remove('dragging')
    }
    const wheel = (e) => {
      e.preventDefault()
      if (focusOpen) return
      vx -= e.deltaX * 0.12
      vy -= e.deltaY * 0.12
    }
    v.addEventListener('pointerdown', down)
    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
    v.addEventListener('wheel', wheel, { passive: false })

    // the shoot, opened: the photo flies to the middle, its shoot below it
    let focusOpen = false
    const focus = el('div', 'focus')
    const body = el('div', 'focus__body')
    const main = el('div', 'focus__main')
    const info = el('div', 'focus__info')
    const strip = el('div', 'focus__strip')
    const close = el('button', 'pill focus__close', 'Back to the wall ✕')
    close.type = 'button'
    body.append(main, info, strip)
    focus.append(body, close)
    document.body.append(focus)
    function openFocus(it, tileNode) {
      focusOpen = true
      const r = tileNode.getBoundingClientRect()
      const fly = loadImg(it.p.thumb, 'focus__fly')
      Object.assign(fly.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' })
      document.body.append(fly)
      const W = innerWidth
      const H = innerHeight
      const maxW = W - 2 * 28
      const maxH = H - 84 - 120
      const w = Math.min(maxW, maxH * it.p.r)
      const h = w / it.p.r
      requestAnimationFrame(() =>
        Object.assign(fly.style, { left: (W - w) / 2 + 'px', top: 84 + (maxH - h) / 2 + 'px', width: w + 'px', height: h + 'px', borderRadius: '4px' })
      )
      focus.classList.add('open')
      const set = (k) => {
        main.innerHTML = ''
        const big = loadImg(it.g.photos[k].src)
        big.alt = `${it.g.title} — photo ${k + 1}`
        main.append(big)
        ;[...strip.children].forEach((b, j) => b.classList.toggle('is-on', j === k))
      }
      info.innerHTML = `<p class="label" style="color:var(--bronze)">${pad2(it.gi + 1)} / ${pad2(G.length)}</p><h2 class="display">${esc(it.g.title)}</h2><p>${esc(meta(it.g))} · ${it.g.photos.length} photos</p>`
      strip.innerHTML = ''
      it.g.photos.forEach((p, k) => {
        const b = el('button')
        b.type = 'button'
        b.append(loadImg(p.thumb))
        b.onclick = () => set(k)
        strip.append(b)
      })
      set(it.pi)
      setTimeout(() => fly.remove(), 900)
    }
    function closeFocus() {
      focusOpen = false
      focus.classList.remove('open')
    }
    close.onclick = closeFocus
    const offK = keys({ Escape: closeFocus })
    const onResize = () => draw()
    addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(raf)
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', up)
      removeEventListener('resize', onResize)
      offK()
      focus.remove()
      v.remove()
    }
  }

  /* =======================================================================
     3 · CAROUSEL
     ======================================================================= */
  function carousel() {
    const v = el('div', 'view carousel')
    const wrap = el('div', 'ring-wrap')
    const title = el('div', 'carousel__title')
    const list = el('nav', 'shoots')
    list.setAttribute('aria-label', 'Shoots')
    const hint = el('p', 'carousel__hint hint', 'Scroll to turn · ↑ ↓ next shoot · click to view')
    v.append(wrap, title, list, hint)
    root.append(v)
    const lb = lightbox()
    G.forEach((g, i) => {
      const b = el('button', '', `${pad2(i + 1)} ${esc(g.title)}`)
      b.type = 'button'
      b.onclick = () => goShoot(i)
      list.append(b)
    })

    let gi = 0
    let ring = null
    let cards = []
    let angle = 0 // degrees, target
    let shown = 0 // degrees, animated
    let step = 30
    let R = 600
    let front = 0
    function build() {
      const g = G[gi]
      const H = Math.min(innerHeight * 0.46, 520)
      const widths = g.photos.map((p) => H * Math.min(1.6, Math.max(0.62, p.r)))
      const gap = H * 0.18
      const circ = widths.reduce((a, b) => a + b + gap, 0)
      R = Math.max(circ / (2 * Math.PI), innerWidth < 760 ? 260 : 420)
      // angles from the arc each card takes up
      const angles = []
      let acc = 0
      widths.forEach((w) => {
        angles.push(acc + ((w + gap) / 2 / (2 * Math.PI * R)) * 360)
        acc += ((w + gap) / (2 * Math.PI * R)) * 360
      })
      const n = el('div', 'ring')
      cards = g.photos.map((p, k) => {
        const c = el('div', 'card3')
        const w = widths[k]
        Object.assign(c.style, { width: w + 'px', height: H + 'px', marginLeft: -w / 2 + 'px', marginTop: -H / 2 + 'px' })
        c.style.transform = `rotateY(${angles[k]}deg) translateZ(${R}px)`
        const img = loadImg(p.thumb)
        img.alt = `${g.title} — photo ${k + 1}`
        const floor = el('div', 'card3__floor')
        floor.style.backgroundImage = `url("${p.thumb}")`
        const shade = el('div', 'card3__shade')
        c.append(img, floor, shade)
        c.onclick = () => {
          const target = -angles[k]
          if (Math.abs(norm(target - angle)) < 2) lb.show(p.src, img.alt)
          else angle = angle + norm(target - angle)
        }
        n.append(c)
        return { c, img, shade, a: angles[k], p, upgraded: false }
      })
      step = 360 / g.photos.length
      angle = shown = -angles[0]
      front = 0
      title.innerHTML = `<p class="label" style="color:var(--bronze)">${pad2(gi + 1)} / ${pad2(G.length)}</p><h2 class="display">${esc(g.title)}</h2><p>${esc(meta(g))}</p><p class="carousel__count label"></p>`
      ;[...list.children].forEach((b, k) => b.classList.toggle('is-on', k === gi))
      return n
    }
    const norm = (d) => ((((d + 180) % 360) + 360) % 360) - 180
    function goShoot(i, dir = i > gi ? 1 : -1) {
      gi = (i + G.length) % G.length
      const old = ring
      if (old) {
        old.style.transition = 'transform 0.8s cubic-bezier(.55,0,.75,.4), opacity 0.6s ease'
        old.style.opacity = '0'
        old.style.transform += ` translateY(${dir * -40}vh)`
        setTimeout(() => old.remove(), 850)
      }
      ring = build()
      ring.dataset.anim = '1'
      ring.style.opacity = '0'
      ring.style.transform = `translateZ(${-R}px) rotateY(${shown}deg) translateY(${dir * 40}vh)`
      wrap.append(ring)
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          ring.style.transition = 'transform 0.9s cubic-bezier(.16,1,.3,1), opacity 0.7s ease'
          ring.style.opacity = '1'
          ring.style.transform = `translateZ(${-R}px) rotateY(${shown}deg)`
          const r = ring
          setTimeout(() => {
            r.style.transition = 'none'
            delete r.dataset.anim
          }, 950)
        })
      )
    }
    let raf = 0
    let auto = !reduced
    let lastInput = performance.now()
    const loop = () => {
      raf = requestAnimationFrame(loop)
      if (!ring) return
      if (auto && performance.now() - lastInput > 4500) turn(1)
      shown += (angle - shown) * 0.08
      if (!ring.dataset.anim) ring.style.transform = `translateZ(${-R}px) rotateY(${shown}deg)`
      // the front photo is lit and sharp; the others fall back into shade
      let best = 999
      let nearest = 0
      cards.forEach((k, i) => {
        const d = Math.abs(norm(k.a + shown))
        if (d < best) {
          best = d
          nearest = i
        }
        k.shade.style.opacity = Math.min(0.7, d / 90).toFixed(3)
        if (!k.upgraded && d < 40) {
          k.upgraded = true
          const hi = loadImg(k.p.src)
          hi.onload = () => (k.img.src = k.p.src)
        }
      })
      const cnt = title.querySelector('.carousel__count')
      if (cnt) cnt.textContent = `${pad2(nearest + 1)} / ${pad2(cards.length)}`
    }
    goShoot(0)
    raf = requestAnimationFrame(loop)
    // turn to the next card (cards are spaced by their widths, so step to its angle)
    const turn = (d) => {
      lastInput = performance.now()
      const k = (front + d + cards.length) % cards.length
      angle = angle + norm(-cards[k].a - angle)
      front = k
    }
    const off = [
      wheelSteps(v, (d) => turn(d), { axis: 'any', threshold: 30, quiet: 260 }),
      swipe(v, turn, (d) => goShoot(gi + d, d)),
      keys({ ArrowRight: () => turn(1), ArrowLeft: () => turn(-1), ArrowDown: () => goShoot(gi + 1, 1), ArrowUp: () => goShoot(gi - 1, -1), Escape: () => lb.hide() }),
    ]
    // drag to turn
    let dx0 = null
    const pd = (e) => (dx0 = e.clientX)
    const pm = (e) => {
      if (dx0 == null) return
      lastInput = performance.now()
      angle += (e.clientX - dx0) * 0.12
      dx0 = e.clientX
    }
    const pu = () => {
      if (dx0 == null) return
      dx0 = null
      // settle on the card nearest the front
      let k = 0
      let best = 999
      cards.forEach((c, i) => {
        const d = Math.abs(norm(c.a + angle))
        if (d < best) {
          best = d
          k = i
        }
      })
      angle = angle + norm(-cards[k].a - angle)
      front = k
    }
    v.addEventListener('pointerdown', pd)
    addEventListener('pointermove', pm)
    addEventListener('pointerup', pu)
    return () => {
      cancelAnimationFrame(raf)
      off.forEach((f) => f())
      removeEventListener('pointermove', pm)
      removeEventListener('pointerup', pu)
      lb.remove()
      v.remove()
    }
  }

  /* =======================================================================
     4 · EDITORIAL
     ======================================================================= */
  function editorial() {
    document.body.classList.remove('locked')
    const v = el('div', 'view--scroll ed')
    const lb = lightbox()
    const intro = el('header', 'ed__intro')
    intro.innerHTML = `<p class="label" style="color:var(--dim-2)">Portrait · Pre-wedding · Graduation · Events — Netherlands</p>
      <img src="logo-bone.png" alt="Lospikir">
      <p>I'm Wilson, a photographer based in the Netherlands. Scroll through the shoots — each one a chapter.</p>
      <ul class="ed__index">${G.map((g, i) => `<li><a href="#" data-ch="${i}">${pad2(i + 1)} ${esc(g.title)}</a></li>`).join('')}</ul>`
    v.append(intro)
    const frames = []
    const frame = (p, g, k, big) => {
      const f = el('div', 'frame')
      f.style.aspectRatio = big ? '' : `${p.r}`
      const img = noCopy(new Image())
      img.loading = 'lazy'
      img.decoding = 'async'
      img.alt = `${g.title} — photo ${k + 1}`
      img.onload = () => img.classList.add('ok')
      img.src = big || p.r < 1 ? p.src : p.thumb
      f.append(img)
      f.onclick = () => lb.show(p.src, img.alt)
      frames.push({ f, img })
      return f
    }
    const chapters = []
    G.forEach((g, gi) => {
      const ch = el('section', 'chapter')
      ch.innerHTML = `<div class="chapter__head"><p class="label chapter__num">Chapter ${pad2(gi + 1)} / ${pad2(G.length)}</p><h2 class="display">${esc(g.title)}</h2><p>${esc(meta(g))} · ${g.photos.length} photos</p></div>`
      // lay the photos out like a magazine: full-bleed, pairs, offsets, threes
      const ph = g.photos
      let i = 0
      let pattern = 0
      while (i < ph.length) {
        const s = el('div', 'spread')
        const p = ph[i]
        if (p.r >= 1.15 && pattern % 4 !== 3) {
          s.classList.add('spread--full')
          s.append(frame(p, g, i, true))
          i += 1
        } else if (pattern % 4 === 1 && ph[i + 1]) {
          s.classList.add('spread--pair')
          s.append(frame(ph[i], g, i), frame(ph[i + 1], g, i + 1))
          i += 2
        } else if (pattern % 4 === 3 && ph[i + 2]) {
          s.classList.add('spread--three')
          s.append(frame(ph[i], g, i), frame(ph[i + 1], g, i + 1), frame(ph[i + 2], g, i + 2))
          i += 3
        } else {
          s.classList.add('spread--offset')
          if (pattern % 2) s.classList.add('flip')
          s.append(frame(p, g, i))
          i += 1
        }
        const cap = el('p', 'spread__cap', `${pad2(Math.min(i, ph.length))} / ${pad2(ph.length)}`)
        s.append(cap)
        ch.append(s)
        pattern++
      }
      chapters.push(ch)
      v.append(ch)
    })
    const end = el('section', 'ed__end', `<h2 class="display">Let's find<br>your light</h2><p class="hint" style="margin-top:18px">Check your date →</p>`)
    v.append(end)
    root.append(v)
    intro.querySelectorAll('[data-ch]').forEach((a) =>
      a.addEventListener('click', (e) => {
        e.preventDefault()
        chapters[+a.dataset.ch].scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' })
      })
    )
    // parallax: each photo drifts inside its frame as you scroll past
    const live = new Set()
    const io = new IntersectionObserver((es) => es.forEach((e) => (e.isIntersecting ? live.add(e.target) : live.delete(e.target))), { rootMargin: '10% 0px' })
    frames.forEach(({ f }) => io.observe(f))
    let raf = 0
    const H = () => innerHeight
    const loop = () => {
      raf = requestAnimationFrame(loop)
      if (reduced) return
      live.forEach((f) => {
        const r = f.getBoundingClientRect()
        const k = (r.top + r.height / 2 - H() / 2) / (H() + r.height)
        f.firstChild.style.transform = `translate3d(0, ${(-k * 12).toFixed(2)}%, 0)`
      })
    }
    raf = requestAnimationFrame(loop)
    scrollTo(0, 0)
    return () => {
      cancelAnimationFrame(raf)
      io.disconnect()
      lb.remove()
      v.remove()
      document.body.classList.add('locked')
    }
  }

  /* --- the switcher ----------------------------------------------------- */
  const CONCEPTS = [
    ['film', '1 · Cinematic film', film],
    ['canvas', '2 · Infinite canvas', canvas],
    ['carousel', '3 · 3D carousel', carousel],
    ['editorial', '4 · Editorial story', editorial],
  ]
  const bar = el('header', 'bar')
  bar.innerHTML = `<img class="bar__logo" src="logo-bone.png" alt="Lospikir">`
  const tabs = el('nav', 'tabs')
  tabs.setAttribute('role', 'tablist')
  tabs.setAttribute('aria-label', 'Concepts')
  CONCEPTS.forEach(([id, label]) => {
    const t = el('button', 'tab label', label)
    t.type = 'button'
    t.setAttribute('role', 'tab')
    t.dataset.id = id
    t.onclick = () => {
      location.hash = id
    }
    tabs.append(t)
  })
  bar.append(tabs, el('span', 'bar__spacer'))
  document.body.append(bar)
  let unmount = null
  function route() {
    const id = (location.hash || '#film').slice(1)
    const c = CONCEPTS.find((x) => x[0] === id) || CONCEPTS[0]
    unmount?.()
    document.body.classList.add('locked')
    ;[...tabs.children].forEach((t) => t.setAttribute('aria-selected', String(t.dataset.id === c[0])))
    unmount = c[2]()
  }
  addEventListener('hashchange', route)
  route()
})()
