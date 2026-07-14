'use client';

import { Button } from '@social-publisher/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { apiFetch } from '../lib/api-client';

export function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleLogout(): Promise<void> {
    setLoading(true);
    try {
      await apiFetch('/api/v1/auth/logout', { method: 'POST' });
    } finally {
      router.push('/login');
      router.refresh();
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={() => void handleLogout()} disabled={loading}>
      {loading ? 'Saindo...' : 'Sair'}
    </Button>
  );
}
