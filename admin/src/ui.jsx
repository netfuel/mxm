import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

/* ---------- Toasts ---------- */
const ToastCtx = createContext(() => {})
export const useToast = () => useContext(ToastCtx)
export function ToastProvider({ children }) {
  const [t, setT] = useState(null)
  const timer = useRef()
  const show = useCallback((msg, kind = 'ok') => {
    clearTimeout(timer.current)
    setT({ msg: msg instanceof Error ? msg.message : msg, kind: msg instanceof Error ? 'err' : kind })
    timer.current = setTimeout(() => setT(null), msg instanceof Error || kind === 'err' ? 6000 : 3000)
  }, [])
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {t && <div className={`toast ${t.kind === 'err' ? 'err' : ''}`} role="status" aria-live="polite">{t.msg}</div>}
    </ToastCtx.Provider>
  )
}

/* ---------- Modal ---------- */
export function Modal({ title, sub, onClose, children, wide, foot }) {
  const ref = useRef()
  useEffect(() => {
    const prev = document.activeElement
    const first = ref.current?.querySelector('input,textarea,select,button')
    first?.focus()
    const key = e => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('keydown', key); prev?.focus?.() }
  }, [])
  return (
    <div className="scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose?.() }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <h2>{title}</h2>
        {sub && <p className="sub">{sub}</p>}
        {children}
        {foot && <div className="foot">{foot}</div>}
      </div>
    </div>
  )
}

export function Confirm({ title, sub, confirmLabel = 'Confirm', danger, onConfirm, onClose, children }) {
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  return (
    <Modal title={title} sub={sub} onClose={busy ? null : onClose} foot={<>
      <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
      <button className={`btn ${danger ? 'danger solid' : 'primary'}`} disabled={busy}
        onClick={async () => { setBusy(true); try { await onConfirm(); onClose() } catch (e) { toast(e); setBusy(false) } }}>
        {busy ? 'Working…' : confirmLabel}
      </button>
    </>}>{children}</Modal>
  )
}

export function Field({ label, hint, children }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
}

export function useDebounced(value, ms) {
  const [v, setV] = useState(value)
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t) }, [value, ms])
  return v
}
