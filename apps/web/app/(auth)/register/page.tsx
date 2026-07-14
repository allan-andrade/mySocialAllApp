import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getCurrentUser } from '../../../lib/auth';

import { RegisterForm } from './register-form';

export default async function RegisterPage() {
  const user = await getCurrentUser();
  if (user) redirect('/dashboard');

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6 py-16">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Criar conta</h1>
        <p className="text-sm text-muted-foreground">Comece a publicar em várias redes de uma vez.</p>
      </div>
      <RegisterForm />
      <p className="text-center text-sm text-muted-foreground">
        Já tem conta?{' '}
        <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
          Entrar
        </Link>
      </p>
    </div>
  );
}
