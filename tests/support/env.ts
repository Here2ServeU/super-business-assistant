import { config } from "dotenv";

config({ quiet: true });
// Tests always use the separate test database and the free offline model.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://sba:sba@localhost:54329/sba_test";
process.env.AI_PROVIDER = "offline";
process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret";
process.env.ENCRYPTION_KEY ??= "test-encryption-key";
