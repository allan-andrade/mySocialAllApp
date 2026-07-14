import { apiFetch } from './api-client';
import type { MediaAssetDto } from './types';

export interface UploadHandle {
  abort: () => void;
  promise: Promise<MediaAssetDto>;
}

interface MediaProbe {
  width?: number;
  height?: number;
  durationSeconds?: number;
}

/** Mede dimensões/duração no navegador (melhor esforço; o servidor revalida o conteúdo). */
async function probeMedia(file: File): Promise<MediaProbe> {
  const objectUrl = URL.createObjectURL(file);
  try {
    if (file.type.startsWith('image/')) {
      return await new Promise<MediaProbe>((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => resolve({});
        img.src = objectUrl;
      });
    }
    if (file.type.startsWith('video/')) {
      return await new Promise<MediaProbe>((resolve) => {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.onloadedmetadata = () =>
          resolve({
            width: video.videoWidth,
            height: video.videoHeight,
            durationSeconds: Number.isFinite(video.duration) ? video.duration : undefined,
          });
        video.onerror = () => resolve({});
        video.src = objectUrl;
      });
    }
    return {};
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Upload direto ao storage via URL assinada (o backend nunca recebe o arquivo):
 * presigned-upload → PUT com progresso (XHR, pois fetch não expõe progresso de
 * upload) → complete (validação de MIME real no servidor).
 */
export function uploadMedia(file: File, onProgress: (percent: number) => void): UploadHandle {
  const xhr = new XMLHttpRequest();
  let aborted = false;

  const promise = (async (): Promise<MediaAssetDto> => {
    const { mediaAssetId, uploadUrl } = await apiFetch<{
      mediaAssetId: string;
      uploadUrl: string;
    }>('/api/v1/media/presigned-upload', {
      method: 'POST',
      body: JSON.stringify({ filename: file.name, mimeType: file.type, sizeBytes: file.size }),
    });

    await new Promise<void>((resolve, reject) => {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress((event.loaded / event.total) * 100);
      };
      xhr.onload = () =>
        xhr.status >= 200 && xhr.status < 300
          ? resolve()
          : reject(new Error(`Falha no upload (HTTP ${xhr.status}).`));
      xhr.onerror = () => reject(new Error('Falha de rede durante o upload.'));
      xhr.onabort = () => reject(new Error('Upload cancelado.'));
      xhr.open('PUT', uploadUrl);
      xhr.setRequestHeader('Content-Type', file.type);
      xhr.send(file);
    });

    const probe = await probeMedia(file);
    return apiFetch<MediaAssetDto>('/api/v1/media/complete', {
      method: 'POST',
      body: JSON.stringify({ mediaAssetId, ...probe }),
    });
  })();

  return {
    abort: () => {
      aborted = true;
      xhr.abort();
    },
    promise: promise.catch((error) => {
      if (aborted) throw new Error('Upload cancelado.');
      throw error;
    }),
  };
}
