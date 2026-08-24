import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL não está definida. Copie .env.example para .env.");
}

/**
 * O coletor roda em processo separado e abre sua própria conexão. Aqui o pool
 * fica pequeno de propósito: a aplicação web não é o gargalo desse sistema.
 */
const client = postgres(connectionString, { max: 10 });

export const db = drizzle(client, { schema });

export { schema };
