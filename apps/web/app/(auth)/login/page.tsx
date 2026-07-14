import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getCurrentUser } from '../../../lib/auth';

import { LoginForm } from './login-form';

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect('/dashboard');

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6 py-16">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Entrar</h1>
        <p className="text-sm text-muted-foreground">Acesse sua conta social-publisher.</p>
      </div>
      <LoginForm />
      <p className="text-center text-sm text-muted-foreground">
        Não tem conta?{' '}
        <Link href="/register" className="font-medium text-primary underline-offset-4 hover:underline">
          Cadastre-se
        </Link>
      </p>
    </div>
  );
}
