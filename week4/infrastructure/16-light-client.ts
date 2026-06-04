// Lesson 20 - Light Client Application
//
// The light client is the trust-math, store-almost-nothing end of the spectrum.
// This exercise models the storage spectrum, the FlyClient sampling argument, and
// the set_scripts / get_scripts / get_cells flow - including the merge you MUST do
// because set_scripts replaces the whole watch list on every call. Dry-run by
// default; set CKB_RUN_LIGHT_LIVE=1 to query a local ckb-light-client on
// http://127.0.0.1:9000.

type Script = {
  code_hash: string;
  hash_type: "type" | "data" | "data1";
  args: string;
};

type ScriptStatus = {
  script: Script;
  script_type: "lock" | "type";
  block_number: string;
};

const LIVE = process.env.CKB_RUN_LIGHT_LIVE === "1";
const LIGHT_RPC = "http://127.0.0.1:9000";

function printSection(title: string) {
  console.log(`\n${title}`);
  console.log(`${"=".repeat(title.length)}`);
}

function printStorageSpectrum() {
  printSection("1. The storage spectrum");

  const rows: Array<[string, string, string, string]> = [
    ["archive full node", "300+ GB", "multiple days", "explorers, analytics"],
    ["pruned full node", "100+ GB", "hours to days", "miners, validators, infra"],
    ["light client", "<1 MB", "1-5 minutes", "mobile, browser, IoT, dApps"],
    ["stateless client", "~0 MB", "on-demand", "one-time verification, embedded"],
  ];

  for (const [model, storage, sync, use] of rows) {
    console.log(`  ${model.padEnd(20)} ${storage.padEnd(9)} ${sync.padEnd(16)} ${use}`);
  }
  console.log("");

  const fullGb = 300;
  const lightMb = 1;
  const ratio = (fullGb * 1024) / lightMb;
  console.log(`Punchline: ${fullGb} GB vs <${lightMb} MB is a ${ratio.toLocaleString("en-US")}x reduction.`);
  console.log("That >100,000x gap is the whole reason a light client can live in a browser tab.");
}

// FlyClient: instead of O(n) headers, sample O(log n) positions and check the PoW
// at each against MMR difficulty commitments embedded in the headers.
function flyClientHeaders(height: number): number {
  // ~c * log2(height); calibrated so 14M blocks lands near 37 sampled headers.
  return Math.round(1.55 * Math.log2(height));
}

function printFlyClient() {
  printSection("2. FlyClient: O(log n) sampled headers vs SPV's O(n)");

  console.log("  chain height        SPV (download all)     FlyClient (sample)");
  for (const height of [1_000, 100_000, 10_000_000, 14_000_000]) {
    const spv = height.toLocaleString("en-US");
    const fly = `~${flyClientHeaders(height)} headers`;
    console.log(`  ${height.toLocaleString("en-US").padStart(12)}        ${spv.padStart(12)} headers     ${fly}`);
  }
  console.log("");
  console.log("  14,000,000 headers collapses to ~37 sampled headers. That is the trick.");
  console.log("");

  console.log("How it works");
  console.log("  - Merkle Mountain Ranges (MMRs) embed difficulty commitments in each header");
  console.log("  - the client samples logarithmically spaced positions and checks PoW at each");
  console.log("  - it confirms MMR linkage so a forged subchain cannot pass without redoing work");
  console.log("");

  console.log("Why CKB's NC-Max makes the sampling tight");
  console.log("  - difficulty adjusts every epoch (~4 hours) instead of every 2016 blocks");
  console.log("  - smoother difficulty history reduces sampling variance");
  console.log("  - the MMR root is native to the header, not bolted on afterward");
  console.log("  - uncle blocks are formally counted in the difficulty commitment");
}

// set_scripts REPLACES the entire registered list. The single most common light
// client bug is calling it with one script and silently dropping the rest. Always
// get_scripts -> merge -> set_scripts.
function mergeScripts(existing: ScriptStatus[], additions: ScriptStatus[]): ScriptStatus[] {
  const key = (s: ScriptStatus) =>
    `${s.script.code_hash}|${s.script.hash_type}|${s.script.args}|${s.script_type}`;
  const merged = new Map<string, ScriptStatus>();
  for (const s of existing) merged.set(key(s), s);
  for (const s of additions) {
    const existingEntry = merged.get(key(s));
    // for a script we already watch, keep the HIGHER block_number so we preserve
    // its sync progress instead of forcing a re-sync from genesis
    if (!existingEntry || BigInt(s.block_number) > BigInt(existingEntry.block_number)) {
      merged.set(key(s), s);
    }
  }
  return [...merged.values()];
}

function printRpcFlow() {
  printSection("3. set_scripts / get_scripts / get_cells");

  const lock = (args: string): Script => ({
    code_hash: "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8",
    hash_type: "type",
    args,
  });

  const alreadyWatched: ScriptStatus[] = [
    { script: lock("0xaaaa1111"), script_type: "lock", block_number: "0xb00000" },
  ];
  const wantToAdd: ScriptStatus[] = [
    { script: lock("0xbbbb2222"), script_type: "lock", block_number: "0x0" },
    { script: lock("0xaaaa1111"), script_type: "lock", block_number: "0x0" },
  ];

  console.log("set_scripts REPLACES the entire watch list on every call.");
  console.log("Naive add = silently un-watching everything else. So: get_scripts -> merge -> set_scripts.\n");

  console.log("get_scripts (already registered):");
  for (const s of alreadyWatched) {
    console.log(`  ${s.script.args} @ start ${s.block_number}`);
  }
  console.log("\nwant to add:");
  for (const s of wantToAdd) {
    console.log(`  ${s.script.args} @ start ${s.block_number}`);
  }

  const merged = mergeScripts(alreadyWatched, wantToAdd);
  console.log("\nmerged list to submit via set_scripts:");
  for (const s of merged) {
    console.log(`  ${s.script.args} @ start ${s.block_number}`);
  }
  console.log("  (0xaaaa1111 kept its synced block 0xb00000; 0xbbbb2222 added fresh from 0x0)");
  console.log("");

  console.log("get_scripts -> per-script block_number is that script's sync progress");
  console.log('get_cells  -> [searchKey, "asc", "0x64", null], registered scripts only');
}

function printCapabilityMatrix() {
  printSection("4. Capability matrix");

  console.log("CAN");
  for (const c of [
    "check balances of registered scripts (query live cells)",
    "send transactions (peers validate them)",
    "verify a cell exists (cell + Merkle proof against verified headers)",
    "monitor registered scripts for appearance / spending",
  ]) {
    console.log(`  + ${c}`);
  }
  console.log("");
  console.log("CANNOT");
  for (const c of [
    "list full historical transactions for an address (needs a full node)",
    "query a script it was never told to watch via set_scripts",
    "serve other light clients (it only downloads from full-node peers)",
    "execute lock or type scripts (no CKB-VM on board)",
  ]) {
    console.log(`  - ${c}`);
  }
}

async function fetchLiveScripts(): Promise<ScriptStatus[] | null> {
  try {
    const res = await fetch(LIGHT_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "get_scripts", params: [] }),
      signal: AbortSignal.timeout(3000),
    });
    const json = (await res.json()) as { result?: ScriptStatus[]; error?: { message: string } };
    if (json.error) throw new Error(json.error.message);
    return json.result ?? [];
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.log(`  (no light client on ${LIGHT_RPC}: ${reason})`);
    return null;
  }
}

async function printLivePath() {
  printSection("5. Live light-client probe");
  if (!LIVE) {
    console.log("  skipped (set CKB_RUN_LIGHT_LIVE=1 to query a local ckb-light-client)");
    return;
  }
  const scripts = await fetchLiveScripts();
  if (!scripts) {
    console.log("  skipped");
    return;
  }
  console.log(`  ${scripts.length} script(s) currently registered:`);
  for (const s of scripts) {
    console.log(`  ${s.script.args} (${s.script_type}) @ ${s.block_number}`);
  }
}

function printTakeaways() {
  printSection("6. Week 4 invariant (light client)");
  console.log("  - a light client trusts proof-of-work math, not a node's word, for ~1 MB of state");
  console.log("  - FlyClient turns O(n) header download into O(log n) sampling via MMR commitments");
  console.log("  - set_scripts replaces the whole watch list, so always merge before you submit");
  console.log("  - what you can do is bounded by what you registered; there is no global view");
}

async function main() {
  printStorageSpectrum();
  printFlyClient();
  printRpcFlow();
  printCapabilityMatrix();
  await printLivePath();
  printTakeaways();
}

try {
  await main();
  process.exit(0);
} catch (error) {
  console.error("16-light-client failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
