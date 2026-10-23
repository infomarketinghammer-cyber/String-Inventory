/**
 * The one database client (MongoDB through Prisma). Two MongoDB-specific behaviours are handled here, once,
 * so no service has to think about them:
 *
 * 1. Empty optional fields are stored as an explicit null. MongoDB treats a field left out of a document as
 *    "missing", which `where: { field: null }` does not match; the app relies on those filters (e.g. "no
 *    receipt yet", "not inspected yet"). Every create therefore fills each optional field it did not set with null,
 *    including nested creates.
 * 2. Transactions are retried on a write conflict. MongoDB has no isolation levels; instead two transactions that
 *    write the same document (a bundle, a challan line, the document-number counter…) conflict and one is aborted
 *    (Prisma error P2034). The aborted one is run again from the start, so it re-reads current data and either
 *    succeeds or fails its own validation (e.g. "exceeds the remaining quantity").
 */
import { Prisma, PrismaClient } from "@prisma/client";

type ModelMeta = { optionalScalars: string[]; fkFields: Set<string>; owningRelations: Set<string>; relations: Map<string, string> };

const META = new Map<string, ModelMeta>();
for (const m of Prisma.dmmf.datamodel.models) {
  const fkFields = new Set<string>();
  const owningRelations = new Set<string>();
  const relations = new Map<string, string>();
  for (const f of m.fields) {
    if (f.kind === "object") {
      relations.set(f.name, f.type);
      if (f.relationFromFields && f.relationFromFields.length > 0) {
        owningRelations.add(f.name);
        f.relationFromFields.forEach((x) => fkFields.add(x));
      }
    }
  }
  const optionalScalars = m.fields
    .filter((f) => (f.kind === "scalar" || f.kind === "enum") && !f.isRequired && !f.isList && !f.isId)
    .map((f) => f.name);
  META.set(m.name, { optionalScalars, fkFields, owningRelations, relations });
}

/** Fills unset optional fields with null in a create payload (and in every nested create below it). */
function fillNulls(model: string, data: unknown): unknown {
  if (Array.isArray(data)) return data.map((d) => fillNulls(model, d));
  if (!data || typeof data !== "object") return data;
  const meta = META.get(model);
  if (!meta) return data;
  const out: Record<string, unknown> = { ...(data as Record<string, unknown>) };
  // "Checked" input (a relation given as { connect } etc.) may not carry foreign-key scalars.
  const checked = Object.keys(out).some((k) => meta.owningRelations.has(k));
  for (const f of meta.optionalScalars) {
    if (out[f] !== undefined) continue;
    if (checked && meta.fkFields.has(f)) continue;
    out[f] = null;
  }
  for (const [field, target] of meta.relations) {
    const nested = out[field] as Record<string, unknown> | undefined;
    if (!nested || typeof nested !== "object") continue;
    const n: Record<string, unknown> = { ...nested };
    if (n.create) n.create = fillNulls(target, n.create);
    if (n.createMany && typeof n.createMany === "object") {
      const cm = n.createMany as { data: unknown };
      n.createMany = { ...cm, data: fillNulls(target, cm.data) };
    }
    if (n.connectOrCreate) {
      const coc = n.connectOrCreate as { create?: unknown } | { create?: unknown }[];
      n.connectOrCreate = Array.isArray(coc)
        ? coc.map((c) => ({ ...c, create: fillNulls(target, c.create) }))
        : { ...coc, create: fillNulls(target, coc.create) };
    }
    out[field] = n;
  }
  return out;
}

const TX_RETRIES = 6;
const isWriteConflict = (e: unknown) =>
  (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") ||
  /WriteConflict|TransientTransactionError|write conflict/i.test(e instanceof Error ? e.message : "");

function createClient() {
  const base = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    // Atlas round trips: allow longer interactive transactions than Prisma's 5 s default.
    transactionOptions: { maxWait: 10_000, timeout: 30_000 },
  });
  const extended = base.$extends({
    query: {
      $allModels: {
        // (args are typed per model; the payload shape is unchanged apart from added nulls, hence the casts)
        create({ model, args, query }) {
          return query({ ...args, data: fillNulls(model, args.data) } as never);
        },
        createMany({ model, args, query }) {
          return query({ ...args, data: fillNulls(model, args.data) } as never);
        },
        upsert({ model, args, query }) {
          return query({ ...args, create: fillNulls(model, args.create) } as never);
        },
      },
    },
  });
  // Retry interactive transactions that lost a write conflict (see 2. above).
  const run = extended.$transaction.bind(extended) as (...a: unknown[]) => Promise<unknown>;
  const withRetry = async (...a: unknown[]) => {
    if (typeof a[0] !== "function") return run(...a);
    for (let attempt = 1; ; attempt++) {
      try {
        return await run(...a);
      } catch (e) {
        if (!isWriteConflict(e) || attempt >= TX_RETRIES) throw e;
        await new Promise((r) => setTimeout(r, 20 * attempt + Math.random() * 60));
      }
    }
  };
  return new Proxy(extended, {
    get(target, prop, receiver) {
      if (prop === "$transaction") return withRetry;
      return Reflect.get(target, prop, receiver);
    },
  }) as unknown as PrismaClient;
}

/** For scripts (seed, checks, data copy): a client with the same MongoDB handling as the app. */
export const createPrismaClient = createClient;

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
