import type { Metadata } from 'next';

import { Header } from '../components/header';

import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'social-publisher',
  description: 'Publique em várias redes sociais de uma vez.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body className="min-h-screen font-sans antialiased">
        <Providers>
          <Header />
          <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
