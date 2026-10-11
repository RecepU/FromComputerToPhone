// @vitest-environment jsdom
import { it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { LinkedText } from '../../apps/web/src/components/TransferCard';
afterEach(cleanup);
it('renders untrusted HTML as text and only safe links', () => {
  render(
    <LinkedText
      text={'<img onerror=alert(1)> javascript:alert(1) https://example.com'}
    />,
  );
  expect(screen.getByRole('link')).toHaveAttribute(
    'href',
    'https://example.com/',
  );
  expect(document.querySelector('img')).toBeNull();
  expect(screen.getByText(/javascript:/)).toBeInTheDocument();
});
