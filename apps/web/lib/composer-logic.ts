import {
  countCharacters,
  getProviderPolicy,
  validatePostAgainstPolicy,
  type ProviderValidationResult,
} from '@social-publisher/social-connectors';

import type { MvpProvider } from './types';

export interface ComposerMediaInput {
  mimeType: string;
  sizeBytes?: number;
  durationSeconds?: number;
}

export type ProviderOverrides = Partial<Record<MvpProvider, string>>;

/** Texto efetivo de uma plataforma: personalização quando existir, senão o texto base. */
export function textForProvider(
  baseText: string,
  overrides: ProviderOverrides,
  provider: MvpProvider,
): string {
  return overrides[provider] ?? baseText;
}

export function validateForProvider(
  provider: MvpProvider,
  baseText: string,
  overrides: ProviderOverrides,
  media: ComposerMediaInput[],
): ProviderValidationResult {
  return validatePostAgainstPolicy(
    { text: textForProvider(baseText, overrides, provider), media },
    getProviderPolicy(provider),
  );
}

export function countForProvider(
  provider: MvpProvider,
  baseText: string,
  overrides: ProviderOverrides,
): { count: number; max: number | null } {
  const policy = getProviderPolicy(provider);
  return {
    count: countCharacters(textForProvider(baseText, overrides, provider), policy.text.countingStrategy),
    max: policy.text.maxCharacters,
  };
}

export interface PublishBlockersInput {
  selectedProviders: MvpProvider[];
  validations: Partial<Record<MvpProvider, ProviderValidationResult>>;
  hasUploadInProgress: boolean;
  hasUnprocessedMedia: boolean;
  baseText: string;
  mediaCount: number;
}

/** Regras de bloqueio do botão Publicar (seção 7). Lista vazia = liberado. */
export function computePublishBlockers(input: PublishBlockersInput): string[] {
  const blockers: string[] = [];

  if (input.selectedProviders.length === 0) {
    blockers.push('Selecione ao menos uma plataforma.');
  }
  if (input.hasUploadInProgress) {
    blockers.push('Aguarde os uploads em andamento terminarem.');
  }
  if (input.hasUnprocessedMedia) {
    blockers.push('Há mídia ainda não processada.');
  }
  if (input.baseText.trim().length === 0 && input.mediaCount === 0) {
    blockers.push('Escreva um texto ou adicione uma mídia.');
  }

  const invalid = input.selectedProviders.filter(
    (provider) => input.validations[provider] && !input.validations[provider]!.valid,
  );
  if (invalid.length > 0) {
    blockers.push(`Corrija ou desative as plataformas com erro: ${invalid.join(', ')}.`);
  }

  return blockers;
}

const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/g;

/** Detecção simples de links para feedback no compositor (o X conta cada um como 23). */
export function detectLinks(text: string): string[] {
  return text.match(URL_PATTERN) ?? [];
}
