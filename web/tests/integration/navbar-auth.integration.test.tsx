import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import * as StacksProvider from '@/components/StacksProvider';

vi.mock('@/components/StacksProvider', () => ({
  useStacks: vi.fn(),
  StacksProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="stacks-provider">{children}</div>,
}));

vi.mock('@/app/hooks/useWalletConnection', () => ({
  useWalletConnection: vi.fn(() => ({
    leather: false,
    xverse: false,
    walletconnect: true,
    hasAnyWallet: true,
  })),
  useWalletState: vi.fn(() => ({
    isConnected: false,
    address: null,
    connect: vi.fn(),
    disconnect: vi.fn(),
  })),
}));

vi.mock('@/lib/hooks/useAppKit', () => ({
  useAppKit: vi.fn(() => ({
    open: vi.fn(),
    isConnected: false,
    address: null,
    status: 'disconnected',
    chainId: undefined,
    switchNetwork: vi.fn(),
    close: vi.fn(),
  })),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: vi.fn(),
  useSearchParams: () => new URLSearchParams(),
}));

import AuthGuard from '@/components/AuthGuard';

describe('Navbar and Auth Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  it('shows authentication required when not connected', () => {
    vi.mocked(StacksProvider.useStacks).mockReturnValue({
      userData: null,
      authenticate: vi.fn(),
      signOut: vi.fn(),
    });

    render(
      <AuthGuard>
        <div>Protected Content</div>
      </AuthGuard>
    );

    expect(screen.getByText(/authentication required/i)).toBeInTheDocument();
  });

  it('shows protected content when connected via Stacks', () => {
    vi.mocked(StacksProvider.useStacks).mockReturnValue({
      userData: { profile: { stxAddress: { mainnet: 'ST123' } } },
      authenticate: vi.fn(),
      signOut: vi.fn(),
    });

    render(
      <AuthGuard>
        <div>Protected Content</div>
      </AuthGuard>
    );

    expect(screen.getByText('Protected Content')).toBeInTheDocument();
    expect(screen.queryByText(/authentication required/i)).not.toBeInTheDocument();
  });
});
