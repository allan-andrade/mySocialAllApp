import { redirect } from 'next/navigation';

import { getCurrentUser } from '../../lib/auth';

import { Composer } from './composer';

export default async function ComposePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return <Composer />;
}
