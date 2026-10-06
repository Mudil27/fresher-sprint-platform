import { and, eq } from "drizzle-orm";
import { etfNav, type ChallengeEngine } from "@qtp/core";
import {
  addListedSymbol,
  getEtfWindowClock,
  getEtfWindows,
  isEtfWindowOpen,
  publishBroadcast,
  setBookSnapshot,
  setEtfWindow,
  setEtfWindowClock,
  setFairValue,
  setPrice,
  type Redis,
} from "@qtp/bus";
import {
  bondHoldings as bondHoldingsT,
  type Challenge,
  type Database,
} from "@qtp/db";
import {
  bondCouponAmount,
  bondMarkValue,
  midFromBook,
  edenEtfWindowIntervalMs,
  edenEtfWindowMs,
  type BondHolding,
  type BondTemplate,
  type EngineEvent,
  type EtfConfig,
  type EtfWindowClock,
  type SymbolConfig,
} from "@qtp/shared";
import type { DbTransaction, Persistence } from "./persistence.js";

/**
 * Bonds + ETFs for New Eden (comp_desc Session 1):
 *
 *  - Bonds: each series once per trader. The trader picks a principal that
 *    cannot exceed free cash, pays it now, and receives that amount × the
 *    payout multiplier in equal game-minute credits through endsAt (the
 *    inverse cashflow of a predatory loan). Outstanding principal is marked
 *    at cost × remaining payout fraction — illiquid, so it lifts net worth
 *    but not free cash.
 *  - ETFs: a synthetic whose fair value tracks a weighted spot basket (NAV).
 *    It trades in the open market, and a periodic 30-second window lets traders
 *    create/redeem units at NAV to arbitrage market dislocations.
 */
export class MarketsManager {
  private readonly bonds: BondTemplate[];
  private readonly etfs: EtfConfig[];
  private readonly bondValue = new Map<string, number>();
  private readonly holdingsByUser = new Map<string, Map<string, BondHolding>>();
  private readonly timers = new Set<NodeJS.Timeout>();
  private running = false;
  private windowLoopStarted = false;
  private bondWork: Promise<void> = Promise.resolve();
  private persistence?: Pick<Persistence, "queueWrite" | "markUsers">;
  private dispatch: (task: () => Promise<void>) => void = (task) => {
    void task().catch(console.error);
  };

  constructor(
    private readonly engine: ChallengeEngine,
    private readonly redis: Redis,
    private readonly db: Database,
    private readonly challenge: Challenge,
    bonds: BondTemplate[],
    etfs: EtfConfig[],
    private readonly minuteMs: number,
    private readonly emit: (events: EngineEvent[]) => Promise<void>,
    private readonly refreshPortfolios: (
      userIds: string[],
      ts: number,
    ) => Promise<void>,
  ) {
    this.bonds = [...bonds];
    this.etfs = [...etfs];
  }

  get hasBonds(): boolean {
    return this.bonds.length > 0;
  }

  get hasEtfs(): boolean {
    return this.etfs.length > 0;
  }

  bondValueOf(userId: string): number {
    return this.bondValue.get(userId) ?? 0;
  }

  bondsOf(userId: string): BondHolding[] {
    return [...(this.holdingsByUser.get(userId)?.values() ?? [])].filter(
      (holding) => holding.quantity > 0,
    );
  }

  /** Replace one trader's bond book. Empty list clears every series they hold. */
  replaceUserBonds(userId: string, holdings: BondHolding[]): void {
    const current = [...(this.holdingsByUser.get(userId)?.keys() ?? [])];
    for (const bondId of current) {
      const prev = this.holdingsByUser.get(userId)?.get(bondId);
      if (!prev) continue;
      this.setBondHolding(userId, { ...prev, quantity: 0 });
    }
    for (const holding of holdings) {
      if (holding.quantity > 0) this.setBondHolding(userId, holding);
    }
  }

  /** Persist restored bond books so a restart does not revive the old series. */
  async persistUserBonds(userIds: string[]): Promise<void> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return;
    const challengeId = this.challenge.id;
    await this.write(async (tx) => {
      for (const userId of unique) {
        await tx
          .delete(bondHoldingsT)
          .where(
            and(
              eq(bondHoldingsT.challengeId, challengeId),
              eq(bondHoldingsT.userId, userId),
            ),
          );
        const rows = this.bondsOf(userId);
        if (rows.length === 0) continue;
        await tx.insert(bondHoldingsT).values(
          rows.map((holding) => ({
            challengeId,
            userId,
            bondId: holding.bondId,
            name: holding.name,
            quantity: holding.quantity,
            price: holding.price,
            faceValue: holding.faceValue,
            couponsPaid: holding.couponsPaid,
          })),
        );
      }
    });
    this.persistence?.markUsers(unique);
  }

  private setBondHolding(userId: string, holding: BondHolding): void {
    let byBond = this.holdingsByUser.get(userId);
    if (!byBond) {
      byBond = new Map();
      this.holdingsByUser.set(userId, byBond);
    }
    if (holding.quantity > 0) byBond.set(holding.bondId, holding);
    else byBond.delete(holding.bondId);
    const mark = [...byBond.values()].reduce(
      (sum, row) => sum + bondMarkValue(row),
      0,
    );
    if (mark > 0) this.bondValue.set(userId, mark);
    else {
      this.bondValue.delete(userId);
      if (byBond.size === 0) this.holdingsByUser.delete(userId);
    }
  }

  setDispatcher(dispatch: (task: () => Promise<void>) => void): void {
    this.dispatch = dispatch;
  }

  /** Production must install this before start; emit must flush the queued batch. */
  setPersistence(
    persistence: Pick<Persistence, "queueWrite" | "markUsers">,
  ): void {
    this.persistence = persistence;
  }

  private async write(
    write: (tx: DbTransaction) => Promise<void>,
  ): Promise<void> {
    if (this.persistence) this.persistence.queueWrite(write);
    else await this.db.transaction(write);
  }

  listBond(template: BondTemplate): boolean {
    if (this.bonds.some((bond) => bond.id === template.id)) return false;
    this.bonds.push(template);
    return true;
  }

  /** Stop subscriptions to a bond; holders keep their schedule. */
  closeBond(bondId: string): void {
    const i = this.bonds.findIndex((bond) => bond.id === bondId);
    if (i >= 0) this.bonds[i] = { ...this.bonds[i]!, closed: true };
  }

  /** Terms of a listed bond (for scheduled coupons and the UI). */
  bondTemplate(bondId: string): BondTemplate | undefined {
    return this.bonds.find((bond) => bond.id === bondId);
  }

  /**
   * Pay coupon `index` of a scheduled bond (or, at maturity, the principal)
   * to every current holder. Everyone holding now subscribed before this
   * action ran, so a later buyer never receives an earlier coupon. Runs on
   * the bond queue; the caller commits it with the timeline receipt.
   */
  payScheduledCoupon(
    bondId: string,
    index: number,
    maturity: boolean,
    ts: number,
  ): Promise<void> {
    const work = this.bondWork.then(() =>
      this.payScheduled(bondId, index, maturity, ts),
    );
    this.bondWork = work.catch(() => {});
    return work;
  }

  private async payScheduled(
    bondId: string,
    index: number,
    maturity: boolean,
    ts: number,
  ): Promise<void> {
    const tpl = this.bonds.find((bond) => bond.id === bondId);
    const schedule = tpl?.schedule;
    if (!tpl || !schedule) return;
    const touched: string[] = [];
    const events: EngineEvent[] = [];
    const updates: Array<{ userId: string; couponsPaid: number }> = [];
    const total = schedule.couponSeconds.length;
    for (const [userId, byBond] of this.holdingsByUser) {
      const holding = byBond.get(bondId);
      if (!holding || holding.quantity <= 0) continue;
      const amount = maturity
        ? holding.price
        : bondCouponAmount(schedule, holding.price);
      if (!(amount > 0)) continue;
      const couponsPaid = holding.couponsPaid + amount;
      updates.push({ userId, couponsPaid });
      this.engine.adjustCash(userId, amount);
      this.setBondHolding(userId, { ...holding, couponsPaid });
      touched.push(userId);
      events.push({
        type: "alert",
        challengeId: this.challenge.id,
        userId,
        level: "info",
        message: maturity
          ? `${tpl.name} matured: principal of INR ${amount.toFixed(2)} returned to your cash.`
          : `Coupon ${index + 1} of ${total} received: +INR ${amount.toFixed(2)} from ${tpl.name}.`,
        ts,
      });
    }
    if (updates.length === 0) return;
    const challengeId = this.challenge.id;
    await this.write(async (tx) => {
      for (const u of updates) {
        await tx
          .update(bondHoldingsT)
          .set({ couponsPaid: u.couponsPaid })
          .where(
            and(
              eq(bondHoldingsT.challengeId, challengeId),
              eq(bondHoldingsT.userId, u.userId),
              eq(bondHoldingsT.bondId, bondId),
            ),
          );
      }
    });
    this.persistence?.markUsers(touched);
    await this.emit(events);
    await this.refreshPortfolios(touched, ts);
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.bondValue.clear();
    this.holdingsByUser.clear();
    // Restore holdings so net worth and the portfolio list survive restarts.
    const rows = await this.db
      .select()
      .from(bondHoldingsT)
      .where(eq(bondHoldingsT.challengeId, this.challenge.id));
    for (const r of rows) {
      if (r.quantity > 0) {
        this.setBondHolding(r.userId, {
          bondId: r.bondId,
          name: r.name,
          quantity: r.quantity,
          price: r.price,
          faceValue: r.faceValue,
          couponsPaid: r.couponsPaid,
        });
      }
    }

    // List ETFs as tradeable (non-autonomous) instruments around their NAV.
    const now = Date.now();
    const sequence = this.engine.exportState().bookSequence;
    for (const etf of this.etfs) {
      const nav = this.navOf(etf);
      this.engine.addSymbol(
        {
          symbol: etf.symbol,
          name: etf.name,
          initialPrice: Math.max(0.1, nav),
          volatility: 0,
          tickSize: etf.tickSize ?? 0.1,
        },
        { autonomous: false },
      );
      await setPrice(
        this.redis,
        this.challenge.id,
        etf.symbol,
        this.engine.getPrice(etf.symbol)!,
        now,
      );
      await setFairValue(
        this.redis,
        this.challenge.id,
        etf.symbol,
        this.engine.getFairValue(etf.symbol) ??
          Math.max(0.1, this.navOf(etf, true)),
      );
      this.engine.setFairValue(
        etf.symbol,
        this.engine.getFairValue(etf.symbol) ??
          Math.max(0.1, this.navOf(etf, true)),
      );
      await setBookSnapshot(this.redis, this.challenge.id, {
        symbol: etf.symbol,
        ...this.engine.snapshot(etf.symbol),
        sequence,
      });
      await addListedSymbol(this.redis, this.challenge.id, etf.symbol);
    }

    // Periodic create/redeem windows: open now, then every 10 game minutes.
    if (this.etfs.length > 0) this.ensureWindowLoop();
  }

  /**
   * Introduce a new ETF into a live challenge (no pause). Lists it as a
   * tradeable non-autonomous instrument around its NAV and ensures the periodic
   * create/redeem window loop is running.
   */
  async listEtf(cfg: EtfConfig): Promise<SymbolConfig | null> {
    if (this.etfs.some((e) => e.symbol === cfg.symbol)) return null;
    this.etfs.push(cfg);
    const now = Date.now();
    const tick = cfg.tickSize ?? 0.1;
    const seed = cfg.seedFromMids ? this.navFromMids(cfg) : this.navOf(cfg);
    const nav = Math.max(tick, Math.round(seed / tick) * tick);
    const symbolCfg: SymbolConfig = {
      symbol: cfg.symbol,
      name: cfg.name,
      initialPrice: nav,
      volatility: 0,
      tickSize: tick,
    };
    this.engine.addSymbol(symbolCfg, { autonomous: false });
    await setPrice(
      this.redis,
      this.challenge.id,
      cfg.symbol,
      this.engine.getPrice(cfg.symbol)!,
      now,
    );
    const fv =
      this.engine.getFairValue(cfg.symbol) ??
      Math.max(0.1, this.navOf(cfg, true));
    await setFairValue(this.redis, this.challenge.id, cfg.symbol, fv);
    this.engine.setFairValue(cfg.symbol, fv);
    await setBookSnapshot(this.redis, this.challenge.id, {
      symbol: cfg.symbol,
      ...this.engine.snapshot(cfg.symbol),
      sequence: this.engine.exportState().bookSequence,
    });
    await addListedSymbol(this.redis, this.challenge.id, cfg.symbol);
    this.ensureWindowLoop();
    return symbolCfg;
  }

  /** Open a window now, then every 10 game minutes. Scripted events use the timeline. */
  private ensureWindowLoop(): void {
    if (this.windowLoopStarted || !this.running) return;
    // Scripted and practice timelines open windows themselves.
    if (
      this.challenge.config.eden?.eventScript === true ||
      this.challenge.config.eden?.demoScript === true
    )
      return;
    this.windowLoopStarted = true;
    const windowMs = edenEtfWindowMs(this.minuteMs);
    const intervalMs = edenEtfWindowIntervalMs(this.minuteMs);
    const open = () => {
      if (!this.running || this.etfs.length === 0 || this.challenge.frozen)
        return;
      this.dispatch(() => this.openWindows());
      const close = setTimeout(() => {
        this.timers.delete(close);
        if (this.running) this.dispatch(() => this.closeWindows());
      }, windowMs);
      this.timers.add(close);
    };
    open();
    this.timers.add(setInterval(open, intervalMs) as unknown as NodeJS.Timeout);
  }

  stop(): void {
    this.running = false;
    for (const t of this.timers) {
      clearTimeout(t);
      clearInterval(t);
    }
    this.timers.clear();
    this.windowLoopStarted = false;
  }

  /** Recompute and broadcast ETF NAVs (called on the engine tick). */
  async updateNavs(now: number): Promise<void> {
    const events: EngineEvent[] = [];
    for (const etf of this.etfs) {
      const nav = Math.max(0.01, this.navOf(etf, true));
      const fv = this.engine.setFairValue(etf.symbol, nav);
      events.push({
        type: "fair_value",
        challengeId: this.challenge.id,
        symbol: etf.symbol,
        fairValue: fv,
        ts: now,
      });
    }
    if (events.length > 0) await this.emit(events);
  }

  /** Pay scheduled bond credits — called by the runner every game-minute. */
  payCoupons(now: number): Promise<void> {
    const work = this.bondWork.then(() => this.payBondPayouts(now));
    this.bondWork = work.catch(() => {});
    return work;
  }

  private async payBondPayouts(now: number): Promise<void> {
    if (this.challenge.frozen) return;
    const rows = await this.db
      .select()
      .from(bondHoldingsT)
      .where(eq(bondHoldingsT.challengeId, this.challenge.id));
    const end = this.challenge.endsAt?.getTime();
    const touched = new Set<string>();
    const events: EngineEvent[] = [];
    const payments: Array<{
      id: string;
      userId: string;
      bondId: string;
      name: string;
      quantity: number;
      price: number;
      faceValue: number;
      coupon: number;
      couponsPaid: number;
    }> = [];
    for (const r of rows) {
      if (r.quantity <= 0) continue;
      if (this.bonds.find((b) => b.id === r.bondId)?.schedule) continue;
      const remaining = r.faceValue - r.couponsPaid;
      if (!(remaining > 0) || !Number.isFinite(remaining)) continue;
      const minutes =
        end != null && now < end
          ? Math.max(1, Math.ceil((end - now) / this.minuteMs))
          : 1;
      const coupon = remaining / minutes;
      if (!Number.isFinite(coupon) || coupon === 0) continue;
      const couponsPaid = r.couponsPaid + coupon;
      payments.push({
        id: r.id,
        userId: r.userId,
        bondId: r.bondId,
        name: r.name,
        quantity: r.quantity,
        price: r.price,
        faceValue: r.faceValue,
        coupon,
        couponsPaid,
      });
      touched.add(r.userId);
      events.push({
        type: "alert",
        challengeId: this.challenge.id,
        userId: r.userId,
        level: "info",
        message: `Bond payout: +$${coupon.toFixed(2)} from ${r.name}.`,
        ts: now,
      });
    }
    if (payments.length === 0) return;
    await this.write(async (tx) => {
      for (const payment of payments) {
        await tx
          .update(bondHoldingsT)
          .set({ couponsPaid: payment.couponsPaid })
          .where(eq(bondHoldingsT.id, payment.id));
      }
    });
    for (const payment of payments) {
      this.engine.adjustCash(payment.userId, payment.coupon);
      this.setBondHolding(payment.userId, {
        bondId: payment.bondId,
        name: payment.name,
        quantity: payment.quantity,
        price: payment.price,
        faceValue: payment.faceValue,
        couponsPaid: payment.couponsPaid,
      });
    }
    this.persistence?.markUsers([...touched]);
    if (events.length > 0) await this.emit(events);
    await this.refreshPortfolios([...touched], now);
  }

  /* ---- Trader commands ---- */

  purchaseBond(
    userId: string,
    bondId: string,
    price: number,
    ts: number,
  ): Promise<void> {
    const work = this.bondWork.then(() =>
      this.buyBond(userId, bondId, price, ts),
    );
    this.bondWork = work.catch(() => {});
    return work;
  }

  private async buyBond(
    userId: string,
    bondId: string,
    price: number,
    ts: number,
  ): Promise<void> {
    const tpl = this.bonds.find((b) => b.id === bondId);
    if (!tpl || !Number.isFinite(price) || price <= 0 || price > 1_000_000) {
      await this.alert(userId, "Unknown bond or invalid price.", "warning", ts);
      return;
    }
    const existing = await this.db
      .select()
      .from(bondHoldingsT)
      .where(
        and(
          eq(bondHoldingsT.challengeId, this.challenge.id),
          eq(bondHoldingsT.userId, userId),
          eq(bondHoldingsT.bondId, bondId),
        ),
      );
    if ((existing[0]?.quantity ?? 0) > 0) {
      await this.alert(
        userId,
        `${tpl.name} can be bought only once.`,
        "warning",
        ts,
      );
      return;
    }
    const end = this.challenge.endsAt?.getTime();
    if (end == null || end <= ts) {
      await this.alert(
        userId,
        "Bond purchase requires a future session end.",
        "warning",
        ts,
      );
      return;
    }
    const schedule = tpl.schedule;
    if (schedule) {
      const closesAt =
        (this.challenge.startsAt?.getTime() ?? 0) +
        (schedule.closesAtSecond * this.minuteMs) / 60;
      if (tpl.closed || ts >= closesAt) {
        await this.alert(
          userId,
          "The bond subscription window is closed.",
          "warning",
          ts,
        );
        return;
      }
      if (price < schedule.minPrincipal || price > schedule.maxPrincipal) {
        await this.alert(
          userId,
          `Invest between INR ${schedule.minPrincipal.toLocaleString("en-IN")} and INR ${schedule.maxPrincipal.toLocaleString("en-IN")}.`,
          "warning",
          ts,
        );
        return;
      }
      if (this.challenge.config.strictRisk) {
        const reason = this.engine.cashWithdrawalRejection(userId, price);
        if (reason) {
          await this.alert(
            userId,
            reason === "insufficient_cash"
              ? "Not enough available cash for this bond (open buy orders hold cash)."
              : "This bond would push your exposure above your trading equity. Reduce positions first.",
            "warning",
            ts,
          );
          return;
        }
      }
    }
    const free = this.engine.freeCashOf(userId);
    if (!Number.isFinite(free) || price > free) {
      await this.alert(
        userId,
        `Purchase cannot exceed free cash ($${free.toFixed(2)}).`,
        "warning",
        ts,
      );
      return;
    }
    const multiplier =
      tpl.schedule?.totalReturn ??
      tpl.payoutMultiplier ??
      this.challenge.config.eden?.rules.loanRepayMultiplier ??
      2;
    const faceValue = price * multiplier;
    await this.write(async (tx) => {
      await tx.insert(bondHoldingsT).values({
        challengeId: this.challenge.id,
        userId,
        bondId,
        name: tpl.name,
        quantity: 1,
        price,
        faceValue,
        couponsPaid: 0,
      });
    });
    this.engine.adjustCash(userId, -price);
    this.setBondHolding(userId, {
      bondId,
      name: tpl.name,
      quantity: 1,
      price,
      faceValue,
      couponsPaid: 0,
    });
    this.persistence?.markUsers([userId]);
    await this.alert(
      userId,
      tpl.schedule
        ? `Subscribed to ${tpl.name}: INR ${price.toFixed(2)} locked until maturity at ${String(Math.floor(tpl.schedule.maturitySecond / 60)).padStart(2, "0")}:00. Coupons are paid to your cash.`
        : `Bought ${tpl.name} for ${price.toFixed(2)}; ${multiplier}× paid uniformly until the end.`,
      "info",
      ts,
    );
    await this.refreshPortfolios([userId], ts);
  }

  async etfTrade(
    userId: string,
    etfSymbol: string,
    action: "create" | "redeem",
    quantity: number,
    ts: number,
  ): Promise<void> {
    const etf = this.etfs.find((e) => e.symbol === etfSymbol);
    if (!etf || !Number.isSafeInteger(quantity) || quantity <= 0) {
      await this.alert(userId, "Unknown ETF.", "warning", ts);
      return;
    }
    if (!(await isEtfWindowOpen(this.redis, this.challenge.id, etfSymbol))) {
      await this.alert(
        userId,
        `${etfSymbol} create/redeem window is closed.`,
        "warning",
        ts,
      );
      return;
    }
    const nav = Math.max(0.01, this.navOf(etf));
    if (
      !this.engine.exchangeBasket(
        userId,
        etfSymbol,
        etf.basket,
        action,
        quantity,
      )
    ) {
      await this.alert(
        userId,
        this.etfRejectMessage(userId, etf, action, quantity),
        "warning",
        ts,
      );
      return;
    }
    this.persistence?.markUsers([userId]);
    await this.alert(
      userId,
      `${action === "create" ? "Created" : "Redeemed"} ${quantity} × ${etfSymbol} at NAV $${nav.toFixed(2)}.`,
      "info",
      ts,
    );
    await this.refreshPortfolios([userId], ts);
  }

  /* ---- Window control ---- */
  async openWindows(): Promise<void> {
    const now = Date.now();
    for (const etf of this.etfs) {
      await setEtfWindow(this.redis, this.challenge.id, etf.symbol, true);
    }
    await this.publishClock({
      open: true,
      closesAt: new Date(now + edenEtfWindowMs(this.minuteMs)).toISOString(),
      nextOpensAt: new Date(
        now + edenEtfWindowIntervalMs(this.minuteMs),
      ).toISOString(),
    });
    const openSec = Math.max(
      1,
      Math.round(edenEtfWindowMs(this.minuteMs) / 1000),
    );
    await this.broadcast(
      "info",
      `ETF create/redeem window OPEN for ${openSec}s: ${this.etfs.map((e) => e.symbol).join(", ")}.`,
      now,
    );
  }

  async closeWindows(): Promise<void> {
    const now = Date.now();
    for (const etf of this.etfs) {
      await setEtfWindow(this.redis, this.challenge.id, etf.symbol, false);
    }
    const prev = await getEtfWindowClock(this.redis, this.challenge.id);
    const next =
      prev?.nextOpensAt && Date.parse(prev.nextOpensAt) > now
        ? prev.nextOpensAt
        : new Date(now + edenEtfWindowIntervalMs(this.minuteMs)).toISOString();
    await this.publishClock({
      open: false,
      closesAt: null,
      nextOpensAt: next,
    });
    await this.broadcast("info", "ETF create/redeem window closed.", now);
  }

  async setWindow(etfSymbol: string, open: boolean, ts: number): Promise<void> {
    await setEtfWindow(this.redis, this.challenge.id, etfSymbol, open);
    if (open) {
      await this.publishClock({
        open: true,
        closesAt: new Date(ts + edenEtfWindowMs(this.minuteMs)).toISOString(),
        nextOpensAt: new Date(
          ts + edenEtfWindowIntervalMs(this.minuteMs),
        ).toISOString(),
      });
    } else {
      const prev = await getEtfWindowClock(this.redis, this.challenge.id);
      const next =
        prev?.nextOpensAt && Date.parse(prev.nextOpensAt) > ts
          ? prev.nextOpensAt
          : new Date(ts + edenEtfWindowIntervalMs(this.minuteMs)).toISOString();
      await this.publishClock({
        open: false,
        closesAt: null,
        nextOpensAt: next,
      });
    }
    await this.broadcast(
      "info",
      `${etfSymbol} create/redeem window ${open ? "OPEN" : "closed"}.`,
      ts,
    );
  }

  private async publishClock(clock: EtfWindowClock): Promise<void> {
    await setEtfWindowClock(this.redis, this.challenge.id, clock);
    await publishBroadcast(this.redis, this.challenge.id, [
      {
        target: "all",
        msg: {
          type: "etf_window",
          challengeId: this.challenge.id,
          data: clock,
        },
      },
    ]);
  }

  async openWindowSymbols(): Promise<string[]> {
    return getEtfWindows(this.redis, this.challenge.id);
  }

  /* ---- Internals ---- */
  private etfRejectMessage(
    userId: string,
    etf: EtfConfig,
    action: "create" | "redeem",
    quantity: number,
  ): string {
    const cap = this.challenge.config.eden?.rules?.positionCap ?? 100;
    if (action === "redeem") {
      const held = this.engine.positionOf(userId, etf.symbol);
      if (held < quantity) {
        return `Not enough ${etf.symbol} to redeem (${held} held, ${quantity} requested).`;
      }
    }
    for (const leg of etf.basket) {
      if (this.engine.getPrice(leg.symbol) === undefined) {
        return `${leg.symbol} is not available for ${action}.`;
      }
      const need = leg.weight * quantity;
      if (
        action === "create" &&
        this.engine.positionOf(userId, leg.symbol) < need
      ) {
        return `Not enough ${leg.symbol} to create (${this.engine.positionOf(userId, leg.symbol)} held, ${need} required).`;
      }
      const next =
        this.engine.positionOf(userId, leg.symbol) +
        (action === "redeem" ? need : -need);
      if (Math.abs(next) > cap) {
        return `${action === "redeem" ? "Redeeming" : "Creating"} ${quantity} ${etf.symbol} would put ${leg.symbol} at ${next} (cap ${cap}).`;
      }
    }
    if (action === "create") {
      const next = this.engine.positionOf(userId, etf.symbol) + quantity;
      if (Math.abs(next) > cap) {
        return `Creating ${quantity} ${etf.symbol} would put it at ${next} (cap ${cap}).`;
      }
    }
    return `Basket exchange rejected: insufficient inventory, unavailable component, or position cap exceeded.`;
  }

  /** Basket value at the components' order-book midpoints (last price if a side is empty). */
  private navFromMids(etf: EtfConfig): number {
    const prices: Record<string, number> = {};
    for (const c of etf.basket) {
      const snap = this.engine.snapshot(c.symbol);
      prices[c.symbol] =
        midFromBook(snap.bids, snap.asks) ??
        this.engine.getPrice(c.symbol) ??
        0;
    }
    return etfNav(etf.basket, prices);
  }

  private navOf(etf: EtfConfig, fair = false): number {
    const prices: Record<string, number> = {};
    for (const c of etf.basket) {
      prices[c.symbol] =
        (fair ? this.engine.getFairValue(c.symbol) : undefined) ??
        this.engine.getPrice(c.symbol) ??
        0;
    }
    return etfNav(etf.basket, prices);
  }

  private async alert(
    userId: string,
    message: string,
    level: "info" | "warning" | "urgent",
    ts: number,
  ): Promise<void> {
    await this.emit([
      {
        type: "alert",
        challengeId: this.challenge.id,
        userId,
        level,
        message,
        ts,
      },
    ]);
  }

  private async broadcast(
    level: "info" | "warning" | "urgent",
    message: string,
    ts: number,
  ): Promise<void> {
    await publishBroadcast(this.redis, this.challenge.id, [
      {
        target: "all",
        msg: {
          type: "alert",
          challengeId: this.challenge.id,
          data: { level, message, ts },
        },
      },
    ]);
  }
}
