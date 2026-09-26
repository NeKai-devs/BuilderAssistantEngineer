import { Router } from "express";

export const users = Router();
// TODO: paginate
users.get("/", (_req, res) => res.json([]));
