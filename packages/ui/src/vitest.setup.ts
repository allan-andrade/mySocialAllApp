import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

import '@testing-library/jest-dom/vitest';

// RTL's auto-cleanup only registers itself when `afterEach` is a Jest/Vitest
// global; this project runs with `globals: false`, so it's wired explicitly.
afterEach(() => {
  cleanup();
});
