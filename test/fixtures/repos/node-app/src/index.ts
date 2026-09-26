import express from "express";
import { users } from "./routes/users.js";

// TODO: read the port from the environment
const app = express();
app.use("/users", users);
app.listen(3000);
