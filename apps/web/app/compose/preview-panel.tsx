'use client';

import { describeInstagramComposition } from '@social-publisher/social-connectors';
import { Badge, Card, CardContent } from '@social-publisher/ui';

import { countForProvider, textForProvider, type ProviderOverrides } from '../../lib/composer-logic';
import { PROVIDERS_META } from '../../lib/providers-meta';
import type { MvpProvider, SocialConnectionDto } from '../../lib/types';

import type { ComposerMediaItem } from './media-uploader';

export function PreviewPanel({
  providers,
  baseText,
  overrides,
  mediaItems,
  connectionFor,
}: {
  providers: MvpProvider[];
  baseText: string;
  overrides: ProviderOverrides;
  mediaItems: ComposerMediaItem[];
  connectionFor: (provider: MvpProvider) => SocialConnectionDto | undefined;
}) {
  const readyMedia = mediaItems.filter((item) => item.status === 'ready' || item.status === 'uploading');

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-medium">Preview</h2>
        <span className="text-xs text-muted-foreground">
          Prévia aproximada — o resultado final pode variar em cada rede.
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {providers.map((provider) => {
          const meta = PROVIDERS_META[provider];
          const Icon = meta.icon;
          const connection = connectionFor(provider);
          const text = textForProvider(baseText, overrides, provider);
          const counter = countForProvider(provider, baseText, overrides);

          return (
            <Card key={provider}>
              <CardContent className="flex flex-col gap-3 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon className={`h-4 w-4 ${meta.accentClass}`} aria-hidden />
                    <span className="text-sm font-medium">{meta.name}</span>
                    {provider === 'instagram' && readyMedia.length >= 1 && (
                      <Badge variant="outline" className="text-[10px]">
                        {describeInstagramComposition(readyMedia.length) === 'carousel'
                          ? 'Carrossel'
                          : 'Publicação única'}
                      </Badge>
                    )}
                  </div>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {counter.count}
                    {counter.max !== null && `/${counter.max}`}
                  </span>
                </div>

                <div className="flex items-start gap-2">
                  <div className="h-8 w-8 shrink-0 rounded-full bg-muted" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {connection?.externalAccountName ?? 'Sua conta'}
                      <span className="ml-1 font-normal text-muted-foreground">
                        @{connection?.username ?? meta.id}
                      </span>
                    </p>
                    <p className="whitespace-pre-wrap break-words text-sm">
                      {text || <span className="text-muted-foreground">(sem texto)</span>}
                    </p>
                  </div>
                </div>

                {readyMedia.length > 0 && (
                  <div
                    className={`grid gap-1 ${readyMedia.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}
                  >
                    {readyMedia.slice(0, 4).map((item) =>
                      item.mimeType.startsWith('video/') ? (
                        <video
                          key={item.localId}
                          src={item.previewUrl}
                          className="aspect-square w-full rounded object-cover"
                          muted
                        />
                      ) : (
                        <img
                          key={item.localId}
                          src={item.previewUrl}
                          alt={item.altText || ''}
                          className="aspect-square w-full rounded object-cover"
                        />
                      ),
                    )}
                  </div>
                )}
                {readyMedia.length > 4 && (
                  <Badge variant="secondary" className="self-start text-[10px]">
                    +{readyMedia.length - 4} mídias
                  </Badge>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
