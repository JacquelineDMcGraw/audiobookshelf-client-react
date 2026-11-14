'use client'

import Btn from '@/components/ui/Btn'
import { useTypeSafeTranslations } from '@/hooks/useTypeSafeTranslations'
import { useEffect, useState } from 'react'
import { findUploadedReadAlongBook } from './actions'

export default function ReadAlongUploadResult({
  libraryId,
  folderId,
  directory,
  audioCount
}: {
  libraryId: string
  folderId: string
  directory: string
  audioCount: number
}) {
  const t = useTypeSafeTranslations()
  const [itemId, setItemId] = useState<string | null>(null)
  const [waiting, setWaiting] = useState(true)

  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    let attempts = 0
    async function check() {
      try {
        const id = await findUploadedReadAlongBook(libraryId, folderId, directory, audioCount)
        if (stopped) return
        if (id) {
          setItemId(id)
          return
        }
        if (++attempts < 6) timer = setTimeout(() => void check(), 3000)
        else setWaiting(false)
      } catch {
        if (!stopped) setWaiting(false)
      }
    }
    timer = setTimeout(() => void check(), 1500)
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [audioCount, directory, folderId, libraryId])

  if (itemId) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span role="status">{t('NoteReadAlongSyncAfterUpload')}</span>
        <Btn to={`/library/${libraryId}/item/${itemId}`} size="small">
          {t('ButtonReadAlongOpenUploadedBook')}
        </Btn>
      </div>
    )
  }
  return <p role="status">{t(waiting ? 'MessageReadAlongIndexing' : 'MessageReadAlongNotIndexed')}</p>
}
