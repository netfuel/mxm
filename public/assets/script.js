/* MarceauxMarceaux videos
   A 3D sphere of video cards (adapted from MWG 107) you spin by dragging, swiping or scrolling,
   plus a FLIP-expanding fullscreen player. */
window.addEventListener('DOMContentLoaded', () => {
    gsap.registerPlugin(Observer)

    const VIDEOS = window.VIDEOS || []
    const BASE = (window.MEDIA_BASE || 'media/').replace(/\/?$/, '/')
    const url = (v, file) => BASE + encodeURIComponent(v.media) + '/' + file
    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
    const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches
    const player = { open: false, index: -1, busy: false, card: null }
    let previewing = null, hovered = null

    /* ---------- Build cards: each video appears 4× so the sphere reads as full ---------- */
    const root = document.querySelector('.mwg_effect107')
    const sphere = root.querySelector('.sphere')
    const sphereContainer = root.querySelector('.sphere-container')
    const COPIES = 4
    const items = []
    for (let k = 0; k < VIDEOS.length * COPIES; k++) items.push(k % VIDEOS.length)

    sphere.innerHTML = items.map((i, k) => {
        const v = VIDEOS[i], dup = k >= VIDEOS.length
        return `
        <li class="card" data-i="${i}" data-k="${k}"${dup ? ' aria-hidden="true"' : ''}>
            <button class="card__btn" type="button"${dup ? ' tabindex="-1"' : ''} aria-label="Play ${esc(v.artist)}: ${esc(v.title)}">
                <span class="card__media">
                    <img src="${url(v, 'thumb.jpg')}" alt="" decoding="async" width="640" height="360" draggable="false">
                    <video muted loop playsinline preload="none" aria-hidden="true" tabindex="-1"></video>
                    <span class="card__play" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z"/></svg></span>
                </span>
            </button>
        </li>`
    }).join('')
    const cards = [...sphere.querySelectorAll('.card')]
    const total = cards.length

    /* ---------- Sphere geometry (Fibonacci spiral) ---------- */
    const goldenAngle = Math.PI * (3 - Math.sqrt(5))
    let radius = 1000
    const positions = cards.map((_, k) => {
        const y = 1 - (2 * k) / (total - 1 || 1)
        const phi = Math.acos(y) - Math.PI / 2
        const theta = (k * goldenAngle) % (2 * Math.PI)
        return { x: Math.cos(phi) * Math.cos(theta), y: Math.sin(phi), z: Math.cos(phi) * Math.sin(theta) }
    })

    // Sphere orientation as a 3×3 row-major matrix
    const m = [1, 0, 0, 0, 1, 0, 0, 0, 1], mTmp = new Array(9).fill(0), R = new Array(9).fill(0)
    function premultiply3x3(left) {
        for (let i = 0; i < 3; i++) {
            const a = left[i * 3], b = left[i * 3 + 1], c = left[i * 3 + 2]
            for (let j = 0; j < 3; j++) mTmp[i * 3 + j] = a * m[j] + b * m[3 + j] + c * m[6 + j]
        }
        for (let k = 0; k < 9; k++) m[k] = mTmp[k]
    }
    function axisAngleMatrix(ax, ay, az, angle) {
        const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c
        return [t * ax * ax + c, t * ax * ay - s * az, t * ax * az + s * ay,
                t * ax * ay + s * az, t * ay * ay + c, t * ay * az - s * ax,
                t * ax * az - s * ay, t * ay * az + s * ax, t * az * az + c]
    }
    // Tangent-plane basis: forward = sphere normal, up ≈ screen vertical
    function orientationMatrix(fx, fy, fz) {
        let ux = 0, uy = -1, uz = 0
        let rx = uy * fz - uz * fy, ry = uz * fx - ux * fz, rz = ux * fy - uy * fx
        let len = Math.hypot(rx, ry, rz)
        if (len < 1e-6) { ux = 0; uy = 0; uz = 1; rx = uy * fz - uz * fy; ry = uz * fx - ux * fz; rz = ux * fy - uy * fx; len = Math.hypot(rx, ry, rz) }
        rx /= len; ry /= len; rz /= len
        const ux2 = fy * rz - fz * ry, uy2 = fz * rx - fx * rz, uz2 = fx * ry - fy * rx
        return [rx, -ux2, fx, ry, -uy2, fy, rz, -uz2, fz]
    }
    function transformedPosition(k) {
        const p = positions[k]
        return [m[0] * p.x + m[1] * p.y + m[2] * p.z, m[3] * p.x + m[4] * p.y + m[5] * p.z, m[6] * p.x + m[7] * p.y + m[8] * p.z]
    }
    function findClosestIndex() {
        let best = 0, bestD = Infinity
        for (let k = 0; k < total; k++) {
            const [x, y, z] = transformedPosition(k)
            if (z <= 0) continue
            const d = x * x + y * y
            if (d < bestD) { bestD = d; best = k }
        }
        return best
    }
    function render() {
        cards.forEach((card, k) => {
            const [x, y, z] = transformedPosition(k)
            const len = Math.hypot(x, y, z) || 1
            const r = orientationMatrix(x / len, -y / len, z / len)
            card.style.transform = `translate3d(${x * radius}px, ${-y * radius}px, ${z * radius}px) matrix3d(${r[0]},${r[3]},${r[6]},0,${r[1]},${r[4]},${r[7]},0,${r[2]},${r[5]},${r[8]},0,0,0,0,1) scaleX(-1)`
        })
    }

    /* ---------- Gesture: target accumulates input, smooth eases toward it (degrees) ---------- */
    const smooth = { x: 0, y: 0 }, target = { x: 0, y: 0 }
    let prevX = 0, prevY = 0, snapTween = null, moving = false
    let locked = document.documentElement.classList.contains('is-preloading')
    if (locked) window.addEventListener('mxm:revealed', () => { locked = false }, { once: true })

    function update() {
        const dY = (smooth.y - prevY) * Math.PI / 180, dX = (smooth.x - prevX) * Math.PI / 180
        prevY = smooth.y; prevX = smooth.x
        if (dX !== 0 || dY !== 0) {
            const cy = Math.cos(dY), sy = Math.sin(dY), cx = Math.cos(dX), sx = Math.sin(dX)
            R[0] = cy; R[1] = 0; R[2] = sy
            R[3] = sx * sy; R[4] = cx; R[5] = -sx * cy
            R[6] = -cx * sy; R[7] = sx; R[8] = cx * cy
            premultiply3x3(R)
        }
        render()
    }
    const quickY = gsap.quickTo(smooth, 'y', { duration: 1, ease: 'power2', onUpdate: update, onComplete: settle })
    const quickX = gsap.quickTo(smooth, 'x', { duration: 1, ease: 'power2' })

    function rebase() {
        snapTween?.kill(); snapTween = null
        target.x = target.y = 0; prevX = prevY = 0
        quickX(0, 0); quickY(0, 0)
        smooth.x = smooth.y = 0
    }
    function settle() {
        if (moving || snapTween) return
        if (Math.abs(target.x - smooth.x) > .5 || Math.abs(target.y - smooth.y) > .5) return
        onSettled(findClosestIndex())   // no snap: the sphere stays where it was left; preview the card nearest the center
    }
    // Rotate the sphere so card k lands at the screen center
    function snapToIndex(k, instant) {
        const [vx, vy, vz] = transformedPosition(k)
        const sin = Math.hypot(vx, vy)
        if (sin < .02) { onSettled(k); return }
        const ax = vy / sin, ay = -vx / sin
        const angle = Math.acos(Math.max(-1, Math.min(1, vz)))
        rebase()
        if (instant || reduceMotion) {
            premultiply3x3(axisAngleMatrix(ax, ay, 0, angle)); render(); onSettled(k); return
        }
        const mStart = m.slice(), snap = { t: 0 }
        snapTween = gsap.to(snap, {
            t: 1, duration: 1, ease: 'expo.inOut',
            onUpdate() { for (let i = 0; i < 9; i++) m[i] = mStart[i]; premultiply3x3(axisAngleMatrix(ax, ay, 0, angle * snap.t)); render() },
            onComplete() { snapTween = null; onSettled(k) },
        })
    }
    // Once a card comes to rest at the front, play its preview loop
    function onSettled(k) { if (!player.open) setPreview(hovered || cards[k]) }

    // Responsive radius and perspective (from MWG 107, retuned for 16:9 cards)
    gsap.set(sphere, { transformStyle: 'preserve-3d' })
    let isTouch = false
    const mm = gsap.matchMedia()
    mm.add('(hover: none)', () => { isTouch = true })
    mm.add({ isMobile: '(max-width: 500px)', isFixed: '(min-width: 501px) and (max-width: 1400px)', isDesktop: '(min-width: 1401px)' }, ctx => {
        const { isMobile, isFixed } = ctx.conditions
        if (isMobile) { radius = 330; gsap.set(sphere, { z: 250 }); gsap.set(sphereContainer, { perspective: 1000 }) }
        else if (isFixed) { radius = 980; gsap.set(sphere, { z: -310 }); gsap.set(sphereContainer, { perspective: 3920 }) }
        else { radius = .7 * innerWidth; gsap.set(sphere, { z: -.22 * innerWidth }); gsap.set(sphereContainer, { perspective: 2.8 * innerWidth }) }
        render()
    })
    snapToIndex(0, true)

    /* ---------- Input ---------- */
    const hint = root.querySelector('.hint')
    let dragDist = 0
    const onInput = () => {
        if (!moving) { moving = true; rebase() }
        hint.classList.add('is-gone')
    }
    const endGesture = () => { moving = false; settle() }
    const obs = Observer.create({
        target: root,
        type: 'wheel,touch,pointer',
        onPress: () => { dragDist = 0 },
        onWheel: e => {
            if (locked || player.open) return
            onInput()
            target.y -= e.deltaX / 10; target.x -= e.deltaY / 10
            quickY(target.y); quickX(target.x)
        },
        onDrag: e => {
            if (locked || player.open) return
            dragDist += Math.abs(e.deltaX) + Math.abs(e.deltaY)
            onInput()
            const f = isTouch ? 1 : .25
            target.y += e.deltaX * f; target.x += e.deltaY * f
            quickY(target.y); quickX(target.x)
        },
        onDragEnd: endGesture,
        onStop: endGesture,
    })
    // Arrow keys spin the sphere when the player is closed
    document.addEventListener('keydown', e => {
        if (player.open || locked || !/^Arrow/.test(e.key)) return
        e.preventDefault(); onInput()
        const step = 18
        if (e.key === 'ArrowLeft') target.y += step
        if (e.key === 'ArrowRight') target.y -= step
        if (e.key === 'ArrowUp') target.x += step
        if (e.key === 'ArrowDown') target.x -= step
        quickY(target.y); quickX(target.x)
        clearTimeout(e.target._t); e.target._t = setTimeout(endGesture, 120)
    })

    /* ---------- Card previews (silent 6 s loops) ---------- */
    function setPreview(card) {
        if (card === previewing) return
        if (previewing) {
            previewing.classList.remove('is-previewing')
            previewing.querySelector('video').pause()
        }
        previewing = card
        if (!card) return
        const vid = card.querySelector('video')
        if (!vid.src) vid.src = url(VIDEOS[card.dataset.i], 'preview.mp4')
        // reveal the loop once it's actually playing (the 'playing' event fires even when play()'s promise doesn't settle)
        if (!vid._wired) { vid._wired = true; vid.addEventListener('playing', () => { if (previewing === card) card.classList.add('is-previewing') }) }
        vid.play().catch(() => {})
        if (!vid.paused && vid.readyState > 2) card.classList.add('is-previewing')
    }
    if (finePointer) {
        cards.forEach(c => {
            c.addEventListener('pointerenter', () => { if (moving || player.open) return; hovered = c; setPreview(c) })
            c.addEventListener('pointerleave', () => { if (hovered === c) hovered = null })
        })
    }

    /* ---------- Background loop ---------- */
    const bgVideo = document.querySelector('.bg__video')
    if (bgVideo && reduceMotion) { bgVideo.removeAttribute('autoplay'); bgVideo.pause() }
    const bgPlay = on => { if (!bgVideo || reduceMotion) return; on ? bgVideo.play().catch(() => {}) : bgVideo.pause() }

    /* ---------- Player ---------- */
    const el = document.getElementById('player')
    const bg = el.querySelector('.player__bg')
    const bar = el.querySelector('.player__bar')
    const video = document.getElementById('playerVideo')
    const $artist = document.getElementById('playerArtist')
    const $title = document.getElementById('playerTitle')
    const btnQ = document.getElementById('btnQuality')

    const pickQuality = () => {
        try { const s = localStorage.getItem('mxm-q'); if (s === '1080' || s === '720') return s } catch (e) {}
        const c = navigator.connection || {}
        if (c.saveData || /2g|3g/.test(c.effectiveType || '')) return '720'
        if (Math.min(screen.width, screen.height) < 600) return '720' // phones: lighter default, HD on tap
        return Math.max(screen.width, screen.height) * (devicePixelRatio || 1) >= 1600 ? '1080' : '720'
    }
    let quality = pickQuality()
    const syncQ = () => { btnQ.textContent = quality === '1080' ? 'HD' : 'SD'; btnQ.dataset.q = quality }
    syncQ()

    function load(i, { keepTime = false } = {}) {
        const v = VIDEOS[i]
        const t = keepTime ? video.currentTime : 0
        const wasPaused = keepTime && video.paused
        player.index = i
        $artist.textContent = v.artist
        $title.textContent = v.title
        video.poster = url(v, 'thumb.jpg')
        video.src = url(v, quality + '.mp4')
        if (t) video.addEventListener('loadedmetadata', () => { video.currentTime = t }, { once: true })
        if (!wasPaused) video.play().catch(() => {})
        // Upgrade the poster to full res once it's in cache
        const hi = new Image(); hi.onload = () => { if (player.index === i && video.readyState < 2) video.poster = hi.src }; hi.src = url(v, 'poster.jpg')
    }

    const cardMedia = card => card.querySelector('.card__media')

    // Transform that maps the full-size player video onto the card's on-screen box
    function cardTransform(card) {
        const r = cardMedia(card).getBoundingClientRect()
        const v = video.getBoundingClientRect()
        return {
            x: (r.left + r.width / 2) - (v.left + v.width / 2),
            y: (r.top + r.height / 2) - (v.top + v.height / 2),
            scale: r.width / v.width,
            rotation: 0
        }
    }
    const onScreen = card => {
        const r = cardMedia(card).getBoundingClientRect()
        return r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight
    }
    // The copy of video i nearest the front of the sphere
    function frontCopy(i) {
        let best = null, bestZ = -Infinity
        cards.forEach((c, k) => { if (+c.dataset.i === i) { const z = transformedPosition(k)[2]; if (z > bestZ) { bestZ = z; best = c } } })
        return best
    }

    function open(card) {
        if (player.open || player.busy) return
        const i = +card.dataset.i
        player.open = true; player.busy = true; player.card = card
        bgPlay(false)
        setPreview(null)
        document.body.classList.add('is-playing')
        el.hidden = false
        video.controls = false
        load(i) // play() inside the click gesture so sound is allowed

        const ready = () => { player.busy = false; video.controls = true; video.focus({ preventScroll: true }); wake() }

        const from = cardTransform(card)
        cardMedia(card).style.visibility = 'hidden'
        snapToIndex(+card.dataset.k)   // spin it to the front behind the player, so closing lands centered
        gsap.set(video, { x: 0, y: 0, scale: 1, rotation: 0 })
        gsap.timeline({ onComplete: ready })
            .fromTo(bg, { opacity: 0 }, { opacity: 1, duration: .5, ease: 'power2.out' }, 0)
            .fromTo(video, from, { x: 0, y: 0, scale: 1, rotation: 0, duration: reduceMotion ? .3 : .85, ease: 'expo.inOut' }, 0)
            .fromTo(bar, { autoAlpha: 0, y: -10 }, { autoAlpha: 1, y: 0, duration: .4 }, '-=.25')
    }

    function close() {
        if (!player.open || player.busy) return
        player.busy = true
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
        const card = player.card
        video.controls = false
        video.pause()
        const done = () => {
            el.hidden = true
            cardMedia(card).style.visibility = ''
            video.removeAttribute('src'); video.load()
            gsap.set([video, bg, bar], { clearProps: 'all' })
            document.body.classList.remove('is-playing')
            el.classList.remove('is-idle')
            player.open = false; player.busy = false
            bgPlay(true)
            card.querySelector('.card__btn').focus({ preventScroll: true })
            setPreview(card)
        }
        const tl = gsap.timeline({ onComplete: done })
        tl.to(bar, { autoAlpha: 0, duration: .2 }, 0)
        if (onScreen(card)) {
            tl.to(video, { ...cardTransform(card), duration: reduceMotion ? .3 : .75, ease: 'expo.inOut' }, 0)
              .to(bg, { opacity: 0, duration: .45, ease: 'power2.in' }, .25)
        } else {
            tl.to([video, bg], { opacity: 0, duration: .35 }, 0)
        }
    }

    function go(step) {
        if (!player.open || player.busy) return
        const prev = player.index
        const i = (prev + step + VIDEOS.length) % VIDEOS.length
        // bring a copy of the next video to the front (behind the player) so closing returns to it
        cardMedia(player.card).style.visibility = ''
        player.card = frontCopy(i)
        snapToIndex(+player.card.dataset.k, true)
        cardMedia(player.card).style.visibility = 'hidden'
        gsap.fromTo(video, { opacity: .2 }, { opacity: 1, duration: .5, ease: 'power2.out' })
        load(i)
        wake()
    }

    function toggleFullscreen() {
        const d = document
        if (d.fullscreenElement || d.webkitFullscreenElement) {
            (d.exitFullscreen || d.webkitExitFullscreen).call(d)
        } else if (el.requestFullscreen) {
            el.requestFullscreen().catch(() => {})
        } else if (el.webkitRequestFullscreen) {
            el.webkitRequestFullscreen()
        } else if (video.webkitEnterFullscreen) {
            video.webkitEnterFullscreen() // iPhone
        }
    }

    /* Hide the top bar while watching */
    let idleT = 0
    function wake() {
        el.classList.remove('is-idle')
        clearTimeout(idleT)
        idleT = setTimeout(() => { if (player.open && !video.paused) el.classList.add('is-idle') }, 2600)
    }
    ;['pointermove', 'pointerdown', 'keydown'].forEach(t => el.addEventListener(t, wake))
    video.addEventListener('pause', wake)
    video.addEventListener('play', wake)
    video.addEventListener('ended', () => go(1))

    /* Events */
    sphere.addEventListener('click', e => {
        if (dragDist > 3) return            // it was a drag, not a click
        const card = e.target.closest('.card')
        if (card) open(card)
    })
    document.getElementById('btnClose').addEventListener('click', close)
    document.getElementById('btnPrev').addEventListener('click', () => go(-1))
    document.getElementById('btnNext').addEventListener('click', () => go(1))
    document.getElementById('btnFull').addEventListener('click', toggleFullscreen)
    video.addEventListener('dblclick', toggleFullscreen)
    btnQ.addEventListener('click', () => {
        quality = quality === '1080' ? '720' : '1080'
        try { localStorage.setItem('mxm-q', quality) } catch (e) {}
        syncQ()
        if (player.open) load(player.index, { keepTime: true })
    })
    // Clicking the black letterbox closes
    bg.addEventListener('click', close)
    el.querySelector('.player__stage').addEventListener('click', e => { if (e.target === e.currentTarget) close() })

    document.addEventListener('keydown', e => {
        if (!player.open) return
        const onVideo = e.target === video
        if (e.key === 'Escape' && !document.fullscreenElement) { e.preventDefault(); close() }
        else if (e.key === 'ArrowRight' && (!onVideo || e.shiftKey)) { e.preventDefault(); go(1) }
        else if (e.key === 'ArrowLeft' && (!onVideo || e.shiftKey)) { e.preventDefault(); go(-1) }
        else if (e.key === 'f' || e.key === 'F') toggleFullscreen()
        else if (e.key === ' ' && !onVideo && e.target.tagName !== 'BUTTON') { e.preventDefault(); video.paused ? video.play() : video.pause() }
    })
    // Keep focus inside the dialog
    el.addEventListener('keydown', e => {
        if (e.key !== 'Tab') return
        const f = [...el.querySelectorAll('button, video')].filter(n => n.offsetParent !== null)
        const first = f[0], last = f[f.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    })

    function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])) }
})
