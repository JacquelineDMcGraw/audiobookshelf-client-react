'use client'

import Btn from '@/components/ui/Btn'
import FilePicker from '@/components/widgets/FilePicker'
import { useTypeSafeTranslations } from '@/hooks/useTypeSafeTranslations'
import { SupportedFileTypes } from '@/lib/fileUtils'
import { useState } from 'react'
import { createReadAlongUploadItem, type CleanedItem } from './UploadHelper'

export default function ReadAlongPairPicker({ onStage }: { onStage: (item: CleanedItem) => void }) {
  const t = useTypeSafeTranslations()
  const [ebook, setEbook] = useState<File>()
  const [audio, setAudio] = useState<File[]>([])
  const [invalid, setInvalid] = useState(false)

  const stage = () => {
    if (!ebook || !audio.length) return
    const item = createReadAlongUploadItem(ebook, audio)
    if (!item) {
      setInvalid(true)
      return
    }
    onStage(item)
  }

  return (
    <details className="border-border rounded-md border p-4">
      <summary className="min-h-8 cursor-pointer font-semibold">{t('LabelReadAlongUploadPair')}</summary>
      <p className="text-foreground-muted mt-2 text-sm">{t('NoteReadAlongChoosePair')}</p>
      <div className="my-3 flex flex-col gap-3 sm:flex-row">
        <div className="min-w-0">
          <FilePicker
            accept=".epub,.pdf"
            onFilesSelected={(files) => {
              setEbook(files[0])
              setInvalid(false)
            }}
          >
            {t('ButtonReadAlongChooseEbook')}
          </FilePicker>
          {ebook && <p className="mt-1 max-w-72 text-sm break-all">{ebook.name}</p>}
        </div>
        <div className="min-w-0">
          <FilePicker
            accept={SupportedFileTypes.audio.map((extension) => `.${extension}`).join(',')}
            multiple
            onFilesSelected={(files) => {
              setAudio(Array.from(files))
              setInvalid(false)
            }}
          >
            {t('ButtonReadAlongChooseAudio')}
          </FilePicker>
          {audio.length > 0 && <p className="mt-1 text-sm">{t('LabelReadAlongAudioSelection', { count: audio.length })}</p>}
        </div>
      </div>
      {invalid && (
        <p className="text-error mb-3 text-sm" role="alert">
          {t('MessageReadAlongInvalidPair')}
        </p>
      )}
      <Btn onClick={stage} disabled={!ebook || audio.length === 0}>
        {t('ButtonReadAlongStagePair')}
      </Btn>
    </details>
  )
}
