/**
 * Verificação de MIME real pelos primeiros bytes do arquivo — extensão e header
 * Content-Type declarados pelo cliente não são confiáveis (seção 13: "validar MIME
 * real, e não somente extensão"). Cobre os formatos aceitos pelo MVP.
 */
export function matchesDeclaredMime(header: Buffer, declaredMime: string): boolean {
  switch (declaredMime) {
    case 'image/jpeg':
      return header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
    case 'image/png':
      return header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/gif':
      return header.subarray(0, 3).toString('ascii') === 'GIF';
    case 'image/webp':
      return (
        header.subarray(0, 4).toString('ascii') === 'RIFF' &&
        header.subarray(8, 12).toString('ascii') === 'WEBP'
      );
    case 'video/mp4':
    case 'video/quicktime':
      // Contêiner ISO-BMFF: bytes 4..8 = "ftyp" (mp4, mov).
      return header.subarray(4, 8).toString('ascii') === 'ftyp';
    default:
      return false;
  }
}

export const MAGIC_HEADER_LENGTH = 16;
