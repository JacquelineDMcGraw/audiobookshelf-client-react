import { proxyReadAlong } from '@/lib/proxyReadAlong'
import type { NextRequest } from 'next/server'

type Context = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: Context) {
  return proxyReadAlong(request, (await params).id)
}

export async function POST(request: NextRequest, { params }: Context) {
  return proxyReadAlong(request, (await params).id)
}
