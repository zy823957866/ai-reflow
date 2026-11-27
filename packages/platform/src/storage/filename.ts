/**
 * 修复 multipart 将 UTF-8 文件名按 latin1 解码造成的乱码。
 *
 * @param value 原始文件名。
 * @returns 可安全展示与持久化的文件名。
 */
export function normalizeFilenameEncoding(value: string) {
  const filename = value.trim()
  if (
    !filename ||
    [...filename].some((character) => character.codePointAt(0)! > 0xff)
  ) {
    return filename
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(
      Buffer.from(filename, 'latin1'),
    )
  } catch {
    return filename
  }
}
