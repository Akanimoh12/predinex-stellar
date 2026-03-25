'use client';
import Navbar from "../../components/Navbar";
import AuthGuard from "../../components/AuthGuard";
import PortfolioOverview from "../../components/PortfolioOverview";
import PlatformStats from "../../components/PlatformStats";
import ActivityFeed from "../components/ActivityFeed";
import ActiveBetsCard from "../components/dashboard/ActiveBetsCard";
import { useUserActivity } from "../hooks/useUserActivity";
import { useActiveBets } from "../lib/hooks/useActiveBets";
import { useStacks } from "../components/StacksProvider";

export default function Dashboard() {
    const { userData } = useStacks();
    const stxAddress = userData?.profile?.stxAddress?.mainnet || userData?.profile?.stxAddress?.testnet || userData?.identityAddress;

    const { activities, isLoading: activityLoading, error: activityError, refresh: refreshActivity } = useUserActivity(stxAddress, 5);
    const { activeBets, isLoading: betsLoading, refresh: refreshBets } = useActiveBets(stxAddress);

    return (
        <main className="min-h-screen bg-background">
            <Navbar />
            <AuthGuard>
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <h1 className="text-4xl font-black mb-8 bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                        Institutional Dashboard
                    </h1>

                    <PlatformStats />
                    <PortfolioOverview />

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        <div className="p-8 rounded-3xl border border-border bg-card/40 glass shadow-xl">
                            <h2 className="text-2xl font-black mb-6 flex items-center gap-3">
                                <div className="w-2 h-6 bg-primary rounded-full" />
                                Active Bets
                            </h2>
                            <ActiveBetsCard
                                bets={activeBets}
                                claimTransactions={new Map()}
                                onClaim={() => { refreshBets(); }}
                                isLoading={betsLoading}
                            />
                        </div>
                        <div className="p-8 rounded-3xl border border-border bg-card/40 glass shadow-xl">
                            <ActivityFeed
                                activities={activities}
                                isLoading={activityLoading}
                                error={activityError}
                                onRefresh={refreshActivity}
                                limit={5}
                            />
                        </div>
                    </div>
                </div>
            </AuthGuard>
        </main>
    );
}
