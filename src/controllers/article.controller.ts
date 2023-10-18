import "dotenv/config";
import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import {
  CreateArticleSchema,
  EditArticleSchema,
} from "../models/article.model";
import { generateSlug } from "../helpers/generateSlug";
import { z } from "zod";

const prisma = new PrismaClient();

interface ArticleRequest extends Request {
  id: string;
}

async function createArticle(req: Request, res: Response) {
  const article = CreateArticleSchema.safeParse(req.body);
  if (!article.success) {
    return res.sendStatus(400);
  }
  const { id } = req as ArticleRequest;
  const slug = generateSlug(article.data.title);
  const createdArticle = await prisma.article.create({
    data: {
      ...article.data,
      slug: slug,
      author: {
        connect: {
          id: id,
        },
      },
    },
  });
  res.status(200).send(createdArticle);
}

async function getArticle(req: Request, res: Response) {
  const validateParams = z.object({ slug: z.string() }).safeParse(req.params);
  if (!validateParams.success) return res.sendStatus(400);

  const foundArticle = await prisma.article.findFirst({
    where: {
      slug: validateParams.data.slug,
    },
  });

  if (!foundArticle) return res.sendStatus(404);

  res.status(200).send(foundArticle);
}

async function editArticle(req: Request, res: Response) {
  const validateBody = EditArticleSchema.safeParse(req.body);
  if (!validateBody.success) return res.sendStatus(400);

  const { id } = req as ArticleRequest;

  const slug = validateBody.data.title
    ? generateSlug(validateBody.data.title)
    : null;

  const editedArticle = await prisma.article.update({
    where: {
      slug: req.params.slug,
      author_id: id,
    },
    data: {
      ...validateBody.data,
      ...(slug && { slug }),
    },
  });

  if (!editedArticle) return res.sendStatus(404);

  res.status(200).send(editedArticle);
}

export default {
  createArticle,
  getArticle,
  editArticle,
};
