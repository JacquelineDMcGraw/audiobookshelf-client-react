import { proxyReadAlong } from '@/lib/proxyReadAlong'
import type { NextRequest } from 'next/server'

type Context = { params: Promise<{ id: string; asset: string }> }

export async function GET(request: NextRequest, { params }: Context) {
  const { id, asset } = await params
  return proxyReadAlong(request, id, asset)
}

export const HEAD = GET
