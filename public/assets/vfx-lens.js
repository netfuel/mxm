/* Cinematic lens (VFX-JS)
   The whole page — background loop, title, drifting cards and their preview loops — is drawn
   into one WebGL canvas, then a final pass bends the frame like a lens: pincushion distortion
   (lines bow inward), with RGB split, a slow ripple and a vignette concentrated at the edges, and fine
   film grain. Pointer events are mapped back through the lens so clicks and hovers land on the
   card you see. The social bar, video player and preloader stay crisp on top.
   Falls back to the plain page without WebGL or with reduced motion. */
import { VFX } from './vendor/vfx.min.js'

const LENS = 0.2                 // pincushion strength: lines bow inward toward the center
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches

/* ---------- Shaders ---------- */
const POST = `
precision highp float;
uniform sampler2D src;
uniform vec2 resolution;
uniform vec2 offset;
uniform float time;
uniform float strength;
uniform float zoomT;        // 0 normal view … 1 flown into the card
uniform vec2 focus;         // card center, uv (y up)
uniform float focusScale;   // card size / screen size (cover)
out vec4 outColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
    vec2 uv = (gl_FragCoord.xy - offset) / resolution;
    float t = zoomT;
    vec2 d = uv - .5;
    float asp = resolution.x / resolution.y;
    vec2 dc = d * vec2(asp, 1.);
    float r2 = dot(dc, dc);
    float rc2 = .25 * (asp * asp + 1.);                  // squared radius of the corners
    float k = strength * (1. - t);                       // the lens relaxes as we fly in
    float f = 1. - k * r2;                               // pincushion: edges sample inward, lines bow in
    vec2 s = .5 + d * f;                                 // lensed sample position
    // the frame's edges ripple slowly; the center stays still
    float edgeZone = smoothstep(.3, 1., r2 / rc2) * (1. - t);
    s += vec2(sin(d.y * 17. + time * 1.6) + .5 * sin(d.y * 41. - time * 2.3),
              cos(d.x * 13. - time * 1.2) + .5 * cos(d.x * 37. + time * 2.7)) * .0045 * edgeZone * edgeZone;

    // fly toward the card: zoom about a center that drifts from the screen to the card
    float sc = pow(focusScale, t);
    vec2 ctr = mix(focus, vec2(.5), (sc - focusScale) / max(1. - focusScale, 1e-3));
    vec2 q = ctr + (s - .5) * sc;

    float e = r2 / rc2;                                  // 0 center … 1 corners
    float flight = sin(3.14159 * t);                     // peaks mid-transition
    float ca = .05 * edgeZone * edgeZone + .03 * flight * e;   // RGB split, strongest at the edges
    vec2 dir = q - ctr;
    vec3 col = vec3(0.);
    if (flight < .001) {                                 // at rest: three taps
        col.r = texture(src, ctr + dir * (1. + ca)).r;
        col.g = texture(src, q).g;
        col.b = texture(src, ctr + dir * (1. - ca)).b;
    } else {
        for (int i = 0; i < 8; i++) {                    // radial zoom blur during the flight
            float o = float(i) / 7. * .09 * flight;
            vec2 p = ctr + dir * (1. - o);
            col.r += texture(src, ctr + (p - ctr) * (1. + ca)).r;
            col.g += texture(src, p).g;
            col.b += texture(src, ctr + (p - ctr) * (1. - ca)).b;
        }
        col /= 8.;
    }
    col *= mix(1., .5, smoothstep(.25, 1.05, e) * (1. - t));   // vignette
    col += (hash(gl_FragCoord.xy + fract(time) * 91.7) - .5) * .035;   // film grain
    outColor = vec4(col, 1.);
}
`

// A card's thumbnail or preview loop, drawn with its GSAP rotation/scale, rounded corners
// and (on hover) the play button. (shadowAmt is kept at 0: no drop shadow.)
const CARD = `
precision highp float;
uniform sampler2D src;
uniform vec2 center;      // card center, canvas px (y up)
uniform vec2 halfSize;    // half the card's displayed size, canvas px
uniform float rot;        // CSS rotation, radians
uniform float radius;     // corner radius, canvas px
uniform float visible;
uniform float shadowAmt;
uniform float hover;
out vec4 outColor;

float sdRoundBox(vec2 p, vec2 b, float r) {
    vec2 d = abs(p) - b + r;
    return length(max(d, 0.)) + min(max(d.x, d.y), 0.) - r;
}
float sdTri(vec2 p, float s) {               // play triangle pointing right, size s
    vec2 a = vec2(-.38, .5) * s, b = vec2(-.38, -.5) * s, c = vec2(.5, 0.) * s;
    vec2 e0 = b - a, e1 = c - b, e2 = a - c;
    vec2 v0 = p - a, v1 = p - b, v2 = p - c;
    vec2 pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0., 1.);
    vec2 pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0., 1.);
    vec2 pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0., 1.);
    float s2 = sign(e0.x * e2.y - e0.y * e2.x);
    vec2 d = min(min(vec2(dot(pq0, pq0), s2 * (v0.x * e0.y - v0.y * e0.x)),
                     vec2(dot(pq1, pq1), s2 * (v1.x * e1.y - v1.y * e1.x))),
                     vec2(dot(pq2, pq2), s2 * (v2.x * e2.y - v2.y * e2.x)));
    return -sqrt(d.x) * sign(d.y);
}

void main() {
    vec2 p = gl_FragCoord.xy - center;
    float cs = cos(rot), sn = sin(rot);
    p = vec2(cs * p.x - sn * p.y, sn * p.x + cs * p.y);
    vec2 q = p / halfSize;
    float d = sdRoundBox(p, halfSize, radius);
    float a = 1. - smoothstep(-1., 1., d);
    vec3 col = texture(src, clamp(q * .5 + .5, 0., 1.)).rgb;

    if (hover > 0.) {                          // play button
        float r = max(halfSize.y * .16, 14.);
        float disc = 1. - smoothstep(r - 1., r + 1., length(p));
        col = mix(col, vec3(.067, .059, .051), disc * .6 * hover);
        float tri = 1. - smoothstep(-1., 1., sdTri(p - vec2(r * .08, 0.), r * .8));
        col = mix(col, vec3(.945, .925, .894), tri * hover);
    }

    float ds = sdRoundBox(p + vec2(0., halfSize.y * .08), halfSize, radius);
    float shadow = (1. - smoothstep(0., halfSize.y * .35, ds)) * .45 * (1. - a) * shadowAmt;
    outColor = (vec4(col, 1.) * a + vec4(0., 0., 0., shadow)) * visible;
}
`

// Mirrored text (title, subhead, scroll hint), with the element's live opacity
const TEXT = `
precision highp float;
uniform sampler2D src;
uniform vec2 resolution;
uniform vec2 offset;
uniform float alpha;
out vec4 outColor;
void main() {
    vec2 uv = (gl_FragCoord.xy - offset) / resolution;
    if (uv.x < 0. || uv.x > 1. || uv.y < 0. || uv.y > 1.) discard;
    outColor = texture(src, uv) * alpha;
}
`

/* ---------- Helpers ---------- */
const smooth = (cur, target, k) => cur + (target - cur) * k

// Draw an element's text into a canvas laid exactly over it, so VFX can render it
function textCanvas(el, pr) {
  const c = document.createElement('canvas')
  c.setAttribute('aria-hidden', 'true')
  Object.assign(c.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', pointerEvents: 'none' })
  el.appendChild(c)
  const draw = () => {
    const box = el.getBoundingClientRect()
    c.width = Math.max(1, Math.round(box.width * pr)); c.height = Math.max(1, Math.round(box.height * pr))
    const ctx = c.getContext('2d')
    ctx.setTransform(pr, 0, 0, pr, 0, 0)
    ctx.clearRect(0, 0, box.width, box.height)
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let node
    while ((node = walker.nextNode())) {
      const text = node.textContent.trim()
      if (!text) continue
      const cs = getComputedStyle(node.parentElement)
      const range = document.createRange(); range.selectNodeContents(node)
      const r = range.getBoundingClientRect()
      ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
      if ('letterSpacing' in ctx) ctx.letterSpacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing
      ctx.fillStyle = cs.color
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      const m = ctx.measureText(text)
      const t = cs.textTransform === 'uppercase' ? text.toUpperCase() : cs.textTransform === 'lowercase' ? text.toLowerCase() : text
      ctx.fillText(t, r.left - box.left, r.top - box.top + (m.fontBoundingBoxAscent || parseFloat(cs.fontSize) * .8))
    }
  }
  return { canvas: c, draw }
}

/* ---------- Setup ---------- */
const zoom = { t: 0, fx: .5, fy: .5, fs: 1 }

async function start(cards) {
  const pr = Math.min(window.devicePixelRatio || 1, 1.5)
  let vfx
  try {
    vfx = new VFX({ pixelRatio: pr, zIndex: 2, scrollPadding: false, postEffect: { shader: POST, uniforms: {
      strength: LENS, zoomT: () => zoom.t, focus: () => [zoom.fx, zoom.fy], focusScale: () => zoom.fs } } })
  } catch (e) { return }

  await document.fonts.ready

  // Background loop
  const bgVideo = document.querySelector('.bg__video')
  if (bgVideo) vfx.add(bgVideo, { shader: 'none', zIndex: -2 })

  // Title + subhead, and the scroll hint
  const texts = [document.querySelector('.lockup'), document.querySelector('.hint')].filter(Boolean).map(el => {
    const t = textCanvas(el, pr); t.draw()
    vfx.add(t.canvas, { shader: TEXT, zIndex: -1, uniforms: { alpha: () => +getComputedStyle(el).opacity } })
    return t
  })

  // Cards
  cards.forEach(card => {
    const media = card.querySelector('.card__media')
    const img = media.querySelector('img')
    const prev = media.querySelector('video')
    const state = { vis: 1, prev: 0, hover: 0 }
    const geo = {
      center: () => { const r = media.getBoundingClientRect(); return [(r.left + r.width / 2) * pr, (innerHeight - (r.top + r.height / 2)) * pr] },
      halfSize: () => { const s = gsap.getProperty(card, 'scale') || 1; return [media.offsetWidth * s * pr / 2, media.offsetHeight * s * pr / 2] },
      rot: () => (gsap.getProperty(card, 'rotation') || 0) * Math.PI / 180,
      radius: () => parseFloat(getComputedStyle(media).borderTopLeftRadius) * (gsap.getProperty(card, 'scale') || 1) * pr,
    }
    const add = () => vfx.add(img, {
      shader: CARD, zIndex: 1, overflow: 40,
      uniforms: { ...geo, shadowAmt: 0,
        visible: () => (state.vis = smooth(state.vis, media.style.visibility === 'hidden' ? 0 : 1, .2)),
        hover: () => (state.hover = smooth(state.hover, card.classList.contains('is-previewing') ? 1 : 0, .15)) },
    })
    img.complete && img.naturalWidth ? add() : img.addEventListener('load', add, { once: true })

    // the preview loop joins the canvas the first time it plays
    prev.addEventListener('playing', () => {
      if (prev._vfx) return
      prev._vfx = true
      vfx.add(prev, { shader: CARD, zIndex: 2, overflow: 0,
        uniforms: { ...geo, shadowAmt: 0, hover: 0,
          visible: () => (state.prev = smooth(state.prev, card.classList.contains('is-previewing') && media.style.visibility !== 'hidden' ? 1 : 0, .15)) } })
    })
  })

  document.documentElement.classList.add('vfx-on')

  // Re-draw mirrored text when layout changes
  let rt
  addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => texts.forEach(t => { t.draw(); vfx.update(t.canvas) }), 120) })

  // Transitions into and out of the player: the lens flies into the clicked card
  const aim = card => {
    const r = card.querySelector('.card__media').getBoundingClientRect()
    zoom.fx = (r.left + r.width / 2) / innerWidth
    zoom.fy = 1 - (r.top + r.height / 2) / innerHeight
    zoom.fs = Math.min(r.width / innerWidth, r.height / innerHeight)
  }
  window.MXM_LENS = {
    zoomIn(card, { handoff, done }) {
      aim(card); vfx.play()
      let handed = false
      gsap.to(zoom, { t: 1, duration: 1, ease: 'expo.inOut',
        onUpdate: () => { if (!handed && zoom.t > .82) { handed = true; handoff && handoff() } },
        onComplete: () => { if (!handed) handoff && handoff(); vfx.stop(); done && done() } })
    },
    zoomOut(card, { delay = 0, done }) {
      aim(card); zoom.t = 1; vfx.play()
      gsap.to(zoom, { t: 0, duration: .9, delay, ease: 'expo.inOut', onComplete: () => done && done() })
    },
  }

  /* ---------- Pointer mapping through the lens ---------- */
  const hit = document.createElement('div')
  hit.className = 'lens-hit'
  document.body.appendChild(hit)
  const unlens = (x, y) => {                      // screen point → where that pixel comes from on the page
    const W = innerWidth, H = innerHeight, asp = W / H
    const dx = x / W - .5, dy = y / H - .5
    const r2 = dx * dx * asp * asp + dy * dy, rc2 = .25 * (asp * asp + 1)
    const f = 1 - LENS * r2
    return [(.5 + dx * f) * W, (.5 + dy * f) * H]
  }
  const pick = (x, y) => {
    const [sx, sy] = unlens(x, y)
    hit.style.pointerEvents = 'none'
    const el = document.elementFromPoint(sx, sy)
    hit.style.pointerEvents = ''
    return el
  }
  let hovered = null
  const setHover = card => {
    if (card === hovered) return
    if (hovered) hovered.dispatchEvent(new PointerEvent('pointerleave'))
    hovered = card
    if (card) card.dispatchEvent(new PointerEvent('pointerenter'))
    hit.style.cursor = card ? 'pointer' : ''
  }
  hit.addEventListener('pointermove', e => { if (e.pointerType === 'mouse') setHover(pick(e.clientX, e.clientY)?.closest('.card') || null) })
  hit.addEventListener('pointerleave', () => setHover(null))
  hit.addEventListener('click', e => {
    const el = pick(e.clientX, e.clientY)
    const btn = el && el.closest('.card__btn, a, button')
    if (btn) btn.click()
  })
}

if (!reduceMotion) {
  if (window.MXM_CARDS) start(window.MXM_CARDS)
  else addEventListener('mxm:cards', () => start(window.MXM_CARDS), { once: true })
}
