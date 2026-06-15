import { createReadStream, existsSync, mkdtempSync, rmSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWriteStream } from "node:fs";
import streamJson from "stream-json";
import StreamArrayMod from "stream-json/streamers/StreamArray.js";
import { x as extractTar } from "tar";

const { parser } = streamJson;
const { streamArray } = StreamArrayMod;
import { config } from "../lib/config.js";
import { httpFetch } from "../lib/http.js";
import { log, logger } from "../lib/logger.js";
import { errMessage } from "../lib/coerce.js";
import { normalizeReport } from "../lib/normalize.js";
import { openDb, makeInserter, setMeta } from "../db/schema.js";
import { EXTRACTION_VERSION } from "../db/migrate.js";
import { latestDump, findDump, type DumpInfo } from "../sources/dump-registry.js";

const JSON_ENTRY = "reports_piiremoved.json";

export interface IngestSource {
  /** Local path to a .tar.gz or .json file. */
  file?: string;
  /** Exact dump filename to fetch from the bdefore repo. */
  dumpName?: string;
  /** Direct URL to a .tar.gz. */
  url?: string;
}

export interface IngestStats {
  recordCount: number;
  dumpFile: string;
  dumpDate: string | null;
}

async function downloadTo(url: string, dest: string): Promise<void> {
  log("downloading", url);
  const res = await httpFetch(url, { timeoutMs: 120_000, retries: 2 });
  if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`);
  await pipeline(
    Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
    createWriteStream(dest),
  );
}

/** Resolve where the JSON report array lives, downloading/extracting as needed. */
async function resolveJsonPath(
  source: IngestSource,
  workDir: string,
): Promise<{ jsonPath: string; dumpFile: string; dumpDate: string | null }> {
  // Local .json file — use directly.
  if (source.file && source.file.endsWith(".json")) {
    return { jsonPath: source.file, dumpFile: source.file, dumpDate: null };
  }

  let archivePath: string;
  let dumpFile: string;
  let dumpDate: string | null = null;

  if (source.file) {
    archivePath = source.file;
    dumpFile = source.file;
  } else {
    let dump: DumpInfo | null;
    if (source.url) {
      dump = null;
      dumpFile = source.url.split("/").pop() ?? "custom.tar.gz";
    } else if (source.dumpName) {
      dump = await findDump(source.dumpName);
      if (!dump) throw new Error(`dump not found in repo: ${source.dumpName}`);
      dumpFile = dump.name;
    } else {
      dump = await latestDump();
      if (!dump) throw new Error("could not list dumps from bdefore/protondb-data");
      dumpFile = dump.name;
    }
    if (dump) dumpDate = `${dump.year}-${String(dump.month).padStart(2, "0")}-${dump.seq}`;
    archivePath = join(workDir, "dump.tar.gz");
    await downloadTo(source.url ?? dump!.url, archivePath);
  }

  log("extracting", JSON_ENTRY, "from", dumpFile);
  await extractTar({ file: archivePath, cwd: workDir }, [JSON_ENTRY]);
  const jsonPath = join(workDir, JSON_ENTRY);
  if (!existsSync(jsonPath)) {
    throw new Error(`archive did not contain ${JSON_ENTRY}`);
  }
  return { jsonPath, dumpFile, dumpDate };
}

/**
 * Download (if needed) a ProtonDB bulk dump and stream-load its individual
 * reports into a fresh SQLite database at `targetDbPath`. Existing DB at the
 * target is replaced. Returns ingest statistics.
 */
export async function ingestToDb(source: IngestSource, targetDbPath: string): Promise<IngestStats> {
  const workDir = mkdtempSync(join(tmpdir(), "protondb-ingest-"));
  // Start from a clean target DB.
  for (const p of [targetDbPath, targetDbPath + "-wal", targetDbPath + "-shm"]) {
    if (existsSync(p)) rmSync(p, { force: true });
  }
  const db = openDb(targetDbPath);
  try {
    const { jsonPath, dumpFile, dumpDate } = await resolveJsonPath(source, workDir);
    const insert = makeInserter(db);

    let count = 0;
    let skipped = 0;
    // Single all-or-nothing transaction: the DB is built in a temp file and only
    // atomically swapped into place on success (see auto-update swapDb), so a
    // partial ingest must never be committed.
    db.exec("BEGIN");
    try {
      await pipeline(
        createReadStream(jsonPath),
        parser(),
        streamArray(),
        async function (records: AsyncIterable<{ value: unknown }>) {
          for await (const { value } of records) {
            const rep = normalizeReport(value as Record<string, unknown>, "dump");
            if (rep) {
              insert(rep);
              count++;
            } else {
              skipped++;
            }
          }
        },
      );
      db.exec("COMMIT");
    } catch (err) {
      // Best-effort rollback; never let a rollback failure mask the original
      // error (the temp DB is discarded regardless).
      try {
        db.exec("ROLLBACK");
      } catch (rollbackErr) {
        logger.error("ingest rollback failed:", errMessage(rollbackErr));
      }
      throw err;
    }
    if (skipped > 0) logger.warn(`skipped ${skipped} records with no usable appId`);

    setMeta(db, "dump_file", dumpFile);
    if (dumpDate) setMeta(db, "dump_date", dumpDate);
    setMeta(db, "record_count", String(count));
    setMeta(db, "ingested_at", new Date().toISOString());
    setMeta(db, "data_version", String(EXTRACTION_VERSION));
    // Fold the WAL back into the main file so the DB is a single self-contained
    // file that can be atomically renamed into place (see auto-update swap).
    db.pragma("wal_checkpoint(TRUNCATE)");
    log(`ingested ${count} reports from ${dumpFile}`);
    return { recordCount: count, dumpFile, dumpDate };
  } finally {
    db.close();
    rmSync(workDir, { recursive: true, force: true });
  }
}

function parseArgs(argv: string[]): IngestSource {
  const src: IngestSource = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file") src.file = argv[++i];
    else if (a === "--url") src.url = argv[++i];
    else if (a === "--dump" || a === "--name") src.dumpName = argv[++i];
  }
  return src;
}

// CLI entry: `node dist/scripts/ingest.js [--file f | --url u | --dump name]`
const isMain = process.argv[1]?.endsWith("ingest.js");
if (isMain) {
  ingestToDb(parseArgs(process.argv.slice(2)), config.dbPath)
    .then((s) => {
      log("done:", JSON.stringify(s));
      process.exit(0);
    })
    .catch((err) => {
      logger.error("ingest failed:", errMessage(err));
      process.exit(1);
    });
}
