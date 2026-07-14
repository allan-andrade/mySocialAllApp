import type { SocialProvider } from '@social-publisher/shared';

import type { ProviderCapabilities } from './types';

/**
 * Configuração central de capacidades e limites por provedor (seção 5 do briefing).
 * NENHUM número de limite deve existir fora deste arquivo — frontend, backend e
 * worker validam contra estas mesmas políticas. Os valores são pontos de partida
 * configuráveis; a API oficial de cada provedor continua sendo a validação final.
 */
export type ProviderPolicy = { provider: SocialProvider } & ProviderCapabilities;

const MB = 1024 * 1024;

export const PROVIDER_POLICIES: Record<
  Extract<SocialProvider, 'instagram' | 'threads' | 'x' | 'facebook_page'>,
  ProviderPolicy
> = {
  x: {
    provider: 'x',
    text: {
      supported: true,
      maxCharacters: 280,
      // Contagem ponderada oficial do X (twitter-text): URLs valem 23,
      // CJK/emoji valem 2, Latin/espaços valem 1 — nunca string.length.
      countingStrategy: 'x-weighted',
    },
    media: {
      imageSupported: true,
      videoSupported: true,
      carouselSupported: false, // multi-imagem existe no X, mas não como carrossel; MVP publica até 4 imagens
      textOnlySupported: true,
      // No X: até 4 imagens OU 1 vídeo — nunca imagem e vídeo no mesmo post.
      maxItems: 4,
      maxImages: 4,
      maxVideos: 1,
      allowMixedMedia: false,
      acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4'],
      maxFileSizeBytes: 512 * MB,
      maxVideoDurationSeconds: 140,
    },
  },
  threads: {
    provider: 'threads',
    text: {
      supported: true,
      maxCharacters: 500,
      countingStrategy: 'unicode-code-points',
    },
    media: {
      imageSupported: true,
      videoSupported: true,
      carouselSupported: true,
      textOnlySupported: true,
      // Threads: até 10 mídias por post, contando imagens e vídeos no mesmo total.
      maxItems: 10,
      maxImages: 10,
      maxVideos: 10,
      allowMixedMedia: true,
      acceptedMimeTypes: ['image/jpeg', 'image/png', 'video/mp4', 'video/quicktime'],
      maxFileSizeBytes: 1024 * MB,
      maxVideoDurationSeconds: 300,
    },
  },
  instagram: {
    provider: 'instagram',
    text: {
      supported: true,
      maxCharacters: 2200,
      countingStrategy: 'unicode-code-points',
    },
    media: {
      imageSupported: true,
      videoSupported: true,
      carouselSupported: true,
      // Publicação comum de feed exige pelo menos uma imagem ou vídeo.
      textOnlySupported: false,
      // Instagram: até 10 mídias (imagens e/ou vídeos). 1 item = publicação
      // única; 2+ itens = carrossel (ver describeInstagramComposition).
      maxItems: 10,
      maxImages: 10,
      maxVideos: 10,
      allowMixedMedia: true,
      acceptedMimeTypes: ['image/jpeg', 'image/png', 'video/mp4', 'video/quicktime'],
      maxFileSizeBytes: 1024 * MB,
      maxVideoDurationSeconds: 900,
    },
  },
  facebook_page: {
    provider: 'facebook_page',
    text: {
      supported: true,
      // Limite próprio configurável; a Graph API valida novamente na publicação.
      maxCharacters: 63206,
      countingStrategy: 'simple',
    },
    media: {
      imageSupported: true,
      videoSupported: true,
      carouselSupported: true,
      textOnlySupported: true,
      maxItems: 10,
      maxImages: 10,
      maxVideos: 10,
      allowMixedMedia: true,
      acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'video/mp4'],
      maxFileSizeBytes: 1024 * MB,
      maxVideoDurationSeconds: 1200,
    },
  },
};

export type InstagramComposition = 'empty' | 'single' | 'carousel';

/**
 * Particularidade do Instagram: 1 mídia é uma publicação única; 2+ mídias formam
 * um carrossel (imagens e vídeos podem se misturar). Usado para informar o usuário
 * no compositor — a validação de contagem continua em validatePostAgainstPolicy.
 */
export function describeInstagramComposition(mediaCount: number): InstagramComposition {
  if (mediaCount <= 0) return 'empty';
  if (mediaCount === 1) return 'single';
  return 'carousel';
}

export function getProviderPolicy(provider: SocialProvider): ProviderPolicy {
  const policy = (PROVIDER_POLICIES as Partial<Record<SocialProvider, ProviderPolicy>>)[provider];
  if (!policy) {
    throw new Error(`Nenhuma política configurada para o provedor "${provider}".`);
  }
  return policy;
}
