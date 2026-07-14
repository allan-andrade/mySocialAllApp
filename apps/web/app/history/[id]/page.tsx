import { redirect } from 'next/navigation';

import { getCurrentUser } from '../../../lib/auth';

import { PublicationDetailClient } from './publication-detail-client';

export default async function PublicationDetailPage({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return <PublicationDetailClient publicationId={params.id} />;
}
