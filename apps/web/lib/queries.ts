'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiFetch } from './api-client';
import type {
  ConnectionsResponse,
  DraftDto,
  MvpProvider,
  ProviderPageDto,
  PublicationDto,
  PublicationListResponse,
} from './types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export function connectAuthorizeUrl(provider: string): string {
  return `${API_URL}/api/v1/social-connections/${provider}/authorize`;
}

export function useConnections() {
  return useQuery({
    queryKey: ['social-connections'],
    queryFn: () => apiFetch<ConnectionsResponse>('/api/v1/social-connections'),
  });
}

export function useDisconnectConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ success: boolean }>(`/api/v1/social-connections/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['social-connections'] }),
  });
}

export function useFacebookPages(connectionId: string | null) {
  return useQuery({
    queryKey: ['facebook-pages', connectionId],
    queryFn: () =>
      apiFetch<ProviderPageDto[]>(`/api/v1/social-connections/${connectionId}/facebook-pages`),
    enabled: connectionId !== null,
  });
}

export function useConnectFacebookPage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ connectionId, pageId }: { connectionId: string; pageId: string }) =>
      apiFetch(`/api/v1/social-connections/${connectionId}/facebook-pages/${pageId}/connect`, {
        method: 'POST',
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['social-connections'] }),
  });
}

export function useDisconnectFacebookPage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (pageConnectionId: string) =>
      apiFetch(`/api/v1/facebook-pages/${pageConnectionId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['social-connections'] }),
  });
}

export async function createDraft(payload: Partial<DraftDto>): Promise<DraftDto> {
  return apiFetch<DraftDto>('/api/v1/drafts', { method: 'POST', body: JSON.stringify(payload) });
}

export async function updateDraft(id: string, payload: Partial<DraftDto>): Promise<DraftDto> {
  return apiFetch<DraftDto>(`/api/v1/drafts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function getDraft(id: string): Promise<DraftDto> {
  return apiFetch<DraftDto>(`/api/v1/drafts/${id}`);
}

export async function deleteDraft(id: string): Promise<void> {
  await apiFetch(`/api/v1/drafts/${id}`, { method: 'DELETE' });
}

// ── Publicações ──────────────────────────────────────────────────────────

export interface CreatePublicationPayload {
  text: string;
  providers: MvpProvider[];
  providerOverrides?: Partial<Record<MvpProvider, { text: string }>>;
  media: Array<{ mediaAssetId: string; altText?: string }>;
  idempotencyKey: string;
  draftId?: string;
}

export async function createPublication(payload: CreatePublicationPayload): Promise<PublicationDto> {
  return apiFetch<PublicationDto>('/api/v1/publications', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

const ACTIVE_PUBLICATION_STATUSES = new Set(['QUEUED', 'PROCESSING']);
const ACTIVE_TARGET_STATUSES = new Set([
  'PENDING',
  'VALIDATING',
  'UPLOADING_MEDIA',
  'CREATING_CONTAINER',
  'WAITING_PROCESSING',
  'PUBLISHING',
  'RETRY_SCHEDULED',
]);

export function isPublicationActive(publication: PublicationDto | undefined): boolean {
  if (!publication) return false;
  return (
    ACTIVE_PUBLICATION_STATUSES.has(publication.status) ||
    publication.targets.some((t) => ACTIVE_TARGET_STATUSES.has(t.status))
  );
}

export function usePublication(id: string) {
  return useQuery({
    queryKey: ['publication', id],
    queryFn: () => apiFetch<PublicationDto>(`/api/v1/publications/${id}`),
    // Enquanto houver destino em processamento, acompanha ao vivo.
    refetchInterval: (query) => (isPublicationActive(query.state.data) ? 1500 : false),
  });
}

export function usePublications(filters: { status?: string; provider?: string; q?: string }) {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.provider) params.set('provider', filters.provider);
  if (filters.q) params.set('q', filters.q);
  params.set('limit', '20');
  return useQuery({
    queryKey: ['publications', filters],
    queryFn: () => apiFetch<PublicationListResponse>(`/api/v1/publications?${params.toString()}`),
  });
}

export function useRetryTarget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (targetId: string) =>
      apiFetch(`/api/v1/publication-targets/${targetId}/retry`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['publication'] });
      queryClient.invalidateQueries({ queryKey: ['publications'] });
    },
  });
}

export function useRetryPublication() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (publicationId: string) =>
      apiFetch(`/api/v1/publications/${publicationId}/retry`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['publication'] });
      queryClient.invalidateQueries({ queryKey: ['publications'] });
    },
  });
}

export function useDeletePublication() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (publicationId: string) =>
      apiFetch(`/api/v1/publications/${publicationId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['publications'] }),
  });
}
