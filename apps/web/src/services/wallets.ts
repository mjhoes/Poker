import { ledgerSchema, nameSchema, newId, uuid, walletCreateSchema, walletSchema, walletTopupSchema, walletTransferSchema } from "@perfect-draw/shared";
import type { WalletLedger, WalletService } from "@perfect-draw/shared";
import { db, live, requireRecord, stamp } from "../data/db";
import Dexie from "dexie";

/** Call only inside a transaction that includes wallets and walletLedger. */
export async function postLedger(walletId: string, amountCents: number, type: WalletLedger["type"], extra: { sessionId?: string; transferId?: string } = {}) {
  const transaction = Dexie.currentTransaction;
  if (transaction?.mode !== "readwrite" || !["wallets", "walletLedger", "sessions"].every(name => transaction.storeNames.includes(name))) {
    throw new Error("Wallet changes require an atomic wallet, ledger and session transaction.");
  }
  const wallet = await requireRecord("wallets", walletId);
  const next = walletSchema.parse({ ...wallet, balanceCents: wallet.balanceCents + amountCents, updatedAt: Date.now() });
  const row = ledgerSchema.parse({
    id: newId(), ...stamp(), walletId, type, amountCents, balanceAfterCents: next.balanceCents, createdAt: Date.now(), ...extra,
  });
  await db.records("wallets").put(next);
  await db.records("walletLedger").add(row);
  // All sessions sharing this wallet must show the same current bankroll.
  const sessions = await db.records("sessions").where("walletId").equals(walletId).toArray();
  for (const session of sessions.filter(x => live(x) && x.status !== "closed")) {
    await db.records("sessions").put({ ...session, updatedAt: Date.now(), state: { ...session.state, credits: next.balanceCents / session.machineSnapshot.denominationCents } });
  }
  return next;
}
const tables = () => [db.records("wallets"), db.records("walletLedger"), db.records("sessions")];
export const walletService: WalletService = {
  async list() { return (await db.records("wallets").toArray()).filter(live).map(x => walletSchema.parse(x)); },
  async create(input: unknown) {
    const { name, initialCents } = walletCreateSchema.parse(input);
    return db.transaction("rw", tables(), async () => {
      const wallet = walletSchema.parse({ id: newId(), name, balanceCents: 0, createdAt: Date.now(), ...stamp() });
      await db.records("wallets").add(wallet);
      return initialCents ? postLedger(wallet.id, initialCents, "topup") : wallet;
    });
  },
  async rename(id: string, name: string) {
    uuid.parse(id); const parsed = nameSchema.parse(name);
    return db.transaction("rw", db.records("wallets"), async () => {
      const wallet = walletSchema.parse({ ...await requireRecord("wallets", id), name: parsed, updatedAt: Date.now() });
      await db.records("wallets").put(wallet); return wallet;
    });
  },
  async topup(input: unknown) {
    const { walletId, amountCents } = walletTopupSchema.parse(input);
    return db.transaction("rw", tables(), () => postLedger(walletId, amountCents, "topup"));
  },
  async transfer(input: unknown) {
    const { fromId, toId, amountCents } = walletTransferSchema.parse(input);
    return db.transaction("rw", tables(), async () => {
      await requireRecord("wallets", toId);
      const from = await requireRecord("wallets", fromId);
      if (from.balanceCents < amountCents) throw new Error("Insufficient play-money balance.");
      const transferId = newId();
      await postLedger(fromId, -amountCents, "transfer", { transferId });
      await postLedger(toId, amountCents, "transfer", { transferId });
    });
  },
  async ledger(walletId: string) {
    uuid.parse(walletId);
    return (await db.records("walletLedger").where("walletId").equals(walletId).toArray()).filter(live).sort((a, b) => b.id.localeCompare(a.id)).map(x => ledgerSchema.parse(x));
  },
};
