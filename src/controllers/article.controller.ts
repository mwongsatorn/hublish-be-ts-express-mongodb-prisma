import "dotenv/config";
import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import {
  AddCommentSchema,
  CreateArticleSchema,
  EditArticleSchema,
} from "../models/article.model";
import { generateSlug } from "../helpers/generateSlug";

const prisma = new PrismaClient();

interface ArticleRequest extends Request {
  id: string;
}

async function createArticle(req: Request, res: Response) {
  const validateBody = CreateArticleSchema.safeParse(req.body);
  if (!validateBody.success) {
    return res.sendStatus(400);
  }
  const { id } = req as ArticleRequest;
  const slug = generateSlug(validateBody.data.title);
  const createdArticle = await prisma.article.create({
    data: {
      ...validateBody.data,
      slug: slug,
      author_id: id,
    },
  });
  res.status(201).send(createdArticle);
}

async function getArticle(req: Request, res: Response) {
  const { id } = req as ArticleRequest;
  const foundArticle = await prisma.article.findFirst({
    where: {
      slug: req.params.slug,
    },
    include: {
      author: {
        select: {
          id: true,
          username: true,
          image: true,
          bio: true,
          name: true,
        },
      },
    },
  });

  if (!foundArticle) return res.sendStatus(404);

  const favouriteRelation = await prisma.favourite.findFirst({
    where: {
      user_id: id,
      article_id: foundArticle.id,
    },
  });
  const favourited = !id ? false : favouriteRelation ? true : false;

  res.status(200).send({ ...foundArticle, favourited: favourited });
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

async function deleteArticle(req: Request, res: Response) {
  const { id } = req as ArticleRequest;
  await prisma.article.delete({
    where: {
      slug: req.params.slug,
      author_id: id,
    },
  });
  res.sendStatus(204);
}

async function addComment(req: Request, res: Response) {
  const validateBody = AddCommentSchema.safeParse(req.body);
  if (!validateBody.success) return res.sendStatus(400);

  const { id } = req as ArticleRequest;

  const addedComment = await prisma.comment.create({
    data: {
      body: validateBody.data.body,
      commentAuthor: {
        connect: {
          id: id,
        },
      },
      aritcleDetails: {
        connect: {
          slug: req.params.slug,
        },
      },
    },
    include: {
      commentAuthor: {
        select: {
          id: true,
          username: true,
          name: true,
          image: true,
        },
      },
    },
  });
  res.status(201).send(addedComment);
}

async function deleteComment(req: Request, res: Response) {
  const { id } = req as ArticleRequest;
  await prisma.comment.delete({
    where: {
      id: req.params.comment_id,
      commentAuthor_id: id,
    },
  });
  res.sendStatus(204);
}

async function getComments(req: Request, res: Response) {
  const comments = await prisma.comment.findMany({
    where: {
      aritcleDetails: {
        slug: req.params.slug,
      },
    },
    include: {
      commentAuthor: {
        select: {
          id: true,
          username: true,
          name: true,
          image: true,
        },
      },
    },
  });
  res.status(200).send(comments);
}

async function favouriteArticle(req: Request, res: Response) {
  const { id } = req as ArticleRequest;
  const isFavourited = await prisma.favourite.findFirst({
    where: {
      user: {
        id: id,
      },
      article: {
        slug: req.params.slug,
      },
    },
  });

  if (isFavourited) return res.sendStatus(409);

  await prisma.$transaction(async (tx) => {
    const favourite = await tx.favourite.create({
      data: {
        user: {
          connect: {
            id: id,
          },
        },
        article: {
          connect: {
            slug: req.params.slug,
          },
        },
      },
    });

    const article = await tx.article.update({
      where: {
        slug: req.params.slug,
      },
      data: {
        favouriteCount: {
          increment: 1,
        },
      },
    });

    res.status(201).send(article);
  });
}

async function unfavouriteArticle(req: Request, res: Response) {
  const { id } = req as ArticleRequest;
  const isFavourited = await prisma.favourite.findFirst({
    where: {
      user_id: id,
      article: {
        slug: req.params.slug,
      },
    },
  });

  if (!isFavourited) return res.sendStatus(404);

  await prisma.$transaction(async (tx) => {
    const unfavourite = await tx.favourite.delete({
      where: {
        id: isFavourited.id,
      },
    });

    const article = await tx.article.update({
      where: {
        slug: req.params.slug,
      },
      data: {
        favouriteCount: {
          decrement: 1,
        },
      },
    });

    res.status(200).send(article);
  });
}

async function getFavouriteArticles(req: Request, res: Response) {
  const { id: loggedInUserId } = req as ArticleRequest;
  const { limit = 10, page = 1 } = req.query;

  const targetUser = await prisma.user.findUnique({
    where: { username: req.params.username },
  });

  if (!targetUser) return res.status(404).send({ error: "User not found." });

  const favouriteArticles = await prisma.favourite.aggregateRaw({
    pipeline: [
      {
        $facet: {
          total_results: [
            {
              $match: {
                user_id: {
                  $oid: targetUser.id,
                },
              },
            },
            {
              $count: "count",
            },
          ],
          results: [
            {
              $match: {
                user_id: {
                  $oid: targetUser.id,
                },
              },
            },
            {
              $sort: {
                createdAt: -1,
              },
            },
            {
              $skip: parseInt(limit as string) * (parseInt(page as string) - 1),
            },
            {
              $limit: parseInt(limit as string),
            },
            {
              $lookup: {
                from: "Article",
                localField: "article_id",
                foreignField: "_id",
                as: "targetFavouriteArticle",
              },
            },
            {
              $unwind: "$targetFavouriteArticle",
            },
            {
              $lookup: {
                from: "User",
                let: {
                  author_id: "$targetFavouriteArticle.author_id",
                },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $eq: ["$_id", "$$author_id"],
                      },
                    },
                  },
                  {
                    $project: {
                      _id: 0,
                      id: {
                        $toString: "$_id",
                      },
                      username: 1,
                      name: 1,
                      bio: 1,
                      image: 1,
                    },
                  },
                ],
                as: "author",
              },
            },
            {
              $lookup: {
                from: "Favourite",
                let: {
                  t_article_id: "$article_id",
                },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $eq: ["$$t_article_id", "$article_id"],
                      },
                      user_id: {
                        $oid: loggedInUserId,
                      },
                    },
                  },
                ],
                as: "loggedInUserFavourite",
              },
            },
            {
              $project: {
                _id: 0,
                id: {
                  $toString: "$targetFavouriteArticle._id",
                },
                title: "$targetFavouriteArticle.title",
                slug: "$targetFavouriteArticle.slug",
                content: "$targetFavouriteArticle.content",
                tags: "$targetFavouriteArticle.tags",
                createdAt: {
                  $toString: "$targetFavouriteArticle.createdAt",
                },
                updatedAt: {
                  $toString: "$targetFavouriteArticle.updatedAt",
                },
                author_id: {
                  $toString: "$targetFavouriteArticle.author_id",
                },
                author: {
                  $arrayElemAt: ["$author", 0],
                },
                favouriteCount: "$targetFavouriteArticle.favouriteCount",
                favourited: {
                  $gt: [{ $size: "$loggedInUserFavourite" }, 0],
                },
              },
            },
          ],
        },
      },
      {
        $addFields: {
          total_results: {
            $cond: {
              if: {
                $ne: [{ $size: "$total_results" }, 0],
              },
              then: {
                $arrayElemAt: ["$total_results.count", 0],
              },
              else: 0,
            },
          },
        },
      },
      {
        $project: {
          total_results: 1,
          total_pages: {
            $ceil: {
              $divide: ["$total_results", parseInt(limit as string)],
            },
          },
          page: {
            $literal: parseInt(page as string),
          },
          results: 1,
        },
      },
    ],
  });

  res.status(200).send(favouriteArticles[0]);
}

async function getFeedArticles(req: Request, res: Response) {
  const { id: loggedInUserId } = req as ArticleRequest;
  const { limit = 10, page = 1 } = req.query;

  const feedArticles = await prisma.article.aggregateRaw({
    pipeline: [
      {
        $facet: {
          total_results: [
            {
              $lookup: {
                from: "Follow",
                pipeline: [
                  {
                    $match: {
                      follower_id: {
                        $oid: loggedInUserId,
                      },
                    },
                  },
                ],
                as: "followRelations",
              },
            },
            {
              $match: {
                $expr: {
                  $in: ["$author_id", "$followRelations.following_id"],
                },
              },
            },
            {
              $count: "count",
            },
          ],
          results: [
            {
              $lookup: {
                from: "Follow",
                pipeline: [
                  {
                    $match: {
                      follower_id: {
                        $oid: loggedInUserId,
                      },
                    },
                  },
                ],
                as: "followRelations",
              },
            },
            {
              $match: {
                $expr: {
                  $in: ["$author_id", "$followRelations.following_id"],
                },
              },
            },
            {
              $sort: {
                createdAt: -1,
              },
            },
            {
              $skip: parseInt(limit as string) * (parseInt(page as string) - 1),
            },
            {
              $limit: parseInt(limit as string),
            },
            {
              $lookup: {
                from: "User",
                let: {
                  author_id: "$author_id",
                },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $eq: ["$_id", "$$author_id"],
                      },
                    },
                  },
                  {
                    $project: {
                      _id: 0,
                      id: {
                        $toString: "$_id",
                      },
                      username: 1,
                      name: 1,
                      bio: 1,
                      image: 1,
                    },
                  },
                ],
                as: "author",
              },
            },
            {
              $lookup: {
                from: "Favourite",
                let: {
                  article_id: "$_id",
                },
                pipeline: [
                  {
                    $match: {
                      user_id: {
                        $oid: loggedInUserId,
                      },
                      $expr: {
                        $eq: ["$article_id", "$$article_id"],
                      },
                    },
                  },
                ],
                as: "loggedInUserFavourite",
              },
            },
            {
              $project: {
                _id: 0,
                id: {
                  $toString: "$_id",
                },
                title: 1,
                slug: 1,
                content: 1,
                tags: 1,
                createdAt: {
                  $toString: "$createdAt",
                },
                updatedAt: {
                  $toString: "$updatedAt",
                },
                author_id: {
                  $toString: "$author_id",
                },
                author: {
                  $arrayElemAt: ["$author", 0],
                },
                favouriteCount: 1,
                favourited: {
                  $gt: [{ $size: "$loggedInUserFavourite" }, 0],
                },
              },
            },
          ],
        },
      },
      {
        $addFields: {
          total_results: {
            $cond: {
              if: {
                $ne: [{ $size: "$total_results" }, 0],
              },
              then: {
                $arrayElemAt: ["$total_results.count", 0],
              },
              else: 0,
            },
          },
        },
      },
      {
        $project: {
          total_results: 1,
          total_pages: {
            $ceil: {
              $divide: ["$total_results", parseInt(limit as string)],
            },
          },
          page: {
            $literal: parseInt(page as string),
          },
          results: 1,
        },
      },
    ],
  });

  res.status(200).send(feedArticles[0]);
}

async function getUserCreatedArticles(req: Request, res: Response) {
  const { id: loggedInUserId } = req as ArticleRequest;
  const { limit = 10, page = 1 } = req.query;
  const targetUser = await prisma.user.findUnique({
    where: { username: req.params.username },
  });

  if (!targetUser) return res.status(404).send({ error: "User not found." });

  const createdArticles = await prisma.article.aggregateRaw({
    pipeline: [
      {
        $facet: {
          total_results: [
            {
              $match: {
                author_id: {
                  $oid: targetUser.id,
                },
              },
            },
            {
              $count: "count",
            },
          ],
          results: [
            {
              $match: {
                author_id: {
                  $oid: targetUser.id,
                },
              },
            },
            {
              $sort: {
                createdAt: -1,
              },
            },
            {
              $lookup: {
                from: "User",
                let: {
                  author_id: "$author_id",
                },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $eq: ["$_id", "$$author_id"],
                      },
                    },
                  },
                  {
                    $project: {
                      _id: 0,
                      id: {
                        $toString: "$_id",
                      },
                      username: 1,
                      name: 1,
                      bio: 1,
                      image: 1,
                    },
                  },
                ],
                as: "author",
              },
            },
            {
              $lookup: {
                from: "Favourite",
                let: {
                  article_id: "$_id",
                },
                pipeline: [
                  {
                    $match: {
                      user_id: {
                        $oid: loggedInUserId,
                      },
                      $expr: {
                        $eq: ["$article_id", "$$article_id"],
                      },
                    },
                  },
                ],
                as: "loggedInUserFavourite",
              },
            },
            {
              $project: {
                _id: 0,
                id: {
                  $toString: "$_id",
                },
                title: 1,
                slug: 1,
                content: 1,
                tags: 1,
                createdAt: {
                  $toString: "$createdAt",
                },
                updatedAt: {
                  $toString: "$updatedAt",
                },
                author_id: {
                  $toString: "$author_id",
                },
                author: {
                  $arrayElemAt: ["$author", 0],
                },
                favouriteCount: 1,
                favourited: {
                  $gt: [{ $size: "$loggedInUserFavourite" }, 0],
                },
              },
            },
          ],
        },
      },
      {
        $addFields: {
          total_results: {
            $cond: {
              if: {
                $ne: [{ $size: "$total_results" }, 0],
              },
              then: {
                $arrayElemAt: ["$total_results.count", 0],
              },
              else: 0,
            },
          },
        },
      },
      {
        $project: {
          total_results: 1,
          total_pages: {
            $ceil: {
              $divide: ["$total_results", parseInt(limit as string)],
            },
          },
          page: {
            $literal: parseInt(page as string),
          },
          results: 1,
        },
      },
    ],
  });

  res.status(200).send(createdArticles[0]);
}

async function searchArticles(req: Request, res: Response) {
  const { id: loggedInUserId } = req as ArticleRequest;
  const { tags, title, limit = 10, page = 1 } = req.query;
  const query = [];
  if (title)
    query.push({
      title: { $regex: title, $options: "i" },
    });
  if (tags)
    query.push({
      tags: { $regex: tags, $options: "i" },
    });
  const articles = await prisma.article.aggregateRaw({
    pipeline: [
      {
        $facet: {
          total_results: [
            {
              $match: query.length > 0 ? { $or: query } : {},
            },
            {
              $count: "count",
            },
          ],
          results: [
            {
              $match: query.length > 0 ? { $or: query } : {},
            },
            {
              $sort: {
                createdAt: -1,
              },
            },
            {
              $skip: parseInt(limit as string) * (parseInt(page as string) - 1),
            },
            {
              $limit: parseInt(limit as string),
            },

            {
              $lookup: {
                from: "User",
                let: { author_id: "$author_id" },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $eq: ["$_id", "$$author_id"],
                      },
                    },
                  },
                  {
                    $project: {
                      _id: 0,
                      id: {
                        $toString: "$_id",
                      },
                      username: 1,
                      name: 1,
                      bio: 1,
                      image: 1,
                    },
                  },
                ],
                as: "author",
              },
            },
            {
              $lookup: {
                from: "Favourite",
                let: {
                  article_id: "$_id",
                },
                pipeline: [
                  {
                    $match: {
                      user_id: {
                        $oid: loggedInUserId,
                      },
                      $expr: {
                        $eq: ["$article_id", "$$article_id"],
                      },
                    },
                  },
                ],
                as: "loggedInUserFavourite",
              },
            },
            {
              $project: {
                _id: 0,
                id: {
                  $toString: "$_id",
                },
                title: 1,
                slug: 1,
                content: 1,
                tags: 1,
                createdAt: {
                  $toString: "$createdAt",
                },
                updatedAt: {
                  $toString: "$updatedAt",
                },
                author_id: {
                  $toString: "$author_id",
                },
                author: {
                  $arrayElemAt: ["$author", 0],
                },
                favouriteCount: 1,
                favourited: {
                  $gt: [{ $size: "$loggedInUserFavourite" }, 0],
                },
              },
            },
          ],
        },
      },
      {
        $addFields: {
          total_results: {
            $cond: {
              if: {
                $ne: [{ $size: "$total_results" }, 0],
              },
              then: {
                $arrayElemAt: ["$total_results.count", 0],
              },
              else: 0,
            },
          },
        },
      },
      {
        $project: {
          total_results: 1,
          total_pages: {
            $ceil: {
              $divide: ["$total_results", parseInt(limit as string)],
            },
          },
          page: {
            $literal: parseInt(page as string),
          },
          results: 1,
        },
      },
    ],
  });
  res.send(articles[0]);
}

export default {
  createArticle,
  getArticle,
  editArticle,
  deleteArticle,
  addComment,
  deleteComment,
  getComments,
  favouriteArticle,
  unfavouriteArticle,
  getFavouriteArticles,
  getFeedArticles,
  getUserCreatedArticles,
  searchArticles,
};
