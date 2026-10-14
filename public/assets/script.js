/* MarceauxMarceaux videos
   Drifting card scroller adapted from MWG 094, plus a FLIP-expanding fullscreen player. */
window.addEventListener('DOMContentLoaded', () => {
    gsap.registerPlugin(ScrollTrigger)

    const VIDEOS = window.VIDEOS || []
    const BASE = (window.MEDIA_BASE || 'media/').replace(/\/?$/, '/')
    const url = (v, file) => BASE + encodeURIComponent(v.media) + '/' + file
    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
    const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches
    const player = { open: false, index: -1, busy: false }
    let previewing = null, hovered = null, raf = 0

    /* ---------- Build cards ---------- */
    const root = document.querySelector('.mwg_effect094')
    const container = root.querySelector('.container')
    const cardsEl = document.getElementById('cards')

    cardsEl.innerHTML = VIDEOS.map((v, i) => `
        <li class="card" data-i="${i}">
            <button class="card__btn" type="button" aria-label="Play ${esc(v.artist)}: ${esc(v.title)}">
                <span class="card__media">
                    <img src="${url(v, 'thumb.jpg')}" alt="" loading="${i < 6 ? 'eager' : 'lazy'}" decoding="async" width="640" height="360">
                    <video muted loop playsinline preload="none" aria-hidden="true" tabindex="-1"></video>
                    <span class="card__play" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z"/></svg></span>
                </span>
            </button>
        </li>`).join('')

    const cards = [...cardsEl.querySelectorAll('.card')]
    window.MXM_CARDS = cards
    window.dispatchEvent(new Event('mxm:cards'))

    /* ---------- Smooth scroll ---------- */
    const lenis = new Lenis({ autoRaf: true })
    // Hold scrolling until the preloader has revealed the page
    if (document.documentElement.classList.contains('is-preloading')) {
        lenis.stop()
        window.addEventListener('mxm:revealed', () => { lenis.start(); ScrollTrigger.refresh() }, { once: true })
    }
    lenis.on('scroll', ScrollTrigger.update)

    /* ---------- Horizontal drift (MWG 094) ---------- */
    const distance = () => cardsEl.scrollWidth - window.innerWidth
    const scrollTween = gsap.to(cardsEl, {
        x: () => -distance(),
        ease: 'none',
        scrollTrigger: {
            trigger: container,
            pin: true,
            scrub: true,
            start: 'top top',
            end: () => '+=' + distance(),
            invalidateOnRefresh: true,
            onUpdate: schedulePreview
        }
    })

    if (!reduceMotion) {
        cards.forEach((card, i) => {
            const sign = i % 2 === 0 ? 1 : -1
            const rotation = (Math.random() - 0.5) * 6
            const st = () => ({
                trigger: card,
                containerAnimation: scrollTween,
                start: 'left 90%',
                end: 'right 10%',
                scrub: true
            })
            gsap.fromTo(card, { rotation }, {
                rotation: -rotation,
                y: () => {
                    const portrait = window.innerWidth < window.innerHeight
                    return sign * -(portrait ? 0.34 : 0.42) * window.innerHeight
                },
                yPercent: () => sign * 50,
                yoyo: true,
                repeat: 1,
                ease: 'power1.inOut',
                scrollTrigger: st()
            })
            gsap.to(card, {
                scale: 1.4,
                yoyo: true,
                repeat: 1,
                ease: 'back.inOut(3)',
                scrollTrigger: st()
            })
        })
    }

    const hint = root.querySelector('.hint')
    lenis.on('scroll', ({ scroll }) => hint.classList.toggle('is-gone', scroll > 40))

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
        const p = vid.play()
        if (p) p.then(() => card === previewing && card.classList.add('is-previewing')).catch(() => {})
    }
    function nearestCenter() {
        const cx = window.innerWidth / 2
        let best = null, bestD = window.innerWidth * 0.14
        for (const c of cards) {
            const r = c.getBoundingClientRect()
            const d = Math.abs(r.left + r.width / 2 - cx)
            if (d < bestD) { bestD = d; best = c }
        }
        return best
    }
    function schedulePreview() {
        if (raf || player.open) return
        raf = requestAnimationFrame(() => { raf = 0; setPreview(hovered || nearestCenter()) })
    }
    if (finePointer) {
        cards.forEach(c => {
            c.addEventListener('pointerenter', () => { hovered = c; schedulePreview() })
            c.addEventListener('pointerleave', () => { if (hovered === c) hovered = null; schedulePreview() })
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

    function cardMedia(i) { return cards[i].querySelector('.card__media') }

    // Transform that maps the full-size player video onto the card's media box
    function cardTransform(i) {
        const media = cardMedia(i)
        const card = cards[i]
        const r = media.getBoundingClientRect()
        const v = video.getBoundingClientRect()
        const rot = reduceMotion ? 0 : gsap.getProperty(card, 'rotation')
        const s = gsap.getProperty(card, 'scale') || 1
        const w = media.offsetWidth * s
        return {
            x: (r.left + r.width / 2) - (v.left + v.width / 2),
            y: (r.top + r.height / 2) - (v.top + v.height / 2),
            scale: w / v.width,
            rotation: rot
        }
    }
    const onScreen = i => {
        const r = cardMedia(i).getBoundingClientRect()
        return r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight
    }

    function open(i) {
        if (player.open || player.busy) return
        player.open = true; player.busy = true
        bgPlay(false)
        setPreview(null)
        lenis.stop()
        document.body.classList.add('is-playing')
        el.hidden = false
        video.controls = false
        load(i) // play() inside the click gesture so sound is allowed

        const ready = () => { player.busy = false; video.controls = true; video.focus({ preventScroll: true }); wake() }
        if (window.MXM_LENS) {
            // VFX-JS transition: the lens flies into the card, then the player fades in over it
            gsap.set([bg, video], { opacity: 0, x: 0, y: 0, scale: 1, rotation: 0 }); gsap.set(bar, { autoAlpha: 0 })
            window.MXM_LENS.zoomIn(cards[i], {
                handoff: () => gsap.to([bg, video], { opacity: 1, duration: .35, ease: 'power1.out' }),
                done: () => { gsap.to(bar, { autoAlpha: 1, duration: .3 }); ready() },
            })
            return
        }

        const from = cardTransform(i)
        cardMedia(i).style.visibility = 'hidden'
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
        const i = player.index
        video.controls = false
        video.pause()
        const done = () => {
            el.hidden = true
            cardMedia(i).style.visibility = ''
            video.removeAttribute('src'); video.load()
            gsap.set([video, bg, bar], { clearProps: 'all' })
            document.body.classList.remove('is-playing')
            el.classList.remove('is-idle')
            player.open = false; player.busy = false
            bgPlay(true)
            lenis.start()
            cards[i].querySelector('.card__btn').focus({ preventScroll: true })
            schedulePreview()
        }
        if (window.MXM_LENS) {
            // fade the player away to reveal the zoomed card, then the lens pulls back out
            window.MXM_LENS.zoomOut(cards[i], { delay: .3, done })
            gsap.timeline({ onComplete: () => { el.hidden = true } })
                .to(bar, { autoAlpha: 0, duration: .2 }, 0)
                .to([video, bg], { opacity: 0, duration: .3, ease: 'power1.in' }, 0)
            return
        }
        const tl = gsap.timeline({ onComplete: done })
        tl.to(bar, { autoAlpha: 0, duration: .2 }, 0)
        if (onScreen(i)) {
            tl.to(video, { ...cardTransform(i), duration: reduceMotion ? .3 : .75, ease: 'expo.inOut' }, 0)
              .to(bg, { opacity: 0, duration: .45, ease: 'power2.in' }, .25)
        } else {
            tl.to([video, bg], { opacity: 0, duration: .35 }, 0)
        }
    }

    // Scroll the page (behind the player) so card i sits at center: closing animates back to it
    function scrollToCard(i) {
        const st = scrollTween.scrollTrigger
        const c = cards[i]
        const target = st.start + c.offsetLeft + c.offsetWidth / 2 - innerWidth / 2
        lenis.scrollTo(Math.max(st.start, Math.min(st.end, target)), { immediate: true, force: true })
        ScrollTrigger.update()
    }

    function go(step) {
        if (!player.open || player.busy) return
        const prev = player.index
        const i = (prev + step + VIDEOS.length) % VIDEOS.length
        if (!window.MXM_LENS) cardMedia(prev).style.visibility = ''
        scrollToCard(i)
        if (!window.MXM_LENS) cardMedia(i).style.visibility = 'hidden'
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
    cardsEl.addEventListener('click', e => {
        const card = e.target.closest('.card')
        if (card) open(+card.dataset.i)
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

    schedulePreview()

    function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])) }
})
