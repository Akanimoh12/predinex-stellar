import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BettingSection from '../../app/components/BettingSection';
import * as StacksProvider from '../../app/components/StacksProvider';
import * as StacksConnect from '@stacks/connect';
import { renderWithProviders } from '../helpers/renderWithProviders';

// Mock dependencies
vi.mock('../../app/components/StacksProvider', () => ({
  useStacks: vi.fn(),
}));

vi.mock('@stacks/connect', () => ({
  openContractCall: vi.fn(),
}));

const mockPool = {
  id: 0,
  title: 'Test Pool',
  description: 'Test Description',
  creator: 'ST123',
  outcomeA: 'Outcome A',
  outcomeB: 'Outcome B',
  totalA: 1000000,
  totalB: 2000000,
  settled: false,
  winningOutcome: undefined,
  expiry: 1000,
  status: 'active' as const,
};

describe('BettingSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders betting section with pool information', () => {
    vi.mocked(StacksProvider.useStacks).mockReturnValue({
      userData: { profile: { stxAddress: { mainnet: 'ST123' } } },
      authenticate: vi.fn(),
      signOut: vi.fn(),
    });

    renderWithProviders(<BettingSection pool={mockPool} poolId={0} />);

    expect(screen.getByText(/Bet on Outcome A/i)).toBeInTheDocument();
    expect(screen.getByText(/Bet on Outcome B/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Enter bet amount/i)).toBeInTheDocument();
  });

  it('prompts authentication when user is not logged in', () => {
    const authenticate = vi.fn();
    vi.mocked(StacksProvider.useStacks).mockReturnValue({
      userData: null,
      authenticate,
      signOut: vi.fn(),
    });

    renderWithProviders(<BettingSection pool={mockPool} poolId={0} />);

    expect(screen.getByText('Connect Wallet to Bet')).toBeInTheDocument();
    expect(screen.getByText('Connect Wallet')).toBeInTheDocument();
  });

  it('validates bet amount before placing bet', async () => {
    vi.mocked(StacksProvider.useStacks).mockReturnValue({
      userData: { profile: { stxAddress: { mainnet: 'ST123' } } },
      authenticate: vi.fn(),
      signOut: vi.fn(),
    });

    const user = userEvent.setup();
    renderWithProviders(<BettingSection pool={mockPool} poolId={0} />);

    // Try to bet with empty amount
    const betButton = screen.getByText(/Bet on Outcome A/i);
    await user.click(betButton);

    await waitFor(() => {
      expect(screen.getByText('Please enter a valid bet amount greater than 0.')).toBeInTheDocument();
    });
    expect(vi.mocked(StacksConnect.openContractCall)).not.toHaveBeenCalled();
  });

  it('validates minimum bet amount', async () => {
    vi.mocked(StacksProvider.useStacks).mockReturnValue({
      userData: { profile: { stxAddress: { mainnet: 'ST123' } } },
      authenticate: vi.fn(),
      signOut: vi.fn(),
    });

    const user = userEvent.setup();
    renderWithProviders(<BettingSection pool={mockPool} poolId={0} />);

    const input = screen.getByLabelText(/Enter bet amount/i);
    await user.type(input, '0.05'); // Less than 0.1 STX minimum

    const betButton = screen.getByText(/Bet on Outcome A/i);
    await user.click(betButton);

    await waitFor(() => {
      expect(screen.getByText('Minimum bet amount is 0.1 STX.')).toBeInTheDocument();
    });
    expect(vi.mocked(StacksConnect.openContractCall)).not.toHaveBeenCalled();
  });

  it('calls openContractCall with correct parameters when placing bet', async () => {
    vi.mocked(StacksProvider.useStacks).mockReturnValue({
      userData: { profile: { stxAddress: { mainnet: 'ST123' } } },
      authenticate: vi.fn(),
      signOut: vi.fn(),
    });

    vi.mocked(StacksConnect.openContractCall).mockResolvedValue({} as never);

    const user = userEvent.setup();
    renderWithProviders(<BettingSection pool={mockPool} poolId={0} />);

    const input = screen.getByLabelText(/Enter bet amount/i);
    await user.type(input, '1.5');

    const betButton = screen.getByText(/Bet on Outcome A/i);
    await user.click(betButton);

    await waitFor(() => {
      expect(StacksConnect.openContractCall).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: 'place-bet',
          functionArgs: expect.arrayContaining([
            expect.anything(), // poolId
            expect.anything(), // outcome (0)
            expect.anything(), // amount (1500000 microSTX)
          ]),
        })
      );
    });
  });

  it('disables buttons while betting is in progress', async () => {
    vi.mocked(StacksProvider.useStacks).mockReturnValue({
      userData: { profile: { stxAddress: { mainnet: 'ST123' } } },
      authenticate: vi.fn(),
      signOut: vi.fn(),
    });

    // Make openContractCall hang
    vi.mocked(StacksConnect.openContractCall).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    const user = userEvent.setup();
    renderWithProviders(<BettingSection pool={mockPool} poolId={0} />);

    const input = screen.getByLabelText(/Enter bet amount/i);
    await user.type(input, '1.0');

    const betButton = screen.getByText(/Bet on Outcome A/i);
    await user.click(betButton);

    // Check if loading state is shown (button should be disabled)
    await waitFor(() => {
      const buttons = screen.getAllByRole('button');
      const disabledButtons = buttons.filter((btn: HTMLElement) => btn.hasAttribute('disabled'));
      expect(disabledButtons.length).toBeGreaterThan(0);
    });
  });

  it('renders without provider errors when wrapped in ToastProvider', () => {
    vi.mocked(StacksProvider.useStacks).mockReturnValue({
      userData: null,
      authenticate: vi.fn(),
      signOut: vi.fn(),
    });

    // Should not throw a "useToast must be used within a ToastProvider" error
    expect(() => renderWithProviders(<BettingSection pool={mockPool} poolId={0} />)).not.toThrow();
  });
});
