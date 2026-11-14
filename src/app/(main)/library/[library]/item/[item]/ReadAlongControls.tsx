'use client'

import type { ReadAlongText } from '@/components/read-along/types'
import Btn from '@/components/ui/Btn'
import ButtonBase from '@/components/ui/ButtonBase'
import { useTypeSafeTranslations } from '@/hooks/useTypeSafeTranslations'
import { withBasePath } from '@/lib/basePath'
import { type Ref, useCallback, useEffect, useRef, useState } from 'react'

const SYNC_POLL_MS = 2500

const syncStates = new Set(['idle', 'queued', 'working', 'complete', 'error'])

type SyncStatus = {
  state: 'idle' | 'queued' | 'working' | 'complete' | 'error'
  progress: number
  revision: string
  code?: string
}

export type ReadAlongSource = {
  itemId: string
  text: ReadAlongText
  audioSrc: string
}

function isSyncing(status: SyncStatus | null) {
  return status?.state === 'queued' || status?.state === 'working'
}

export default function ReadAlongControls({
  itemId,
  itemUpdatedAt,
  openButtonRef,
  onOpen
}: {
  itemId: string
  itemUpdatedAt: number
  openButtonRef: Ref<HTMLButtonElement>
  onOpen: (source: ReadAlongSource) => void
}) {
  const t = useTypeSafeTranslations()
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [isUnavailable, setIsUnavailable] = useState(false)
  const [connectionFailed, setConnectionFailed] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const [readerFailed, setReaderFailed] = useState(false)
  const [isOpening, setIsOpening] = useState(false)
  const statusRequest = useRef<AbortController | null>(null)
  const syncSubmitting = useRef(false)
  const readerRequest = useRef<AbortController | null>(null)
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const endpoint = withBasePath(`/internal-api/items/${encodeURIComponent(itemId)}/read-along`)

  const loadStatus = useCallback(
    async function loadStatus(start: boolean) {
      if (syncSubmitting.current) return
      if (pollTimer.current) clearTimeout(pollTimer.current)
      statusRequest.current?.abort()
      const controller = new AbortController()
      statusRequest.current = controller
      if (start) {
        syncSubmitting.current = true
        setIsStarting(true)
        setConnectionFailed(false)
      }
      try {
        const response = await fetch(endpoint, { method: start ? 'POST' : 'GET', cache: 'no-store', signal: controller.signal })
        if (controller.signal.aborted) return
        if (response.status === 404) {
          setIsUnavailable(true)
          setStatus(null)
          return
        }
        if (!response.ok) throw new Error('Sync status unavailable')
        const next = (await response.json()) as SyncStatus
        if (controller.signal.aborted) return
        if (!syncStates.has(next.state) || !Number.isFinite(next.progress) || typeof next.revision !== 'string') {
          throw new Error('Invalid Sync status')
        }
        setIsUnavailable(false)
        setConnectionFailed(false)
        setStatus(next)
        if (isSyncing(next)) pollTimer.current = setTimeout(() => void loadStatus(false), SYNC_POLL_MS)
      } catch {
        if (!controller.signal.aborted) setConnectionFailed(true)
      } finally {
        if (start) syncSubmitting.current = false
        if (!controller.signal.aborted) {
          setIsStarting(false)
          statusRequest.current = null
        }
      }
    },
    [endpoint]
  )

  useEffect(() => {
    const timer = setTimeout(() => void loadStatus(false), 0)
    return () => {
      clearTimeout(timer)
      if (pollTimer.current) clearTimeout(pollTimer.current)
      // Keep a pending Sync request alive when the book's metadata updates.
      if (!syncSubmitting.current) statusRequest.current?.abort()
    }
  }, [itemUpdatedAt, loadStatus])

  useEffect(
    () => () => {
      statusRequest.current?.abort()
      readerRequest.current?.abort()
    },
    []
  )

  async function openReader() {
    if (status?.state !== 'complete' || readerRequest.current) return
    const controller = new AbortController()
    const query = new URLSearchParams({ revision: status.revision })
    readerRequest.current = controller
    setReaderFailed(false)
    setIsOpening(true)
    try {
      const response = await fetch(`${endpoint}/timings.json?${query}`, { cache: 'no-store', signal: controller.signal })
      if (response.status === 409 || response.status === 404) void loadStatus(false)
      if (!response.ok) throw new Error('Read Along timing data unavailable')
      const text = (await response.json()) as ReadAlongText
      if (!text.pages?.length || !Array.isArray(text.chapters)) throw new Error('Read Along timing data is incomplete')
      if (!controller.signal.aborted) onOpen({ itemId, text, audioSrc: `${endpoint}/audio.mp3?${query}` })
    } catch {
      if (!controller.signal.aborted) setReaderFailed(true)
    } finally {
      readerRequest.current = null
      if (!controller.signal.aborted) setIsOpening(false)
    }
  }

  if (isUnavailable || (!status && !connectionFailed)) return null
  const syncing = isSyncing(status)
  const ready = status?.state === 'complete'
  const percent = Math.max(0, Math.min(99, Math.floor((status?.progress ?? 0) * 100)))
  let syncMessage = ''
  if (isStarting) syncMessage = t('MessageReadAlongStarting')
  else if (status?.state === 'queued') syncMessage = t('MessageReadAlongQueued')
  else if (status?.state === 'working') syncMessage = t('MessageReadAlongWorking', { percent })
  else if (ready) syncMessage = t('MessageReadAlongReady')
  else if (status?.state === 'error') {
    switch (status.code) {
      case 'unreadable-ebook':
        syncMessage = t('MessageReadAlongUnreadableEbook')
        break
      case 'edition-mismatch':
        syncMessage = t('MessageReadAlongEditionMismatch')
        break
      case 'audio-unavailable':
        syncMessage = t('MessageReadAlongAudioUnavailable')
        break
      case 'files-changed':
        syncMessage = t('MessageReadAlongFilesChanged')
        break
      default:
        syncMessage = t('MessageReadAlongSyncFailed')
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      {connectionFailed ? (
        <Btn size="small" onClick={() => void loadStatus(false)}>
          {t('ButtonReadAlongCheckStatus')}
        </Btn>
      ) : ready ? (
        <ButtonBase ref={openButtonRef} onClick={() => void openReader()} aria-busy={isOpening} aria-disabled={isOpening} className="inline-flex px-5">
          {t('LabelReadAlong')}
        </ButtonBase>
      ) : (
        <ButtonBase
          onClick={() => {
            if (!isStarting && !syncing) void loadStatus(true)
          }}
          aria-disabled={syncing || isStarting}
          className="inline-flex px-5"
        >
          {t(status?.state === 'error' ? 'ButtonReadAlongRetry' : 'ButtonReadAlongSync')}
        </ButtonBase>
      )}
      <span role="status" className="text-foreground-muted text-sm">
        {connectionFailed ? t('MessageReadAlongStatusFailed') : syncMessage}
      </span>
      {status?.state === 'working' && <progress className="accent-accent h-2 w-20" value={percent} max={100} aria-label={t('LabelReadAlongSyncProgress')} />}
      {readerFailed && (
        <p role="alert" className="text-error text-sm">
          {t('LabelReadAlongBookLoadError')}
        </p>
      )}
    </div>
  )
}
