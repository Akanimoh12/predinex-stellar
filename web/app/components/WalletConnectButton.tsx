'use client';

import { useWalletConnect } from '@/app/lib/hooks/useWalletConnect';
import { emitWalletEvent } from '@/app/lib/wallet-telemetry';
import { Loader2, Wallet } from 'lucide-react';
import { WalletService } from '@/app/lib/wallet-service';
import { useAppKit } from '@/lib/hooks/useAppKit';
import { useEffect, useRef, useState } from 'react';

export function WalletConnectButton() {
  const { session } = useWalletConnect();
  const { open, status } = useAppKit();

  // Track when we initiated the connect attempt so we can measure duration
  const connectStartRef = useRef<number | null>(null);

  // Local state to control the visible loading indicator independently of
  // AppKit's async status updates.
  const [isConnecting, setIsConnecting] = useState(false);

  // Derive connecting state from AppKit's account status
  const appKitConnecting = status === 'connecting';

  // Show spinner whenever we're waiting for the user or the wallet response
  const showSpinner = isConnecting || appKitConnecting;

  useEffect(() => {
    if (status === 'connecting') {
      // AppKit has picked up the connection attempt
      if (connectStartRef.current === null) {
        connectStartRef.current = Date.now();
        emitWalletEvent({
          event: 'wallet.connect.attempt',
          timestamp: new Date().toISOString(),
        });
      }
    }

    if (status === 'connected') {
      const durationMs =
        connectStartRef.current !== null
          ? Date.now() - connectStartRef.current
          : undefined;
      connectStartRef.current = null;
      
      const timer = setTimeout(() => {
        setIsConnecting(false);
        emitWalletEvent({
          event: 'wallet.connect.success',
          timestamp: new Date().toISOString(),
          durationMs,
        });
      }, 0);
      return () => clearTimeout(timer);
    }

    if (status === 'disconnected' && isConnecting) {
      // User dismissed the modal or the connection was rejected
      const durationMs =
        connectStartRef.current !== null
          ? Date.now() - connectStartRef.current
          : undefined;
      connectStartRef.current = null;
      
      const timer = setTimeout(() => {
        setIsConnecting(false);
        emitWalletEvent({
          event: 'wallet.connect.cancel',
          timestamp: new Date().toISOString(),
          durationMs,
        });
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [status, isConnecting]);

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      await open();
    } catch (err) {
      const durationMs =
        connectStartRef.current !== null
          ? Date.now() - connectStartRef.current
          : undefined;
      connectStartRef.current = null;
      setIsConnecting(false);
      emitWalletEvent({
        event: 'wallet.connect.failure',
        timestamp: new Date().toISOString(),
        durationMs,
        errorMessage: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  };

  if (session?.isConnected) {
    return (
      <div className="flex items-center gap-3">
        <div className="text-sm">
          <p className="text-muted-foreground">Connected</p>
          <p className="font-mono text-xs">
            {WalletService.formatAddress(session.address)}
          </p>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={handleConnect}
      disabled={showSpinner}
      aria-busy={showSpinner}
      aria-label={showSpinner ? 'Connecting wallet…' : 'Connect wallet'}
      className="flex items-center gap-2 bg-primary/10 hover:bg-primary/20 text-primary px-4 py-2 rounded-lg border border-primary/20 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
    >
      {showSpinner ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin" />
          Connecting…
        </>
      ) : (
        <>
          <Wallet className="w-4 h-4" />
          Connect Wallet
        </>
      )}
    </button>
  );
}
