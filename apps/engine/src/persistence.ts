import { sql } from "drizzle-orm";
import type { ChallengeEngine } from "@qtp/core";
import {
  engineCheckpoints,
  eventActions,
  orders,
  participants,
  positions,
  trades,
  type Database,
} from "@qtp/db";
import type { EngineEvent, OrderStatus, TradeEvent } from "@qtp/shared";

export type DbTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];

interface PendingOrder {
  status: OrderStatus;
  remaining: number;
}

/**
 * Buffers engine events and flushes them to Postgres in batches so the hot
 * matching loop is never blocked on database I/O. Each batch atomically commits
 * its projections, settlement writes, and a full engine checkpoint.
 */
export class Persistence {
  private tradeBuf: TradeEvent[] = [];
  private readonly pendingOrders = new Map<string, PendingOrder>();
  private readonly affectedUsers = new Set<string>();
  private pendingWrites: Array<(tx: DbTransaction) => Promise<void>> = [];
  private flushChain: Promise<void> = Promise.resolve();
  private progress: { cursor?: string; minuteCount?: number } = {};
  private commitGuard: () => void = () => {};
  /**
   * Every timer on the mutation queue ends in a flush. Skipping flushes with
   * nothing new keeps idle timers from committing a full checkpoint several
   * times a second ahead of trader orders. A clean flush still commits after
   * `maxCleanMs` so state changed without a tracked event is never stale long.
   */
  private dirty = true;
  private lastCommitAt = 0;
  private committed: { cursor?: string; minuteCount?: number } = {};
  private static readonly maxCleanMs = 1000;

  constructor(
    private readonly db: Database,
    private readonly challengeId: string,
    private readonly engine: ChallengeEngine,
  ) {}

  /** Force the next flush to commit (state changed without an event). */
  markDirty(): void {
    this.dirty = true;
  }

  collect(events: EngineEvent[]): void {
    if (events.length > 0) this.dirty = true;
    for (const e of events) {
      if (e.type === "trade") {
        this.tradeBuf.push(e);
        this.affectedUsers.add(e.buyerId);
        this.affectedUsers.add(e.sellerId);
      } else if (e.type === "order_update") {
        if (e.orderId) {
          this.pendingOrders.set(e.orderId, {
            status: e.status,
            remaining: e.remainingQuantity,
          });
        }
        this.affectedUsers.add(e.userId);
      } else if (
        // Off-book settlements that move cash/positions without a book trade.
        e.type === "carry_charge" ||
        e.type === "loan_update" ||
        e.type === "otc_settled" ||
        e.type === "option_exercised" ||
        e.type === "option_assigned" ||
        e.type === "grant_awarded" ||
        e.type === "wealth_tax"
      ) {
        if ("userId" in e && e.userId) this.affectedUsers.add(e.userId);
      }
    }
  }

  /** Mark users so their cash + positions are re-synced on the next flush. */
  markUsers(userIds: string[]): void {
    if (userIds.length > 0) this.dirty = true;
    for (const u of userIds) this.affectedUsers.add(u);
  }

  queueWrite(write: (tx: DbTransaction) => Promise<void>): void {
    this.dirty = true;
    this.pendingWrites.push(write);
  }

  setProgress(progress: { cursor?: string; minuteCount?: number }): void {
    this.progress = { ...this.progress, ...progress };
  }

  setCommitGuard(guard: () => void): void {
    this.commitGuard = guard;
  }

  flush(options?: {
    cursor?: string;
    minuteCount?: number;
    receipt?: string;
    write?: (tx: DbTransaction) => Promise<void>;
  }): Promise<void> {
    const { cursor, minuteCount, receipt, write } = {
      ...this.progress,
      ...options,
    };
    const flushing = this.flushChain.then(async () => {
      if (write) this.pendingWrites.push(write);
      const mustCommit =
        this.dirty ||
        receipt !== undefined ||
        this.pendingWrites.length > 0 ||
        cursor !== this.committed.cursor ||
        minuteCount !== this.committed.minuteCount ||
        Date.now() - this.lastCommitAt >= Persistence.maxCleanMs;
      if (!mustCommit) return;
      this.dirty = false;
      const tradesToInsert = this.tradeBuf;
      const orderUpdates = [...this.pendingOrders.entries()];
      const users = [...this.affectedUsers];
      // Capture every account value before the first await, including positions.
      const accounts = users.filter(isUuid).map((userId) => ({
        userId,
        cash: this.engine.cashOf(userId),
        loanDebt: this.engine.loanDebtOf(userId),
        positions: this.engine.allPositions(userId),
      }));
      const state = this.engine.exportState();
      const writes = this.pendingWrites;
      this.tradeBuf = [];
      this.pendingOrders.clear();
      this.affectedUsers.clear();
      this.pendingWrites = [];

      try {
        await this.db.transaction(async (tx) => {
          this.commitGuard();
          if (tradesToInsert.length > 0) {
            await tx.insert(trades).values(
              tradesToInsert.map((t) => ({
                challengeId: this.challengeId,
                symbol: t.symbol,
                price: t.price,
                quantity: t.quantity,
                takerSide: t.takerSide,
                buyOrderId: isUuid(t.buyOrderId) ? t.buyOrderId : null,
                sellOrderId: isUuid(t.sellOrderId) ? t.sellOrderId : null,
                buyerId: isUuid(t.buyerId) ? t.buyerId : null,
                sellerId: isUuid(t.sellerId) ? t.sellerId : null,
                executedAt: new Date(t.ts),
              })),
            );
          }

          // Set-based writes: one statement per table per chunk, not per row,
          // so a large batch commits in a handful of round trips.
          const humanOrders = orderUpdates.filter(([id]) => isUuid(id));
          for (const part of chunks(humanOrders, 1000)) {
            const values = sql.join(
              part.map(
                ([id, upd]) =>
                  sql`(${id}::uuid, ${upd.status}::order_status, ${upd.remaining}::integer)`,
              ),
              sql`, `,
            );
            await tx.execute(
              sql`update ${orders} set status = v.status, remaining_quantity = v.remaining
                  from (values ${values}) as v(id, status, remaining)
                  where ${orders.id} = v.id`,
            );
          }

          for (const part of chunks(accounts, 1000)) {
            await tx
              .insert(participants)
              .values(
                part.map(({ userId, cash, loanDebt }) => ({
                  challengeId: this.challengeId,
                  userId,
                  startingCash: state.config.startingCash,
                  cash,
                  loanDebt,
                })),
              )
              .onConflictDoUpdate({
                target: [participants.challengeId, participants.userId],
                set: {
                  cash: sql`excluded.cash`,
                  loanDebt: sql`excluded.loan_debt`,
                },
              });
          }

          const now = new Date();
          const positionRows = accounts.flatMap(({ userId, positions: held }) =>
            held.map((pos) => ({
              challengeId: this.challengeId,
              userId,
              symbol: pos.symbol,
              quantity: pos.quantity,
              avgPrice: pos.avgPrice,
              updatedAt: now,
            })),
          );
          for (const part of chunks(positionRows, 1000)) {
            await tx
              .insert(positions)
              .values(part)
              .onConflictDoUpdate({
                target: [
                  positions.challengeId,
                  positions.userId,
                  positions.symbol,
                ],
                set: {
                  quantity: sql`excluded.quantity`,
                  avgPrice: sql`excluded.avg_price`,
                  updatedAt: sql`excluded.updated_at`,
                },
              });
          }

          for (const pendingWrite of writes) await pendingWrite(tx);

          const checkpoint = {
            state,
            updatedAt: new Date(),
            ...(cursor !== undefined ? { cursor } : {}),
            ...(minuteCount !== undefined ? { minuteCount } : {}),
          };
          await tx
            .insert(engineCheckpoints)
            .values({ challengeId: this.challengeId, ...checkpoint })
            .onConflictDoUpdate({
              target: engineCheckpoints.challengeId,
              set: checkpoint,
            });

          if (receipt !== undefined) {
            await tx
              .insert(eventActions)
              .values({
                challengeId: this.challengeId,
                actionId: receipt,
                completedAt: new Date(),
              })
              .onConflictDoNothing();
          }
          this.commitGuard();
        });
        this.committed = { cursor, minuteCount };
        this.lastCommitAt = Date.now();
      } catch (err) {
        this.dirty = true;
        this.tradeBuf = [...tradesToInsert, ...this.tradeBuf];
        // Events collected during I/O supersede this failed batch's updates.
        const newerOrders = [...this.pendingOrders];
        this.pendingOrders.clear();
        for (const [id, update] of [...orderUpdates, ...newerOrders]) {
          this.pendingOrders.set(id, update);
        }
        const newerUsers = [...this.affectedUsers];
        this.affectedUsers.clear();
        for (const userId of [...users, ...newerUsers]) {
          this.affectedUsers.add(userId);
        }
        this.pendingWrites = [...writes, ...this.pendingWrites];
        throw err;
      }
    });
    // A failed caller still receives its rejection without poisoning the queue.
    this.flushChain = flushing.catch(() => {});
    return flushing;
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(s: string | null | undefined): s is string {
  return !!s && UUID_RE.test(s);
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}
