export interface TokenQuotaConfig {
  maxTokensPerMin?: number;
  maxTokensPerDay?: number;
}

export interface QuotaReservation {
  id: string;
  key: string;
  reservedTokens: number;
}

export type QuotaReservationResult =
  | { allowed: true; reservation: QuotaReservation }
  | { allowed: false; reason: string };

export interface TokenQuotaStore {
  reserve(
    key: string,
    estimatedTokens: number,
    config: TokenQuotaConfig
  ): Promise<QuotaReservationResult>;
  commit(reservationId: string, actualTokens: number): Promise<void>;
  release(reservationId: string): Promise<void>;
}

interface UsageEntry {
  timestamp: number;
  tokens: number;
}

interface PendingReservation extends QuotaReservation {
  createdAt: number;
  expiresAt: number;
}

export class InMemoryTokenQuotaStore implements TokenQuotaStore {
  private windows = new Map<string, UsageEntry[]>();
  private reservations = new Map<string, PendingReservation>();

  constructor(private readonly reservationTtlMs = 5 * 60_000) {}

  async reserve(
    key: string,
    estimatedTokens: number,
    config: TokenQuotaConfig
  ): Promise<QuotaReservationResult> {
    if (!Number.isInteger(estimatedTokens) || estimatedTokens < 1) {
      throw new Error("estimatedTokens must be a positive integer");
    }

    const now = Date.now();
    this.cleanup(now);
    const entries = this.windows.get(key) ?? [];
    const pendingTokens = [...this.reservations.values()]
      .filter((reservation) => reservation.key === key)
      .reduce((sum, reservation) => sum + reservation.reservedTokens, 0);

    if (config.maxTokensPerMin !== undefined) {
      const minuteTokens =
        entries
          .filter((entry) => entry.timestamp > now - 60_000)
          .reduce((sum, entry) => sum + entry.tokens, 0) + pendingTokens;
      if (minuteTokens + estimatedTokens > config.maxTokensPerMin) {
        return {
          allowed: false,
          reason: `Token quota exceeded: ${minuteTokens}/${config.maxTokensPerMin} per minute`,
        };
      }
    }

    if (config.maxTokensPerDay !== undefined) {
      const dayTokens =
        entries
          .filter((entry) => entry.timestamp > now - 86_400_000)
          .reduce((sum, entry) => sum + entry.tokens, 0) + pendingTokens;
      if (dayTokens + estimatedTokens > config.maxTokensPerDay) {
        return {
          allowed: false,
          reason: `Token quota exceeded: ${dayTokens}/${config.maxTokensPerDay} per day`,
        };
      }
    }

    const reservation: PendingReservation = {
      id: crypto.randomUUID(),
      key,
      reservedTokens: estimatedTokens,
      createdAt: now,
      expiresAt: now + this.reservationTtlMs,
    };
    this.reservations.set(reservation.id, reservation);
    return { allowed: true, reservation };
  }

  async commit(reservationId: string, actualTokens: number): Promise<void> {
    if (!Number.isInteger(actualTokens) || actualTokens < 0) {
      throw new Error("actualTokens must be a non-negative integer");
    }

    const reservation = this.reservations.get(reservationId);
    if (!reservation) return;
    this.reservations.delete(reservationId);

    const entries = this.windows.get(reservation.key) ?? [];
    entries.push({ timestamp: Date.now(), tokens: actualTokens });
    this.windows.set(reservation.key, entries);
    this.cleanup(Date.now());
  }

  async release(reservationId: string): Promise<void> {
    this.reservations.delete(reservationId);
  }

  private cleanup(now: number): void {
    for (const [id, reservation] of this.reservations) {
      if (reservation.expiresAt <= now) this.reservations.delete(id);
    }

    const oldest = now - 86_400_000;
    for (const [key, entries] of this.windows) {
      const current = entries.filter((entry) => entry.timestamp > oldest);
      if (current.length > 0) this.windows.set(key, current);
      else this.windows.delete(key);
    }
  }
}

function extractApiKey(req: Request): string | null {
  const auth = req.headers.get("Authorization");
  if (!auth) return null;
  const token = auth.replace(/^Bearer\s*/i, "").trim();
  if (!token) return null;
  return token;
}

export async function fingerprintApiKey(apiKey: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(apiKey));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function fingerprintRequestApiKey(req: Request): Promise<string | null> {
  const apiKey = extractApiKey(req);
  return apiKey ? fingerprintApiKey(apiKey) : null;
}
