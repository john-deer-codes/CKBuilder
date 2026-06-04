// Lesson 18 - CKB RPC Dashboard
//
// A JSON-RPC monitoring dashboard, modeled the Week 3 way: state the wire format
// first, then show the structures that ride on top of it. The default run tries
// the public testnet RPC (read-only, safe) and degrades to embedded sample data
// when the network is unavailable, so it runs clean with no funded state and no
// connectivity. Set CKB_RUN_RPC_LIVE=0 to force pure dry-run.

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: unknown[];
};

type JsonRpcResponse<T> = {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: { code: number; message: string };
};

type Header = {
  number: string;
  timestamp: string;
  epoch: string;
  hash: string;
};

type DecodedEpoch = {
  number: bigint;
  index: bigint;
  length: bigint;
};

const TESTNET_RPC = "https://testnet.ckb.dev/";
const LIVE = process.env.CKB_RUN_RPC_LIVE !== "0";

function printSection(title: string) {
  console.log(`\n${title}`);
  console.log(`${"=".repeat(title.length)}`);
}

// CKB ships every integer that can exceed 2^53 as a 0x-prefixed hex string, so a
// JSON number never has to hold a 64-bit value. BigInt() parses the hex directly.
function hexToBigInt(hex: string): bigint {
  if (!hex.startsWith("0x")) {
    throw new Error(`Expected 0x-prefixed hex, got: ${hex}`);
  }
  return BigInt(hex);
}

function buildRequest(method: string, params: unknown[], id = 1): JsonRpcRequest {
  return { jsonrpc: "2.0", id, method, params };
}

// One transport for every chain/pool/indexer/net/stats method. The SDK is a thin
// convenience layer over exactly this call.
async function callRpc<T>(method: string, params: unknown[] = [], timeoutMs = 4000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(TESTNET_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildRequest(method, params)),
      signal: controller.signal,
    });
    const json = (await res.json()) as JsonRpcResponse<T>;
    if (json.error) {
      throw new Error(`RPC ${method} failed: ${json.error.code} ${json.error.message}`);
    }
    if (json.result === undefined) {
      throw new Error(`RPC ${method} returned no result`);
    }
    return json.result;
  } finally {
    clearTimeout(timer);
  }
}

// Sample tip header used when the network is unreachable so the walkthrough still
// reads end to end. Values are shaped exactly like a real testnet response.
const SAMPLE_HEADER: Header = {
  number: "0xb1a3c0",
  timestamp: "0x18e0a1f4c10",
  epoch: "0x6f8011c000c2b",
  hash: "0x9b1c8a0f7c6d4e3b2a1908f7e6d5c4b3a29180f7e6d5c4b3a29180f7e6d5c4b3",
};

function printWireFormat() {
  printSection("1. JSON-RPC 2.0 is the whole wire protocol");

  console.log("Request envelope");
  console.log(`  ${JSON.stringify(buildRequest("get_tip_header", []))}`);
  console.log("");
  console.log("Success response");
  console.log('  { "jsonrpc": "2.0", "id": 1, "result": { ... } }');
  console.log("Error response");
  console.log('  { "jsonrpc": "2.0", "id": 1, "error": { "code": -32602, "message": "Invalid params" } }');
  console.log("");

  console.log("Hex integers and BigInt");
  console.log("  every value that can exceed 2^53 arrives as a 0x-prefixed hex string");
  for (const hex of ["0x0", "0x64", "0xb1a3c0", "0x18e0a1f4c10"]) {
    console.log(`  ${hex.padEnd(16)} -> ${hexToBigInt(hex)}`);
  }
  console.log("  a JSON number could not hold 0x18e0a1f4c10 without losing precision");
}

function printSdkVsRaw() {
  printSection("2. CCC client vs raw RPC method access");

  console.log("CCC convenience layer");
  console.log("  import { ccc } from \"@ckb-ccc/core\";");
  console.log("  const client = new ccc.ClientPublicTestnet();");
  console.log("  await tx.completeInputsByCapacity(signer);");
  console.log("  // internally fans out to get_cells, get_cells_capacity, get_tip_header");
  console.log("");
  console.log("Raw RPC access");
  console.log("  fetch(rpcUrl, { method: POST, body: { jsonrpc, id, method, params } })");
  console.log("  // every method is reachable, nothing is hidden, you decode the hex yourself");
  console.log("");
  console.log("Rule of thumb");
  console.log("  - reach for the SDK to build and send transactions");
  console.log("  - drop to raw RPC for monitoring, indexing, and node introspection");
}

function printMethodFamilies() {
  printSection("3. RPC method families");

  const families: Array<[string, string, string]> = [
    ["chain", "committed blocks, headers, transactions", "get_tip_header, get_block_by_number, get_transaction"],
    ["pool", "mempool operations", "send_transaction, get_raw_tx_pool"],
    ["indexer", "cell queries by script", "get_cells, get_cells_capacity, get_transactions"],
    ["net", "p2p info (local node only)", "local_node_info, get_peers, sync_state"],
    ["stats", "chain metrics", "get_blockchain_info, get_deployments_info"],
  ];

  for (const [family, purpose, examples] of families) {
    console.log(`  ${family.padEnd(9)} ${purpose}`);
    console.log(`  ${" ".repeat(9)} ${examples}`);
  }
  console.log("");
  console.log("net/* needs your own node; chain, pool, indexer, and stats answer from a public RPC");
}

// Epoch is one packed uint64 (CKB's EpochNumberWithFraction): the low 24 bits are
// the epoch number, the next 16 bits the block index within the epoch, the next 16
// the epoch length. (The lesson text lists the fields in the reverse order; decode
// a live testnet header and only this layout keeps index < length.)
function decodeEpoch(epoch: string): DecodedEpoch {
  const value = hexToBigInt(epoch);
  return {
    number: value & 0xffffffn,
    index: (value >> 24n) & 0xffffn,
    length: (value >> 40n) & 0xffffn,
  };
}

async function fetchTipHeader(): Promise<{ header: Header; live: boolean }> {
  if (!LIVE) {
    return { header: SAMPLE_HEADER, live: false };
  }
  try {
    const header = await callRpc<Header>("get_tip_header");
    return { header, live: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.log(`  (network unavailable, falling back to sample header: ${reason})`);
    return { header: SAMPLE_HEADER, live: false };
  }
}

async function printTipHeader() {
  printSection("4. get_tip_header and the packed epoch field");

  const { header, live } = await fetchTipHeader();
  const epoch = decodeEpoch(header.epoch);
  const tsMs = hexToBigInt(header.timestamp);

  console.log(`  source:    ${live ? "live testnet RPC" : "embedded sample"}`);
  console.log(`  number:    ${hexToBigInt(header.number)} (${header.number})`);
  console.log(`  timestamp: ${tsMs} ms`);
  console.log(`  epoch raw: ${header.epoch}`);
  console.log(`  epoch:     number=${epoch.number} index=${epoch.index} length=${epoch.length}`);
  console.log(`             -> block ${epoch.index}/${epoch.length} of epoch ${epoch.number}`);
}

function printBlockAndTx() {
  printSection("5. get_block_by_number, get_transaction, get_live_cell");

  console.log("get_block_by_number(number, verbosity)");
  console.log("  0x0  serialized binary (compact relay format)");
  console.log("  0x1  JSON with transaction hashes only");
  console.log("  0x2  full JSON with every transaction");
  console.log("  transactions[0] is ALWAYS the cellbase (block reward), user txs follow");
  console.log("");

  console.log("get_transaction(tx_hash) -> tx_status.status walks a 2-phase commit");
  const states = ["pending", "proposed", "committed"];
  console.log(`  ${states.join("  ->  ")}   (or rejected / unknown)`);
  console.log("  pending   in mempool, not yet proposed");
  console.log("  proposed  short id placed in a block proposal zone");
  console.log("  committed full data landed in a block");
  console.log("");

  console.log("get_live_cell(out_point, with_data) -> status: live | dead | unknown");
  console.log("  always re-check live status right before spending; it can flip between checks");
}

async function printBalanceFromLock() {
  printSection("6. get_cells_capacity computes a balance from a lock script");

  const searchKey = {
    script: {
      code_hash: "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8",
      hash_type: "type",
      args: "0x36c329ed630d6ce750712a477543672adab57f4c",
    },
    script_type: "lock",
  };

  console.log("searchKey (lock script identity, not an address):");
  console.log(`  code_hash: ${searchKey.script.code_hash}`);
  console.log(`  hash_type: ${searchKey.script.hash_type}`);
  console.log(`  args:      ${searchKey.script.args}`);
  console.log("");

  let capacityShannons: bigint;
  let live = false;
  if (LIVE) {
    try {
      const res = await callRpc<{ capacity: string }>("get_cells_capacity", [searchKey]);
      capacityShannons = hexToBigInt(res.capacity);
      live = true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.log(`  (network unavailable, using sample capacity: ${reason})`);
      capacityShannons = 123_456_789_000n;
    }
  } else {
    capacityShannons = 123_456_789_000n;
  }

  const ckb = Number(capacityShannons) / 1e8;
  console.log(`  source:   ${live ? "live testnet RPC" : "embedded sample"}`);
  console.log(`  capacity: ${capacityShannons} shannons`);
  console.log(`  balance:  ${ckb} CKB`);
  console.log("  the lock script IS the account; capacity is summed across every live cell it owns");
}

function printMonitoringSketch() {
  printSection("7. Monitoring: polling, subscriptions, pagination, retry");

  console.log("New-tip polling loop (pull model, works against any RPC)");
  console.log("  let last = await tipNumber();");
  console.log("  setInterval(async () => {");
  console.log("    const now = await tipNumber();");
  console.log("    if (now > last) { onNewBlock(now); last = now; }");
  console.log("  }, 5000);");
  console.log("");

  console.log("WebSocket subscription topics (push model, ws://node:28114)");
  for (const topic of ["new_tip_header", "new_tip_block", "new_transaction", "proposed_transaction", "rejected_transaction"]) {
    console.log(`  - ${topic}`);
  }
  console.log("");

  console.log("Cursor pagination for get_cells / get_transactions");
  console.log('  params = cursor ? [searchKey, "asc", "0x40", cursor] : [searchKey, "asc", "0x40"];');
  console.log('  stop when page.last_cursor === "0x"; otherwise carry it into the next call');
  console.log("");

  console.log("Error codes worth handling explicitly");
  const codes: Array<[number, string]> = [
    [-1, "invalid transaction (script execution failed)"],
    [-2, "non-existent cell"],
    [-3, "conflicting transaction (double-spend)"],
    [-101, "transaction pool full"],
  ];
  for (const [code, meaning] of codes) {
    console.log(`  ${String(code).padStart(4)}  ${meaning}`);
  }
  console.log("");

  console.log("Exponential backoff on transient failures");
  for (let attempt = 0; attempt <= 3; attempt += 1) {
    console.log(`  attempt ${attempt}: wait ${1000 * 2 ** attempt} ms before retry`);
  }
}

function printTakeaways() {
  printSection("8. Week 4 invariant (RPC)");
  console.log("  - the RPC is one JSON-RPC 2.0 endpoint; the SDK is convenience over the same calls");
  console.log("  - decode every 0x value with BigInt, including the packed epoch field");
  console.log("  - a balance is a sum over a lock script's live cells, not a stored number");
  console.log("  - talking to an RPC means trusting whoever runs that node to answer honestly");
}

async function main() {
  printWireFormat();
  printSdkVsRaw();
  printMethodFamilies();
  await printTipHeader();
  printBlockAndTx();
  await printBalanceFromLock();
  printMonitoringSketch();
  printTakeaways();
}

try {
  await main();
  process.exit(0);
} catch (error) {
  console.error("14-rpc-dashboard failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
