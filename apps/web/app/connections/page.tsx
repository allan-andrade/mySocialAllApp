import { redirect } from 'next/navigation';

import { getCurrentUser } from '../../lib/auth';

import { ConnectionsClient } from './connections-client';

export default async function ConnectionsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return <ConnectionsClient />;
}
