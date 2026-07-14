import { Button } from '@social-publisher/ui';
import { PenSquare } from 'lucide-react';
import Link from 'next/link';

import { getCurrentUser } from '../lib/auth';

import { LogoutButton } from './logout-button';
import { ThemeToggle } from './theme-toggle';

export async function Header() {
  const user = await getCurrentUser();

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-6">
          <Link href="/" className="text-lg font-semibold">
            social-publisher
          </Link>
          {user && (
            <nav className="hidden items-center gap-4 text-sm text-muted-foreground sm:flex">
              <Link href="/connections" className="hover:text-foreground">
                Conexões
              </Link>
              <Link href="/history" className="hover:text-foreground">
                Histórico
              </Link>
            </nav>
          )}
        </div>
        <div className="flex items-center gap-3">
          {user && (
            <Button asChild size="sm">
              <Link href="/compose">
                <PenSquare className="mr-2 h-4 w-4" />
                Nova publicação
              </Link>
            </Button>
          )}
          <ThemeToggle />
          {user ? (
            <>
              <span className="hidden text-sm text-muted-foreground sm:inline">{user.name}</span>
              <LogoutButton />
            </>
          ) : (
            <Link href="/login" className="text-sm font-medium hover:underline">
              Entrar
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
