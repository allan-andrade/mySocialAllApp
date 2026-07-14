import { FlaskConical } from 'lucide-react';

export function MockModeBanner({ mode }: { mode: 'mock' | 'live' | undefined }) {
  if (mode !== 'mock') return null;
  return (
    <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
      <FlaskConical className="h-4 w-4 shrink-0" />
      <span>
        Modo de desenvolvimento (mock): as conexões e publicações são simuladas — nada é enviado
        às redes sociais reais.
      </span>
    </div>
  );
}
