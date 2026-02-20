import { useState, useMemo } from "react";
import "./App.css";
import { ConnectWalletButton } from "./components/ConnectWalletButton";
import { InstanceManager } from "./components/InstanceManager";
import { AdminFunctions } from "./components/AdminFunctions";
import { OperatorFunctions } from "./components/OperatorFunctions";
import { UserFunctions } from "./components/UserFunctions";
import { StatusChecker } from "./components/StatusChecker";
import { MintManager } from "./components/MintManager";
import { ContraManagement } from "./components/ContraManagement";
import { ActivityFeed } from "./components/ActivityFeed";
import { ActivityStats } from "./components/ActivityStats";
import { PayoutManager } from "./components/PayoutManager";
import { useWallet } from "./hooks/useWallet";
import { useCluster } from "./hooks/useCluster";
import { useLocalStorage } from "./hooks/useLocalStorage";
import { useActivityFeed } from "./hooks/useActivityFeed";
import type { NetworkType } from "./context/ClusterContext";
import { createSolanaRpc } from "@solana/rpc";
import { createSolanaRpcSubscriptions } from "@solana/rpc-subscriptions";
import { SolanaContext } from "./context/SolanaContext";

type TabType = "escrow" | "mint" | "contra" | "activity" | "payout";
type EscrowSection = "admin" | "operator" | "user" | "status";

function AppContent() {
  const { connected, publicKey } = useWallet();
  const { network, setNetwork } = useCluster();
  const [instancePubkey, setInstancePubkey] = useState<string>("");
  const [activeTab, setActiveTab] = useLocalStorage<TabType>("activeTab", "escrow");
  const [escrowSection, setEscrowSection] = useLocalStorage<EscrowSection>("escrowSection", "admin");

  const { transactions, stats, isPolling, start, stop, mintDecimals } = useActivityFeed(
    instancePubkey || null
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>Contra</h1>
        <div className="header-actions">
          <select
            value={network}
            onChange={(e) => setNetwork(e.target.value as NetworkType)}
            className="network-select"
          >
            <option value="devnet">Devnet</option>
            <option value="testnet">Testnet</option>
            <option value="mainnet-beta">Mainnet</option>
            <option value="localnet">Localnet</option>
          </select>
          <ConnectWalletButton />
        </div>
      </header>

      <main className="app-main">
        {!connected ? (
          <div className="connect-prompt">
            <h2>Connect your wallet</h2>
            <p>Manage your Contra escrow instance</p>
          </div>
        ) : (
          <div className="dashboard">
            <div className="wallet-info">
              <h3>Wallet</h3>
              <p className="wallet-address">{publicKey?.toBase58()}</p>
            </div>

            <div className="tabs">
              <button
                className={`tab ${activeTab === "escrow" ? "active" : ""}`}
                onClick={() => setActiveTab("escrow")}
              >
                Escrow
              </button>
              <button
                className={`tab ${activeTab === "activity" ? "active" : ""}`}
                onClick={() => setActiveTab("activity")}
              >
                Activity
                {isPolling && <span className="tab-polling-dot" />}
              </button>
              <button
                className={`tab ${activeTab === "payout" ? "active" : ""}`}
                onClick={() => setActiveTab("payout")}
              >
                Payout
              </button>
              <button
                className={`tab ${activeTab === "mint" ? "active" : ""}`}
                onClick={() => setActiveTab("mint")}
              >
                Mint
              </button>
              <button
                className={`tab ${activeTab === "contra" ? "active" : ""}`}
                onClick={() => setActiveTab("contra")}
              >
                Contra
              </button>
            </div>

            <div className="tab-content">
              {/* Escrow tab */}
              <div
                style={{ display: activeTab === "escrow" ? "block" : "none" }}
              >
                <InstanceManager onInstanceSelect={setInstancePubkey} />

                {instancePubkey && (
                  <>
                    <div className="escrow-sections">
                      <button
                        className={`escrow-section-tab ${escrowSection === "admin" ? "active" : ""}`}
                        onClick={() => setEscrowSection("admin")}
                      >
                        <span className="section-icon">&#9881;</span>
                        Admin
                      </button>
                      <button
                        className={`escrow-section-tab ${escrowSection === "operator" ? "active" : ""}`}
                        onClick={() => setEscrowSection("operator")}
                      >
                        <span className="section-icon">&#9654;</span>
                        Operator
                      </button>
                      <button
                        className={`escrow-section-tab ${escrowSection === "user" ? "active" : ""}`}
                        onClick={() => setEscrowSection("user")}
                      >
                        <span className="section-icon">&#8644;</span>
                        User
                      </button>
                      <button
                        className={`escrow-section-tab ${escrowSection === "status" ? "active" : ""}`}
                        onClick={() => setEscrowSection("status")}
                      >
                        <span className="section-icon">&#8505;</span>
                        Status
                      </button>
                    </div>

                    <div className="escrow-section-content">
                      {escrowSection === "admin" && (
                        <AdminFunctions instancePubkey={instancePubkey} />
                      )}
                      {escrowSection === "status" && (
                        <StatusChecker instancePubkey={instancePubkey} />
                      )}
                      {escrowSection === "operator" && (
                        <OperatorFunctions instancePubkey={instancePubkey} />
                      )}
                      {escrowSection === "user" && (
                        <UserFunctions instancePubkey={instancePubkey} />
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* Activity tab */}
              <div
                style={{ display: activeTab === "activity" ? "block" : "none" }}
              >
                <ActivityStats
                  stats={stats}
                  isPolling={isPolling}
                  onStart={start}
                  onStop={stop}
                  instancePubkey={instancePubkey || null}
                />
                <ActivityFeed transactions={transactions} mintDecimals={mintDecimals} />
              </div>

              {/* Payout tab */}
              <div
                style={{ display: activeTab === "payout" ? "block" : "none" }}
              >
                <PayoutManager />
              </div>

              {/* Mint tab */}
              <div style={{ display: activeTab === "mint" ? "block" : "none" }}>
                <MintManager />
              </div>

              {/* Contra tab */}
              <div
                style={{ display: activeTab === "contra" ? "block" : "none" }}
              >
                <ContraManagement />
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function App() {
  const { endpoint, wsEndpoint } = useCluster();

  const rpc = useMemo(() => createSolanaRpc(endpoint), [endpoint]);
  const rpcSubscriptions = useMemo(() => {
    const wsUrl =
      wsEndpoint ||
      endpoint.replace("https://", "wss://").replace("http://", "ws://");
    return createSolanaRpcSubscriptions(wsUrl);
  }, [endpoint, wsEndpoint]);

  return (
    <SolanaContext.Provider value={{ rpc, rpcSubscriptions }}>
      <AppContent />
    </SolanaContext.Provider>
  );
}

export default App;
