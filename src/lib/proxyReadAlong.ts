import 'server-only'

import { getClientBaseUrlFromRequest, getServerBaseUrl, type SessionRefreshTokens } from '@/lib/api'
import { getReadAlongWorker } from '@/lib/readAlongConfig'
import { getReadAlongPair } from '@/lib/readAlongPair'
import { attachRefreshedSessionCookies, fetchBackendWithCookieRefresh } from '@/lib/serverBackendProxy'
import type { LibraryItem } from '@/types/api'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

const noStore = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }

function fail(status: number, refreshedTokens: SessionRefreshTokens | null = null) {
  return attachRefreshedSessionCookies(NextResponse.json({ error: 'Read Along request failed' }, { status, headers: noStore }), refreshedTokens)
}

export async function proxyReadAlong(request: NextRequest, id: string, asset?: string) {
  const worker = getReadAlongWorker()
  if (!worker || !/^[A-Za-z0-9_-]{1,128}$/.test(id) || (asset !== undefined && asset !== 'timings.json' && asset !== 'audio.mp3')) return fail(404)

  const method = request.method
  if (method === 'POST') {
    const origin = request.headers.get('origin')
    if (!origin || origin !== new URL(getClientBaseUrlFromRequest(request)).origin) return fail(403)
  }

  let refreshedTokens: SessionRefreshTokens | null = null
  try {
    const backend = await fetchBackendWithCookieRefresh(`${getServerBaseUrl()}/api/items/${id}?expanded=1`, await cookies(), {
      cache: 'no-store',
      redirect: 'error'
    })
    refreshedTokens = backend.refreshedTokens
    if (!backend.ok) return fail(backend.status, refreshedTokens)
    const item = (await backend.upstream.json()) as LibraryItem
    const pair = item?.id === id ? getReadAlongPair(item) : null
    if (!pair) return fail(404, refreshedTokens)
    if (asset && request.nextUrl.searchParams.get('revision') !== pair.revision) return fail(409, refreshedTokens)

    const upstream = new URL(`/jobs/${id}${asset ? `/${asset}` : ''}`, worker.origin)
    upstream.searchParams.set('revision', pair.revision)
    const headers = new Headers({ Authorization: `Bearer ${worker.token}` })
    const range = request.headers.get('range')
    if (range && asset === 'audio.mp3') headers.set('Range', range)
    if (method === 'POST') headers.set('Content-Type', 'application/json')

    const result = await fetch(upstream, {
      method,
      headers,
      body: method === 'POST' ? JSON.stringify({ ebook: pair.ebook, audio: pair.audio }) : undefined,
      cache: 'no-store',
      redirect: 'error',
      signal: request.signal
    })

    if (!asset) {
      if (!result.ok) {
        await result.body?.cancel()
        return fail(result.status === 401 ? 502 : result.status, refreshedTokens)
      }
      const data = (await result.json()) as { state: string; progress: number; code?: string }
      return attachRefreshedSessionCookies(
        NextResponse.json(
          { state: data.state, progress: data.progress, code: data.code, revision: pair.revision },
          { status: result.status, headers: noStore }
        ),
        refreshedTokens
      )
    }

    if (!result.ok && result.status !== 416) {
      await result.body?.cancel()
      return fail(result.status === 401 ? 502 : result.status, refreshedTokens)
    }
    const responseHeaders = new Headers(noStore)
    responseHeaders.set('Content-Type', asset === 'audio.mp3' ? 'audio/mpeg' : 'application/json')
    for (const name of ['content-length', 'content-range', 'accept-ranges']) {
      const value = result.headers.get(name)
      if (value) responseHeaders.set(name, value)
    }
    return attachRefreshedSessionCookies(new NextResponse(result.body, { status: result.status, headers: responseHeaders }), refreshedTokens)
  } catch {
    return fail(502, refreshedTokens)
  }
}
