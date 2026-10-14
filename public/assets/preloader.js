/* MarceauxMarceaux preloader
   Lime lines fly in from the screen edges and lay down the quilt's seams (the same
   half-square-triangle grid and concentric diamonds as the videos), then pull
   back along their seams to the edges while the dark ground dissolves, revealing the page. Fixed 3.5 s, every load. */
(function () {
  var root = document.getElementById('preloader')
  if (!root) return
  var canvas = root.querySelector('canvas')
  var ctx = canvas.getContext('2d')
  var html = document.documentElement
  html.classList.add('is-preloading')
  var LIME = '198,255,0'          // #C6FF00
  var BG = '#110f0d'
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches

  // Timeline (seconds)
  var T_STAGGER = 1.0, T_TRAVEL_MIN = 0.75, T_TRAVEL_MAX = 1.1
  var T_REVEAL = reduce ? 1.2 : 2.2, T_END = reduce ? 1.6 : 3.5   // reveal: lines retract 2.2–3.5 s

  var W, H, cx, cy, cell, dpr, runs

  function rand(a, b) { return a + Math.random() * (b - a) }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3) }
  function easeIn(t) { return t * t * t }
  function easeInOut(t) { return t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2 }

  function build() {
    dpr = Math.min(window.devicePixelRatio || 1, 2)
    W = window.innerWidth; H = window.innerHeight
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr)
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px'
    cx = W / 2; cy = H / 2
    cell = Math.min(W, H) / 8                      // the 8×8 quilt fits the short side
    var nx = Math.ceil(cx / cell) + 1, ny = Math.ceil(cy / cell) + 1
    var segs = []                                  // grid units: [x1,y1,x2,y2,key]
    for (var j = -ny; j <= ny; j++) segs.push([-nx, j, nx, j, 'h' + j])
    for (var i = -nx; i <= nx; i++) segs.push([i, -ny, i, ny, 'v' + i])
    // Half-square-triangle diagonals forming concentric diamonds around the center
    var diag = {}
    for (i = -nx; i < nx; i++) for (j = -ny; j < ny; j++) {
      var same = (i + 0.5) * (j + 0.5) > 0
      var s = same ? [i, j + 1, i + 1, j] : [i, j, i + 1, j + 1]   // "/" or "\"
      var key = same ? 'a' + (i + j + 1) + (i < 0 ? 'L' : 'R') : 'b' + (i - j) + (i < 0 ? 'L' : 'R')
      ;(diag[key] = diag[key] || []).push(s)
    }
    for (var k in diag) {                          // merge touching pieces into long runs
      var list = diag[k].sort(function (p, q) { return p[0] - q[0] })
      var cur = list[0].slice()
      for (var n = 1; n < list.length; n++) {
        var p = list[n]
        if (p[0] === cur[2]) { cur[2] = p[2]; cur[3] = p[3] }
        else { segs.push(cur.concat(k)); cur = p.slice() }
      }
      segs.push(cur.concat(k))
    }
    runs = segs.map(function (s) {
      var a = [cx + s[0] * cell, cy + s[1] * cell], b = [cx + s[2] * cell, cy + s[3] * cell]
      if (Math.random() < 0.5) { var t = a; a = b; b = t }
      var dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy)
      var ux = dx / len, uy = dy / len
      // back up from the run's start until just off-screen: that's where its comet enters
      var back = 0, m = 60
      while (back < 4000) {
        var x = a[0] - ux * back, y = a[1] - uy * back
        if (x < -m || x > W + m || y < -m || y > H + m) break
        back += 20
      }
      var start = reduce ? 0 : rand(0, T_STAGGER)
      return { ax: a[0], ay: a[1], ux: ux, uy: uy, len: len, back: back,
               t0: start, dur: reduce ? 0.01 : rand(T_TRAVEL_MIN, T_TRAVEL_MAX),
               r0: reduce ? 0 : rand(0, 0.35), rdur: reduce ? 0.35 : rand(0.75, 0.95) }
    })
  }

  function draw(time) {
    var outP = time > T_REVEAL ? Math.min(1, (time - T_REVEAL) / (T_END - T_REVEAL)) : 0
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)
    // the dark ground dissolves as the lines pull out, so the site shows through
    ctx.globalAlpha = 1 - easeInOut(outP)
    ctx.fillStyle = BG
    ctx.fillRect(0, 0, W, H)
    ctx.globalAlpha = 1
    ctx.lineCap = 'round'
    for (var i = 0; i < runs.length; i++) {
      var R = runs[i], head, moving = false, dir = 1
      var pin = (time - R.t0) / R.dur
      if (pin <= 0) continue
      if (time < T_REVEAL + R.r0) {                // drawing in: comet travels from the edge to the run's end
        var p = easeOut(Math.min(1, pin))
        head = -R.back + p * (R.back + R.len)
        moving = p < 1
      } else {                                     // retracting: the seam pulls back the way it came
        var q = Math.min(1, (time - T_REVEAL - R.r0) / R.rdur)
        head = R.len - easeIn(q) * (R.len + R.back)
        moving = q < 1; dir = -1
        if (q >= 1) continue
      }
      var drawn = Math.max(0, Math.min(R.len, head))
      if (drawn > 0) {                             // laid-down seam: glow pass + core
        var ex = R.ax + R.ux * drawn, ey = R.ay + R.uy * drawn
        ctx.strokeStyle = 'rgba(' + LIME + ',0.14)'
        ctx.lineWidth = 3.2
        ctx.beginPath(); ctx.moveTo(R.ax, R.ay); ctx.lineTo(ex, ey); ctx.stroke()
        ctx.strokeStyle = 'rgba(' + LIME + ',0.85)'
        ctx.lineWidth = 1.15
        ctx.beginPath(); ctx.moveTo(R.ax, R.ay); ctx.lineTo(ex, ey); ctx.stroke()
      }
      if (moving) {                                // the comet: a short bright line, tail trailing its motion
        var tail = 46, hx = R.ax + R.ux * head, hy = R.ay + R.uy * head
        var tx = hx - R.ux * tail * dir, ty = hy - R.uy * tail * dir
        var g = ctx.createLinearGradient(tx, ty, hx, hy)
        g.addColorStop(0, 'rgba(' + LIME + ',0)'); g.addColorStop(1, 'rgba(' + LIME + ',1)')
        ctx.strokeStyle = g; ctx.lineWidth = 1.8
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy); ctx.stroke()
      }
    }
  }

  var t0 = null, done = false
  function frame(now) {
    if (done) return
    if (t0 === null) { t0 = now; root.style.background = 'transparent' }
    var t = (now - t0) / 1000
    draw(t)
    if (t >= T_REVEAL && !root.classList.contains('is-revealing')) root.classList.add('is-revealing')
    if (t >= T_END) return finish()
    requestAnimationFrame(frame)
  }
  function finish() {
    done = true
    root.remove()
    html.classList.remove('is-preloading')
    window.dispatchEvent(new Event('mxm:revealed'))
  }

  build()
  window.addEventListener('resize', build)
  requestAnimationFrame(frame)
  setTimeout(function () { if (!done) finish() }, (T_END + 2) * 1000) // never block the page
})()
