import express from "express";
import articleContoller from "../controllers/article.controller";
import { validateAccessToken } from "../middlewares/validateAccessToken";

const router = express.Router();

router.post("/", validateAccessToken, articleContoller.createArticle);

router.get("/:slug", articleContoller.getArticle);
router.put("/:slug", validateAccessToken, articleContoller.editArticle);

export default router;
