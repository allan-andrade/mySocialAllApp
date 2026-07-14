'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Input, Label } from '@social-publisher/ui';
import { loginSchema, type LoginInput } from '@social-publisher/validation';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { ApiError, apiFetch } from '../../../lib/api-client';

export function LoginForm() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  async function onSubmit(values: LoginInput): Promise<void> {
    setServerError(null);
    try {
      await apiFetch('/api/v1/auth/login', { method: 'POST', body: JSON.stringify(values) });
      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : 'Não foi possível entrar. Tente novamente.');
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">E-mail</Label>
        <Input id="email" type="email" autoComplete="email" {...register('email')} />
        {errors.email && (
          <p className="text-sm text-destructive" role="alert">
            {errors.email.message}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Senha</Label>
        <Input id="password" type="password" autoComplete="current-password" {...register('password')} />
        {errors.password && (
          <p className="text-sm text-destructive" role="alert">
            {errors.password.message}
          </p>
        )}
      </div>
      {serverError && (
        <p className="text-sm text-destructive" role="alert">
          {serverError}
        </p>
      )}
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Entrando...' : 'Entrar'}
      </Button>
    </form>
  );
}
