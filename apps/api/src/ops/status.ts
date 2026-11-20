export type JevAuthStatus = 'unknown' | 'ok' | 'auth_error';

export interface JevAuthReadiness {
  ok: boolean;
  detail?: string;
}

/**
 * Shared Jev authentication state (PLAN.md section 7.2, T5.4): the gateway
 * wrapper flips it to `auth_error` on a 401/403, and `/ready` surfaces it.
 */
export class JevAuthState {
  private status: JevAuthStatus = 'unknown';
  private detail: string | undefined;

  markOk(): void {
    this.status = 'ok';
    this.detail = undefined;
  }

  markAuthError(detail: string): void {
    this.status = 'auth_error';
    this.detail = detail;
  }

  get current(): JevAuthStatus {
    return this.status;
  }

  readiness(): JevAuthReadiness {
    if (this.status === 'auth_error') {
      return { ok: false, detail: this.detail ?? 'Jev authentication failed' };
    }
    if (this.status === 'unknown') {
      return { ok: true, detail: 'no Jev call has completed yet' };
    }
    return { ok: true };
  }
}

/** Dependencies of GET /ready; injected so route tests never touch real infra. */
export interface ReadinessDeps {
  /** Runs `SELECT 1`; throws when Postgres is unreachable. */
  database: () => Promise<void>;
  /** Connects to the Kafka admin API; throws when the brokers are unreachable. */
  kafka: () => Promise<void>;
  /** Current Jev auth state. */
  jevAuth: () => JevAuthReadiness;
}
