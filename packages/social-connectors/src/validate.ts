import { ErrorCode } from '@social-publisher/shared';

import { countCharacters } from './counting';
import type { ProviderPolicy } from './policies';
import type { ProviderValidationError, ProviderValidationResult } from './types';

export interface ValidatablePostMedia {
  mimeType: string;
  sizeBytes?: number;
  durationSeconds?: number;
  altText?: string;
}

export interface ValidatablePost {
  text: string;
  media: ValidatablePostMedia[];
}

function isVideo(mimeType: string): boolean {
  return mimeType.startsWith('video/');
}

function isImage(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

const PROVIDER_LABELS: Record<string, string> = {
  x: 'X',
  threads: 'Threads',
  instagram: 'Instagram',
  facebook_page: 'Facebook',
};

/**
 * Valida um post contra a política de um provedor. É a MESMA função executada no
 * frontend (feedback instantâneo), no backend (antes de criar jobs) e no worker
 * (imediatamente antes da chamada externa) — nunca confie só na validação do cliente.
 */
export function validatePostAgainstPolicy(
  post: ValidatablePost,
  policy: ProviderPolicy,
): ProviderValidationResult {
  const errors: ProviderValidationError[] = [];
  const label = PROVIDER_LABELS[policy.provider] ?? policy.provider;
  const text = post.text ?? '';
  const trimmed = text.trim();
  const media = post.media ?? [];

  const characterCount = countCharacters(text, policy.text.countingStrategy);
  const maxCharacters = policy.text.maxCharacters;

  // Conteúdo totalmente vazio nunca é publicável.
  if (trimmed.length === 0 && media.length === 0) {
    errors.push({
      code: ErrorCode.TEXT_REQUIRED,
      message: 'Escreva um texto ou adicione uma mídia para publicar.',
    });
  }

  if (maxCharacters !== null && characterCount > maxCharacters) {
    const excess = characterCount - maxCharacters;
    errors.push({
      code: ErrorCode.TEXT_TOO_LONG,
      message: `Remova ${excess} ${excess === 1 ? 'caractere' : 'caracteres'} para publicar no ${label}.`,
    });
  }

  // Mídia obrigatória (ex.: Instagram exige imagem ou vídeo).
  if (!policy.media.textOnlySupported && media.length === 0) {
    errors.push({
      code: ErrorCode.MEDIA_REQUIRED,
      message: `O ${label} exige pelo menos uma imagem ou vídeo.`,
    });
  }

  if (media.length > 0) {
    const imageCount = media.filter((item) => isImage(item.mimeType)).length;
    const videoCount = media.filter((item) => isVideo(item.mimeType)).length;

    const combinedExceeded =
      policy.media.maxItems !== null && media.length > policy.media.maxItems;

    if (combinedExceeded) {
      // Limite combinado: imagens e vídeos contam para o mesmo total.
      errors.push({
        code: ErrorCode.MEDIA_TOO_MANY,
        message: `O ${label} aceita no máximo ${policy.media.maxItems} ${policy.media.maxItems === 1 ? 'mídia' : 'mídias'} por publicação.`,
      });
    } else {
      // Só reporta limites por tipo quando o total geral não estourou, para não
      // duplicar mensagens (ex.: no X, maxImages coincide com maxItems).
      if (policy.media.maxImages !== null && imageCount > policy.media.maxImages) {
        errors.push({
          code: ErrorCode.MEDIA_TOO_MANY,
          message: `O ${label} aceita no máximo ${policy.media.maxImages} ${policy.media.maxImages === 1 ? 'imagem' : 'imagens'} por publicação.`,
        });
      }
      if (policy.media.maxVideos !== null && videoCount > policy.media.maxVideos) {
        errors.push({
          code: ErrorCode.MEDIA_TOO_MANY,
          message: `O ${label} aceita no máximo ${policy.media.maxVideos} ${policy.media.maxVideos === 1 ? 'vídeo' : 'vídeos'} por publicação.`,
        });
      }
    }

    // Alguns provedores (ex.: X) não permitem imagem e vídeo no mesmo post.
    if (!policy.media.allowMixedMedia && imageCount > 0 && videoCount > 0) {
      errors.push({
        code: ErrorCode.MEDIA_NOT_SUPPORTED,
        message: `O ${label} não permite misturar imagens e vídeos na mesma publicação.`,
      });
    }

    for (const [index, item] of media.entries()) {
      const position = index + 1;

      if (isImage(item.mimeType) && !policy.media.imageSupported) {
        errors.push({
          code: ErrorCode.MEDIA_NOT_SUPPORTED,
          message: `O ${label} não aceita imagens (mídia ${position}).`,
        });
        continue;
      }
      if (isVideo(item.mimeType) && !policy.media.videoSupported) {
        errors.push({
          code: ErrorCode.MEDIA_NOT_SUPPORTED,
          message: `O ${label} não aceita vídeos (mídia ${position}).`,
        });
        continue;
      }
      if (!policy.media.acceptedMimeTypes.includes(item.mimeType)) {
        errors.push({
          code: ErrorCode.MEDIA_NOT_SUPPORTED,
          message: `Formato ${item.mimeType} não é aceito pelo ${label} (mídia ${position}).`,
        });
        continue;
      }
      if (
        policy.media.maxFileSizeBytes !== null &&
        item.sizeBytes !== undefined &&
        item.sizeBytes > policy.media.maxFileSizeBytes
      ) {
        const maxMb = Math.floor(policy.media.maxFileSizeBytes / (1024 * 1024));
        errors.push({
          code: ErrorCode.MEDIA_TOO_LARGE,
          message: `A mídia ${position} excede o tamanho máximo de ${maxMb} MB do ${label}.`,
        });
      }
      if (
        isVideo(item.mimeType) &&
        policy.media.maxVideoDurationSeconds !== null &&
        item.durationSeconds !== undefined &&
        item.durationSeconds > policy.media.maxVideoDurationSeconds
      ) {
        errors.push({
          code: ErrorCode.MEDIA_DURATION_EXCEEDED,
          message: `O vídeo ${position} excede a duração máxima de ${policy.media.maxVideoDurationSeconds}s do ${label}.`,
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    characterCount,
    maxCharacters,
  };
}
