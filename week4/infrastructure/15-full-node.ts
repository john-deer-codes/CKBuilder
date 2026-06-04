// Lesson 19 - Running a Full Node
//
// Lesson 19 is operational, so this exercise models the ops the way Week 3 modeled
// cell management: in TypeScript, as data and decisions you can read top to bottom.
// It compares node types, generates a hardened ckb.toml, and interprets sync state.
// Pure dry-run by default. Set CKB_RUN_NODE_LIVE=1 to query a local node on
// http://127.0.0.1:8114 for real sync_state / local_node_info instead of samples.

type NodeKind = "full" | "light" | "archive";

type NodeProfile = {
  kind: NodeKind;
  storage: string;
  verifies: string;
  runsScripts: boolean;
  syncTime: string;
  useCase: string;
};

type SyncState = {
  headers: bigint;
  blocks: bigint;
  bestKnownHeader: bigint;
  bestKnownBlock: bigint;
  peers: number;
};

const LIVE = process.env.CKB_RUN_NODE_LIVE === "1";
const LOCAL_RPC = "http://127.0.0.1:8114";

function printSection(title: string) {
  console.log(`\n${title}`);
  console.log(`${"=".repeat(title.length)}`);
}

const PROFILES: NodeProfile[] = [
  {
    kind: "full",
    storage: "~500 GB",
    verifies: "every block and every script",
    runsScripts: true,
    syncTime: "12-48 hours",
    useCase: "production apps, sending and validating txs",
  },
  {
    kind: "light",
    storage: "~100 MB",
    verifies: "headers + Merkle proofs only",
    runsScripts: false,
    syncTime: "minutes",
    useCase: "mobile, browser, IoT wallets",
  },
  {
    kind: "archive",
    storage: "1+ TB",
    verifies: "every block and every script, full history retained",
    runsScripts: true,
    syncTime: "days",
    useCase: "block explorers, analytics, indexers",
  },
];

function printNodeComparison() {
  printSection("1. Node-type tradeoff table");

  for (const p of PROFILES) {
    console.log(p.kind.toUpperCase());
    console.log(`  storage:      ${p.storage}`);
    console.log(`  verifies:     ${p.verifies}`);
    console.log(`  runs scripts: ${p.runsScripts ? "yes" : "no"}`);
    console.log(`  sync time:    ${p.syncTime}`);
    console.log(`  use case:     ${p.useCase}`);
    console.log("");
  }

  console.log("The axis is trust vs storage:");
  console.log("  - a full node trusts nothing and pays ~500 GB for it");
  console.log("  - a light client trusts proof-of-work math and pays ~100 MB");
  console.log("  - an archive node keeps everything so others can ask about the past");
}

// A ckb.toml generator. Keeping it as a typed object means the security notes live
// right next to the values they justify.
function renderCkbToml(): string {
  const sections: string[] = [];

  sections.push(
    [
      "[rpc]",
      '# bind to localhost only; never expose 8114 to the internet without a firewall',
      'listen_address = "127.0.0.1:8114"',
      'tcp_listen_address = "127.0.0.1:18114"',
      'ws_listen_address = "127.0.0.1:28114"',
      "max_request_body_size = 10_000_000",
      '# drop "Debug" in production: it exposes methods that reveal internal node state',
      'modules = ["Net", "Pool", "Miner", "Chain", "Stats", "Subscription", "Indexer"]',
    ].join("\n"),
  );

  sections.push(
    [
      "[network]",
      "# p2p port is SEPARATE from the rpc port and SHOULD be reachable from the internet",
      'listen_addresses = ["/ip4/0.0.0.0/tcp/8115"]',
      "max_peers = 8",
      "max_outbound_peers = 8",
      "# bootnodes are written by `ckb init`; the p2p protocol only accepts signed messages",
    ].join("\n"),
  );

  sections.push(
    [
      "[store]",
      'path = "data"',
      "block_cache_size = 268",
      "cell_cache_size = 128",
      "header_cache_size = 4096",
    ].join("\n"),
  );

  sections.push(
    [
      "[tx_pool]",
      "min_fee_rate = 1000        # shannons per 1000 bytes",
      "max_tx_pool_size = 180_000_000",
      "max_ancestors_count = 25",
    ].join("\n"),
  );

  sections.push(
    [
      "[logger]",
      'filter = "info"            # error | warn | info | debug | trace',
      "log_to_file = true",
      "log_to_stdout = true",
    ].join("\n"),
  );

  return sections.join("\n\n");
}

function printConfigGenerator() {
  printSection("2. ckb.toml config generator");

  console.log(renderCkbToml());
  console.log("");
  console.log("Operational security notes (apply before going to mainnet):");
  console.log('  - omit "Debug" from [rpc] modules so internal state stays private');
  console.log("  - verify the SHA256 checksum of the ckb binary against the GitHub release");
  console.log('  - run under a dedicated non-root user (useradd -r -s /bin/false ckb)');
  console.log("  - keep [rpc] on 127.0.0.1; expose only the p2p port 8115");
}

const SAMPLE_SYNCING: SyncState = {
  headers: 11_640_320n,
  blocks: 11_502_911n,
  bestKnownHeader: 11_640_768n,
  bestKnownBlock: 11_640_768n,
  peers: 9,
};

const SAMPLE_SYNCED: SyncState = {
  headers: 11_640_768n,
  blocks: 11_640_768n,
  bestKnownHeader: 11_640_768n,
  bestKnownBlock: 11_640_768n,
  peers: 8,
};

function classifyPeers(peers: number): string {
  if (peers < 3) return "too few - likely a firewall blocking p2p port 8115";
  if (peers <= 12) return "healthy (6-12 is the comfortable band)";
  return "unusually high, but not harmful";
}

function interpretSyncState(label: string, state: SyncState) {
  const synced = state.blocks === state.bestKnownBlock;
  const blocksBehind = state.bestKnownBlock - state.blocks;
  const pct = state.bestKnownBlock === 0n
    ? 0
    : Number((state.blocks * 10000n) / state.bestKnownBlock) / 100;

  console.log(label);
  console.log(`  headers:            ${state.headers}`);
  console.log(`  blocks:             ${state.blocks}`);
  console.log(`  best_known_header:  ${state.bestKnownHeader}`);
  console.log(`  best_known_block:   ${state.bestKnownBlock}`);
  console.log(`  block progress:     ${pct}% (${blocksBehind} behind)`);
  console.log(`  peers:              ${state.peers} -> ${classifyPeers(state.peers)}`);
  console.log(`  verdict:            ${synced ? "SYNCED (blocks == best_known_block)" : "still syncing"}`);
  console.log("");
}

async function fetchLiveSyncState(): Promise<SyncState | null> {
  type RpcSyncState = { best_known_block_number: string; best_known_header_number?: string };
  type RpcLocalNode = { connections: string };
  try {
    const call = async <T>(method: string): Promise<T> => {
      const res = await fetch(LOCAL_RPC, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }),
        signal: AbortSignal.timeout(3000),
      });
      const json = (await res.json()) as { result?: T; error?: { message: string } };
      if (json.error) throw new Error(json.error.message);
      if (json.result === undefined) throw new Error(`${method} returned no result`);
      return json.result;
    };

    const sync = await call<RpcSyncState>("sync_state");
    const tipNumber = await call<string>("get_tip_block_number");
    const node = await call<RpcLocalNode>("local_node_info");

    return {
      headers: BigInt(sync.best_known_header_number ?? tipNumber),
      blocks: BigInt(tipNumber),
      bestKnownHeader: BigInt(sync.best_known_header_number ?? sync.best_known_block_number),
      bestKnownBlock: BigInt(sync.best_known_block_number),
      peers: Number(BigInt(node.connections)),
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.log(`  (no local node on ${LOCAL_RPC}: ${reason})`);
    return null;
  }
}

async function printSyncMonitor() {
  printSection("3. Sync-progress monitor");

  console.log("Reading sync_state + local_node_info:");
  console.log("  - headers download first, then blocks are fully validated behind them");
  console.log("  - you are synced when blocks == best_known_block_number");
  console.log("  - a healthy node holds 6-12 peers; under 3 usually means port 8115 is blocked");
  console.log("");

  if (LIVE) {
    const live = await fetchLiveSyncState();
    if (live) {
      interpretSyncState("Live local node", live);
      return;
    }
    console.log("  falling back to sample data\n");
  }

  interpretSyncState("Sample A - mid-sync", SAMPLE_SYNCING);
  interpretSyncState("Sample B - fully synced", SAMPLE_SYNCED);
}

function printTakeaways() {
  printSection("4. Week 4 invariant (full node)");
  console.log("  - a full node is the maximal-trust, maximal-storage end of the spectrum");
  console.log("  - config is a security surface: rpc stays local, p2p stays public, Debug stays off");
  console.log("  - sync health is two numbers (blocks vs best_known) and one count (peers)");
  console.log("  - running your own node means you verify the chain instead of trusting someone's RPC");
}

async function main() {
  printNodeComparison();
  printConfigGenerator();
  await printSyncMonitor();
  printTakeaways();
}

try {
  await main();
  process.exit(0);
} catch (error) {
  console.error("15-full-node failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
