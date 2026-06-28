import { defineApp } from "convex/server";
import workpool from "@convex-dev/workpool/convex.config";
import agent from "@convex-dev/agent/convex.config";

// Register Convex components. The swarm runs on Workpool (parallel actions with
// maxParallelism); the Agent component gives shared memory/threads.
const app = defineApp();
app.use(workpool, { name: "swarmpool" });
app.use(agent);

export default app;
