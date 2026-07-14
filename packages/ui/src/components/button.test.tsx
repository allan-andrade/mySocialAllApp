import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Button } from './button';

describe('Button', () => {
  it('renders children and forwards the click handler', () => {
    render(<Button>Publicar</Button>);
    expect(screen.getByRole('button', { name: 'Publicar' })).toBeInTheDocument();
  });

  it('applies the disabled attribute', () => {
    render(<Button disabled>Publicar</Button>);
    expect(screen.getByRole('button', { name: 'Publicar' })).toBeDisabled();
  });
});
