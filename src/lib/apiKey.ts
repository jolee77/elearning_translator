export function maskApiKey(key: string | null | undefined): string {
  if (!key) return ''

  if (key.startsWith('sk-ant-')) {
    const visible = key.slice(0, 10)
    return `${visible}...*****`
  }

  const visible = key.slice(0, Math.min(7, key.length))
  return `${visible}...*****`
}
