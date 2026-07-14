import { Facebook, Instagram, MessageCircle, Twitter, type LucideIcon } from 'lucide-react';

import type { MvpProvider } from './types';

export interface ProviderMeta {
  id: MvpProvider;
  name: string;
  description: string;
  icon: LucideIcon;
  accentClass: string;
  connectNote?: string;
}

export const PROVIDERS_META: Record<MvpProvider, ProviderMeta> = {
  instagram: {
    id: 'instagram',
    name: 'Instagram',
    description: 'Publique imagens, vídeos e carrosséis no feed.',
    icon: Instagram,
    accentClass: 'text-pink-600',
    connectNote:
      'A publicação por API exige conta profissional (criador ou empresa) vinculada a uma Página do Facebook. Contas pessoais não são suportadas.',
  },
  threads: {
    id: 'threads',
    name: 'Threads',
    description: 'Publique textos de até 500 caracteres, com ou sem mídia.',
    icon: MessageCircle,
    accentClass: 'text-foreground',
  },
  x: {
    id: 'x',
    name: 'X',
    description: 'Publique posts de até 280 caracteres (contagem ponderada).',
    icon: Twitter,
    accentClass: 'text-sky-500',
  },
  facebook_page: {
    id: 'facebook_page',
    name: 'Facebook',
    description: 'Publique em Páginas que você administra (não em perfil pessoal).',
    icon: Facebook,
    accentClass: 'text-blue-600',
    connectNote:
      'A publicação acontece em Páginas administradas por você. Após conectar, escolha em quais Páginas publicar.',
  },
};

export const PROVIDER_ORDER: MvpProvider[] = ['instagram', 'threads', 'x', 'facebook_page'];
