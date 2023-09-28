import express from "express";
import userController from "../controllers/user.controller";
import { validateAccessToken } from "../middlewares/validateAccessToken";

const router = express.Router();

router.post("/signup", userController.signUp);
router.post("/login", userController.logIn);

router.get("/profile", validateAccessToken, userController.profile);

export default router;
