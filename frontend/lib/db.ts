import { Pool } from "pg";

const DEFAULT_LOCAL_DB_URL =
  "postgresql://postgres:postgres@localhost:5432/dailyminton";

declare global {
  var __dailyMintonPgPool: Pool | undefined;
}

function resolveSslConfig(connectionString: string) {
  const isLocal =
    connectionString.includes("localhost") ||
    connectionString.includes("127.0.0.1");
  if (isLocal) {
    return false;
  }
  return { rejectUnauthorized: false };
}

/**
 * 로컬 PostgreSQL과 Vercel 서버리스 환경의 클라우드 PostgreSQL(Neon/Supabase 등)을
 * 모두 지원하는 공용 pg Pool 인스턴스를 반환합니다.
 */
export function getDbPool(): Pool {
  if (!globalThis.__dailyMintonPgPool) {
    const connectionString =
      process.env.DATABASE_URL ||
      process.env.POSTGRES_URL ||
      DEFAULT_LOCAL_DB_URL;

    globalThis.__dailyMintonPgPool = new Pool({
      connectionString,
      ssl: resolveSslConfig(connectionString),
      max: 5,
      idleTimeoutMillis: 15000,
      connectionTimeoutMillis: 4000,
    });
  }
  return globalThis.__dailyMintonPgPool;
}
