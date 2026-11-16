import React, { useRef, useState } from 'react'
import { useToast } from './ui.jsx'

// Uploads a file to R2 through /admin/api/uploads and hands back its public URL.
export default function UploadButton({ kind, accept, label = 'Upload', onDone }) {
  const toast = useToast()
  const ref = useRef()
  const [pct, setPct] = useState(null)
  const pick = file => {
    if (!file) return
    if (file.size > 95 * 1024 * 1024) return toast(new Error('That file is over 95 MB. Upload it to Dropbox or Google Drive and paste the share link instead.'))
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `/admin/api/uploads?kind=${kind}&name=${encodeURIComponent(file.name)}`)
    xhr.setRequestHeader('content-type', file.type || 'application/octet-stream')
    xhr.upload.onprogress = e => e.lengthComputable && setPct(Math.round(100 * e.loaded / e.total))
    xhr.onload = () => {
      setPct(null); ref.current.value = ''
      let data = {}; try { data = JSON.parse(xhr.responseText) } catch {}
      if (xhr.status >= 200 && xhr.status < 300) { onDone(data); toast(`Uploaded ${data.name}`) }
      else toast(new Error(data.error || `Upload failed (${xhr.status})`))
    }
    xhr.onerror = () => { setPct(null); toast(new Error('Upload failed. Check your connection and try again.')) }
    setPct(0); xhr.send(file)
  }
  return (
    <>
      <button type="button" className="btn" disabled={pct !== null} onClick={() => ref.current.click()} style={{ minWidth: 96 }}>
        {pct !== null ? `${pct}%` : label}
      </button>
      <input ref={ref} type="file" accept={accept} hidden onChange={e => pick(e.target.files[0])} />
    </>
  )
}

export const fileName = url => { try { return decodeURIComponent(new URL(url).pathname.split('/').pop()).replace(/^[0-9a-f]{12}-/, '') } catch { return '' } }
