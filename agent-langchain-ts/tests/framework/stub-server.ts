import { startServer } from "../../src/framework/server.js";
import { StubAgent } from "./stub-agent.js";

startServer(new StubAgent()).catch((e) => { console.error(e); process.exit(1); });
