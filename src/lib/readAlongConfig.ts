import 'server-only'

export function getReadAlongWorker() {
  const address = process.env.READ_ALONG_WORKER_URL
  const token = process.env.READ_ALONG_WORKER_TOKEN
  if (!address || !token || !/^[A-Za-z0-9_-]{32,256}$/.test(token)) return null

  try {
    const url = new URL(address)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') return null
    return { origin: url.origin, token }
  } catch {
    return null
  }
}

export function isReadAlongConfigured() {
  return getReadAlongWorker() !== null
}
