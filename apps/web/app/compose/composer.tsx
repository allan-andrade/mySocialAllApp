'use client';

import { Textarea } from '@social-publisher/ui';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { MockModeBanner } from '../../components/mock-mode-banner';
import { ApiError } from '../../lib/api-client';
import {
  computePublishBlockers,
  countForProvider,
  detectLinks,
  validateForProvider,
  type ComposerMediaInput,
  type ProviderOverrides,
} from '../../lib/composer-logic';
import { PROVIDER_ORDER } from '../../lib/providers-meta';
import {
  createDraft,
  createPublication,
  deleteDraft,
  getDraft,
  updateDraft,
  useConnections,
} from '../../lib/queries';
import type { DraftDto, MvpProvider } from '../../lib/types';

import { CustomTextDialog } from './custom-text-dialog';
import { MediaUploader, type ComposerMediaItem } from './media-uploader';
import { PlatformToggleCard } from './platform-toggle-card';
import { PreviewPanel } from './preview-panel';
import { PublishBar } from './publish-bar';

export function Composer() {
  const connectionsQuery = useConnections();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [text, setText] = useState('');
  const [selected, setSelected] = useState<MvpProvider[]>([]);
  const [overrides, setOverrides] = useState<ProviderOverrides>({});
  const [mediaItems, setMediaItems] = useState<ComposerMediaItem[]>([]);
  const [customizing, setCustomizing] = useState<MvpProvider | null>(null);

  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<Date | null>(null);
  const draftIdRef = useRef<string | null>(null);
  const savingRef = useRef(false);

  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  // Uma chave por sessão de composição: repetição da requisição (timeout, clique
  // duplo) reaproveita a mesma publicação em vez de duplicar (seção 9).
  const idempotencyKeyRef = useRef<string>(crypto.randomUUID());

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Duplicar/retomar rascunho: /compose?draft=<id> hidrata o estado inicial.
  useEffect(() => {
    const fromDraft = searchParams.get('draft');
    if (!fromDraft) return;
    getDraft(fromDraft)
      .then((draft) => {
        setText(draft.text);
        setSelected(draft.selectedProviders);
        setOverrides(
          Object.fromEntries(
            Object.entries(draft.providerOverrides ?? {}).map(([provider, value]) => [
              provider,
              value!.text,
            ]),
          ) as ProviderOverrides,
        );
        draftIdRef.current = draft.id;
        setDraftId(draft.id);
      })
      .catch(() => undefined);
    // Roda apenas na montagem: o parâmetro ?draft= só importa na carga inicial.
  }, []);

  // Textarea expansível: acompanha o conteúdo.
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 480)}px`;
    }
  }, [text]);

  // Salvamento automático de rascunho com debounce.
  useEffect(() => {
    if (text === '' && selected.length === 0 && Object.keys(overrides).length === 0) return;

    const timer = setTimeout(async () => {
      if (savingRef.current) return;
      savingRef.current = true;
      try {
        const payload: Partial<DraftDto> = {
          text,
          selectedProviders: selected,
          providerOverrides: Object.fromEntries(
            Object.entries(overrides).map(([provider, value]) => [provider, { text: value! }]),
          ) as DraftDto['providerOverrides'],
        };
        if (draftIdRef.current) {
          await updateDraft(draftIdRef.current, payload);
        } else {
          const draft = await createDraft(payload);
          draftIdRef.current = draft.id;
          setDraftId(draft.id);
        }
        setDraftSavedAt(new Date());
      } catch {
        // Autosave é melhor esforço; erros não interrompem a composição.
      } finally {
        savingRef.current = false;
      }
    }, 800);

    return () => clearTimeout(timer);
  }, [text, selected, overrides]);

  const mediaInputs: ComposerMediaInput[] = useMemo(
    () =>
      mediaItems.map((item) => ({
        mimeType: item.mimeType,
        sizeBytes: item.sizeBytes,
        durationSeconds: item.asset?.durationSeconds ?? item.probedDurationSeconds,
      })),
    [mediaItems],
  );

  const connections = connectionsQuery.data?.connections ?? [];
  const connectionFor = useCallback(
    (provider: MvpProvider) =>
      connections.find((c) => c.provider === provider && c.status === 'CONNECTED'),
    [connections],
  );

  const validations = useMemo(() => {
    const result: Partial<Record<MvpProvider, ReturnType<typeof validateForProvider>>> = {};
    for (const provider of selected) {
      result[provider] = validateForProvider(provider, text, overrides, mediaInputs);
    }
    return result;
  }, [selected, text, overrides, mediaInputs]);

  const hasUploadInProgress = mediaItems.some((item) => item.status === 'uploading');
  const hasUnprocessedMedia = mediaItems.some((item) => item.status === 'error');

  const blockers = computePublishBlockers({
    selectedProviders: selected,
    validations,
    hasUploadInProgress,
    hasUnprocessedMedia,
    baseText: text,
    mediaCount: mediaItems.filter((item) => item.status === 'ready').length,
  });

  const links = detectLinks(text);

  function toggleProvider(provider: MvpProvider, on: boolean) {
    setSelected((current) =>
      on ? [...current, provider] : current.filter((item) => item !== provider),
    );
  }

  async function handlePublish(): Promise<void> {
    setPublishing(true);
    setPublishError(null);
    try {
      const publication = await createPublication({
        text,
        providers: selected,
        providerOverrides: Object.fromEntries(
          Object.entries(overrides).map(([provider, value]) => [provider, { text: value! }]),
        ),
        media: mediaItems
          .filter((item) => item.status === 'ready' && item.asset)
          .map((item) => ({
            mediaAssetId: item.asset!.id,
            altText: item.altText || undefined,
          })),
        idempotencyKey: idempotencyKeyRef.current,
        draftId: draftIdRef.current ?? undefined,
      });
      // Rascunho vira publicação: remove para não poluir a lista.
      if (draftIdRef.current) {
        await deleteDraft(draftIdRef.current).catch(() => undefined);
      }
      router.push(`/history/${publication.id}`);
    } catch (error) {
      setPublishError(
        error instanceof ApiError ? error.message : 'Não foi possível enviar a publicação.',
      );
      setPublishing(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 pb-24">
      <div>
        <h1 className="text-2xl font-semibold">Nova publicação</h1>
        <p className="text-sm text-muted-foreground">
          Escreva uma vez e publique em todas as redes selecionadas.
        </p>
      </div>

      <MockModeBanner mode={connectionsQuery.data?.mode} />

      <div className="flex flex-col gap-2">
        <Textarea
          ref={textareaRef}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="O que você quer publicar?"
          className="min-h-[120px] resize-none text-base"
          aria-label="Texto da publicação"
        />
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {Array.from(text).length} caracteres
            {links.length > 0 &&
              ` · ${links.length} ${links.length === 1 ? 'link detectado' : 'links detectados'}`}
          </span>
          <span>
            {draftSavedAt
              ? `Rascunho salvo às ${draftSavedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
              : draftId
                ? 'Salvando...'
                : ''}
          </span>
        </div>
      </div>

      <MediaUploader items={mediaItems} onChange={setMediaItems} />

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Plataformas</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {PROVIDER_ORDER.map((provider) => (
            <PlatformToggleCard
              key={provider}
              provider={provider}
              connection={connectionFor(provider)}
              enabled={selected.includes(provider)}
              onToggle={(on) => toggleProvider(provider, on)}
              counter={countForProvider(provider, text, overrides)}
              validation={selected.includes(provider) ? validations[provider] : undefined}
              hasOverride={overrides[provider] !== undefined}
              onCustomize={() => setCustomizing(provider)}
              loadingConnections={connectionsQuery.isLoading}
            />
          ))}
        </div>
      </section>

      {selected.length > 0 && (
        <PreviewPanel
          providers={selected}
          baseText={text}
          overrides={overrides}
          mediaItems={mediaItems}
          connectionFor={connectionFor}
        />
      )}

      <PublishBar
        selectedCount={selected.length}
        blockers={blockers}
        providers={selected}
        baseText={text}
        overrides={overrides}
        mediaItems={mediaItems}
        onConfirm={handlePublish}
        publishing={publishing}
        publishError={publishError}
      />

      {customizing && (
        <CustomTextDialog
          provider={customizing}
          baseText={text}
          currentOverride={overrides[customizing]}
          onClose={() => setCustomizing(null)}
          onSave={(value) => {
            setOverrides((current) => {
              const next = { ...current };
              if (value === undefined) {
                delete next[customizing];
              } else {
                next[customizing] = value;
              }
              return next;
            });
            setCustomizing(null);
          }}
        />
      )}
    </div>
  );
}
