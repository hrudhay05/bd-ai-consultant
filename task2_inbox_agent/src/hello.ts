
import "dotenv/config";
import Database from "better-sqlite3";
import { z } from "zod";

const db = new Database(":memory:");
db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");
db.prepare("INSERT INTO t (name) VALUES (?)").run("hello");
const row = db.prepare("SELECT * FROM t").get();
console.log("SQLite works:", row);

const Schema = z.object({ category: z.string(), risk: z.enum(["low", "medium", "high"]) });
console.log("Zod good input:", Schema.safeParse({ category: "how_to", risk: "low" }).success);
console.log("Zod bad input:", Schema.safeParse({ category: "how_to", risk: "banana" }).success);

console.log("KB_URL:", process.env.KB_URL);
console.log("GROQ key present:", Boolean(process.env.GROQ_API_KEY) && process.env.GROQ_API_KEY !== "paste_your_key_here");
