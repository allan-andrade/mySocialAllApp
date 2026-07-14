import { redirect } from 'next/navigation';

export default function DashboardPage() {
  // O compositor é a tela principal do produto.
  redirect('/compose');
}
