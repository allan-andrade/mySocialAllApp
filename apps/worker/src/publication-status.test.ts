import { describe, expect, it } from 'vitest';

import { computePublicationStatus } from './publication-status';

describe('computePublicationStatus', () => {
  it('todos publicados → PUBLISHED', () => {
    expect(computePublicationStatus(['PUBLISHED', 'PUBLISHED'])).toBe('PUBLISHED');
  });

  it('sucesso parcial → PARTIALLY_PUBLISHED (falha no X não desfaz o Threads)', () => {
    expect(computePublicationStatus(['PUBLISHED', 'FAILED'])).toBe('PARTIALLY_PUBLISHED');
    expect(computePublicationStatus(['PUBLISHED', 'CANCELLED'])).toBe('PARTIALLY_PUBLISHED');
  });

  it('todos falharam → FAILED', () => {
    expect(computePublicationStatus(['FAILED', 'FAILED'])).toBe('FAILED');
  });

  it('todos cancelados → CANCELLED; misto falha+cancelado → FAILED', () => {
    expect(computePublicationStatus(['CANCELLED', 'CANCELLED'])).toBe('CANCELLED');
    expect(computePublicationStatus(['FAILED', 'CANCELLED'])).toBe('FAILED');
  });

  it('algum destino ainda ativo → PROCESSING', () => {
    expect(computePublicationStatus(['PUBLISHED', 'PUBLISHING'])).toBe('PROCESSING');
    expect(computePublicationStatus(['FAILED', 'RETRY_SCHEDULED'])).toBe('PROCESSING');
  });

  it('nenhum destino começou → QUEUED', () => {
    expect(computePublicationStatus(['PENDING', 'PENDING'])).toBe('QUEUED');
  });
});
